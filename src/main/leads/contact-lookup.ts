import { extractEmails } from '../../shared/leads'

const MAX_BYTES = 1_048_576
const MAX_REDIRECTS = 3
const MAX_FOLLOWED = 2
const LINK_WORDS = /contact|about|booking|business/i
const USER_AGENT = 'StudioHQ-contact-lookup'

/** True only for http(s) URLs whose host is not loopback, private, link-local or unspecified. These URLs come from public data. */
export function isFetchableUrl(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return false
    if (host.startsWith('::ffff:')) return false
    const first = parseInt(host.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return false
    if ((first & 0xffc0) === 0xfe80) return false
    return true
  }
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
  }
  return true
}

type Page = { url: string; status: number; type: string; body: string }
type Ctx = { fetchFn: typeof fetch; sleep: (ms: number) => Promise<void>; gap: number; timeoutMs: number; fetched: number }

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      const keep = value.length > MAX_BYTES - total ? value.subarray(0, MAX_BYTES - total) : value
      chunks.push(keep)
      total += keep.length
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** One polite fetch: waits the gap after the first, 8 s timeout, redirects checked by hand and kept on the same host. Null on any failure. */
async function get(url: string, ctx: Ctx, from: URL = new URL(url)): Promise<Page | null> {
  let cur = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableUrl(cur)) return null
    if (ctx.fetched++ > 0) await ctx.sleep(ctx.gap)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), ctx.timeoutMs)
    try {
      const res = await ctx.fetchFn(cur, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain' } })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return null
        const next = new URL(loc, cur)
        if (!sameSite(next.hostname, from.hostname) || !isFetchableUrl(next.href)) return null
        cur = next.href
        continue
      }
      if (res.status < 200 || res.status >= 300) return null
      return { url: cur, status: res.status, type: (res.headers.get('content-type') ?? '').toLowerCase(), body: await readCapped(res) }
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/** a.com and www.a.com count as the same site. */
function sameSite(a: string, b: string): boolean {
  const bare = (h: string): string => h.toLowerCase().replace(/^www\./, '')
  return bare(a) === bare(b)
}

// Every helper below scans fetched (hostile) content with indexOf and bounded slices, never a backtracking regex over the raw page.
const TAG_MAX = 2000

/** Simple robots.txt: only the `User-agent: *` group, Disallow by prefix. A missing or unreadable file allows everything. */
function disallowed(robots: string, path: string): boolean {
  let inStar = false
  let lastWasAgent = false
  for (const raw of robots.split('\n')) {
    const hash = raw.indexOf('#')
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim()
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const val = line.slice(i + 1).trim()
    if (key === 'user-agent') {
      inStar = lastWasAgent ? inStar || val === '*' : val === '*'
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (inStar && key === 'disallow' && val && path.startsWith(val)) return true
  }
  return false
}

/** Linear tag stripper: drops tags, comments and script/style/noscript bodies. An unclosed construct drops the rest of the page. */
function stripTags(html: string): string {
  const lower = html.toLowerCase()
  const out: string[] = []
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { out.push(html.slice(i)); break }
    out.push(html.slice(i, lt), ' ')
    if (lower.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      if (end < 0) break
      i = end + 3
      continue
    }
    const block = ['script', 'style', 'noscript'].find((t) => lower.startsWith(`<${t}`, lt) && /[\s>/]/.test(lower[lt + t.length + 1] ?? '>'))
    if (block) {
      const end = lower.indexOf(`</${block}`, lt)
      const close = end < 0 ? -1 : html.indexOf('>', end)
      if (close < 0) break
      i = close + 1
      continue
    }
    const gt = html.indexOf('>', lt + 1)
    if (gt < 0) break
    i = gt + 1
  }
  return out.join('')
}

function visibleText(html: string): string {
  return stripTags(html).replace(/&#64;|&commat;/gi, '@').replace(/&amp;/gi, '&')
}

/** Windows around each "@" so a huge unbroken run of word characters cannot make the email regex quadratic. */
function aroundAt(text: string): string {
  const parts: string[] = []
  for (let i = text.indexOf('@'); i >= 0 && parts.length < 500; i = text.indexOf('@', i + 1)) parts.push(text.slice(Math.max(0, i - 70), i + 260))
  return parts.join(' ')
}

function mailtoAddresses(html: string): string[] {
  const lower = html.toLowerCase()
  const out: string[] = []
  for (let i = lower.indexOf('mailto:'); i >= 0 && out.length < 200; i = lower.indexOf('mailto:', i + 7)) {
    const chunk = html.slice(i + 7, i + 7 + 320)
    const raw = chunk.split(/["'?<>\s]/, 1)[0]
    try { out.push(decodeURIComponent(raw)) } catch { out.push(raw) }
  }
  return out
}

function findEmail(html: string): string | null {
  return extractEmails(aroundAt(mailtoAddresses(html).join(' ')))[0] ?? extractEmails(aroundAt(visibleText(html)))[0] ?? null
}

function contactLinks(html: string, base: URL): string[] {
  const lower = html.toLowerCase()
  const out: string[] = []
  let scanned = 0
  for (let i = lower.indexOf('<a'); i >= 0 && out.length < MAX_FOLLOWED && scanned++ < 20000; i = lower.indexOf('<a', i + 2)) {
    if (!/\s/.test(lower[i + 2] ?? '')) continue
    const head = html.slice(i, i + TAG_MAX)
    const gt = head.indexOf('>')
    if (gt < 0) continue
    const hm = head.slice(0, gt).match(/\bhref\s*=\s*(?:"([^"]{1,1000})"|'([^']{1,1000})')/i)
    if (!hm) continue
    const href = hm[1] ?? hm[2]
    const text = stripTags(html.slice(i + gt + 1, i + gt + 1 + 300).split(/<\/a/i, 1)[0])
    if (!LINK_WORDS.test(href) && !LINK_WORDS.test(text)) continue
    try {
      const u = new URL(href, base)
      u.hash = ''
      if (!sameSite(u.hostname, base.hostname) || !isFetchableUrl(u.href) || u.href === base.href || out.includes(u.href)) continue
      out.push(u.href)
    } catch { /* bad href */ }
  }
  return out
}

/** Looks for a public email on the page and up to two same-site contact pages. Never throws; null when nothing was found or allowed. */
export async function lookupContact(
  url: string,
  o: { fetchFn: typeof fetch; sleep?: (ms: number) => Promise<void>; minGapMs?: number; timeoutMs?: number }
): Promise<{ email: string; sourceUrl: string } | null> {
  try {
    if (!isFetchableUrl(url)) return null
    const start = new URL(url)
    const ctx: Ctx = { fetchFn: o.fetchFn, sleep: o.sleep ?? realSleep, gap: o.minGapMs ?? 3000, timeoutMs: o.timeoutMs ?? 8000, fetched: 0 }

    let robots = ''
    try {
      const r = await get(new URL('/robots.txt', start).href, ctx, start)
      if (r) robots = r.body
    } catch { /* unreadable robots allows */ }
    if (disallowed(robots, start.pathname + start.search)) return null

    const first = await get(url, ctx, start)
    if (!first || !first.type.includes('text/html')) return null
    const email = findEmail(first.body)
    if (email) return { email, sourceUrl: first.url }

    for (const link of contactLinks(first.body, new URL(first.url))) {
      const l = new URL(link)
      if (disallowed(robots, l.pathname + l.search)) continue
      const page = await get(link, ctx, start)
      if (!page || !page.type.includes('text/html')) continue
      const e = findEmail(page.body)
      if (e) return { email: e, sourceUrl: page.url }
    }
    return null
  } catch {
    return null
  }
}
