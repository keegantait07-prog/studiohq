// Lead Finder: shared types, scoring and parsing. Pure, no Node imports.

export type LeadSource = 'youtube' | 'soundcloud' | 'audiomack' | 'reddit' | 'x' | 'manual'
export type LeadStatus = 'new' | 'saved' | 'in_crm' | 'skipped'

export interface LeadCandidate {
  source: LeadSource
  sourceId: string
  name: string
  url: string
  followers: number | null
  lastActiveAt: number | null
  genre: string
  bio: string
  signals: string[]
  email: string
  emailSourceUrl: string
}

export interface Lead extends LeadCandidate {
  id: number
  score: number
  reasons: string[]
  status: LeadStatus
  contactId: number | null
  createdAt: number
}

export const OPT_OUT_LINE = 'Not interested? Reply "stop" and I won\'t email you again.'

const DAY = 86_400_000
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/
const JUNK_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js'])
const JUNK_DOMAINS = new Set(['example.com', 'example.org', 'sentry.io', 'sentry.wixpress.com', 'wixpress.com'])

export function normalizeEmail(s: string): string | null {
  let v = s.trim().toLowerCase()
  if (v.startsWith('mailto:')) v = v.slice(7)
  v = v.split('?')[0].trim()
  return EMAIL_RE.test(v) ? v : null
}

const EMAIL_SCAN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
/** Free text longer than this is cut before scanning; the scan regex is slow on huge inputs. */
const MAX_FREE_TEXT = 500

function scanEmails(text: string): string[] {
  const out: string[] = []
  for (const raw of text.match(EMAIL_SCAN) ?? []) {
    const e = normalizeEmail(raw)
    if (e && !out.includes(e)) out.push(e)
  }
  return out
}

/** Every address written in a short free-text field such as a contact's email ("Ada <ada@x.com>", "a@x.com, b@y.com"). */
export function emailsIn(text: string): string[] {
  return scanEmails(text.slice(0, MAX_FREE_TEXT))
}

/** Addresses found on a public page or bio, without placeholders and file names that look like emails. */
export function extractEmails(text: string): string[] {
  return scanEmails(text).filter((e) => {
    const domain = e.split('@')[1]
    const tld = domain.split('.').pop() as string
    return !JUNK_TLDS.has(tld) && !JUNK_DOMAINS.has(domain)
  })
}

const ASKS_FOR_BEATS =
  /\bneed(?:ing)? (?:some |new )?beats\b|\blooking for (?:a |some )?(?:producers?|beats)\b|\bsend (?:me )?(?:your |some )?beats\b|\bneed (?:a )?producers?\b|\bdm (?:me )?(?:for )?beats\b|\bbeats wanted\b/i

/** True when a public bio asks for beats or a producer ("need beats", "looking for a producer", "send me beats", "dm for beats"). */
export function asksForBeats(text: string): boolean {
  return ASKS_FOR_BEATS.test(text.slice(0, 2000).replace(/\s+/g, ' '))
}

export function scoreLead(
  c: LeadCandidate,
  o: { producerGenres: string[]; now: number }
): { score: number; reasons: string[] } {
  let score = 50
  const reasons: string[] = []
  const add = (n: number, why: string): void => {
    score += n
    reasons.push(`${why} (${n > 0 ? '+' : ''}${n})`)
  }

  const f = c.followers
  if (f !== null) {
    if (f >= 100_000) add(-40, 'Very large audience, unlikely to need beats')
    else if (f >= 20_000) add(-20, 'Large audience')
    else if (f < 1000) add(25, 'Small, up-and-coming audience')
    else if (f < 5000) add(15, 'Growing audience')
    else add(5, 'Mid-size audience')
  }

  if (c.lastActiveAt !== null) {
    const age = o.now - c.lastActiveAt
    if (age <= 30 * DAY) add(15, 'Active in the last 30 days')
    else if (age <= 90 * DAY) add(5, 'Active in the last 90 days')
    else if (age > 180 * DAY) add(-15, 'Inactive for over 6 months')
  }

  const genre = c.genre.trim().toLowerCase()
  if (genre && o.producerGenres.some((g) => g.trim().toLowerCase() === genre)) {
    add(10, 'Genre matches your beats')
  }

  if (c.signals.includes('asks_for_beats')) add(30, 'Asks for beats')

  return { score: Math.max(0, Math.min(100, score)), reasons }
}

type HandleHit = Pick<LeadCandidate, 'source' | 'sourceId' | 'url'>

function parseHandleLine(line: string): HandleHit | null {
  const t = line.trim()
  if (!t) return null
  if (/^@[A-Za-z0-9._]+$/.test(t)) return { source: 'manual', sourceId: t.slice(1).toLowerCase(), url: '' }

  const m = t.match(/^(?:https?:\/\/)?(?:www\.|m\.)?([a-z0-9.-]+\.[a-z]{2,})(\/[^?#\s]*)?/i)
  if (!m) return null
  const host = m[1].toLowerCase()
  const segs = (m[2] ?? '').split('/').filter(Boolean)
  const first = segs[0]
  if (!first) return null

  if (host === 'instagram.com') {
    const id = first.replace(/^@/, '').toLowerCase()
    return { source: 'manual', sourceId: id, url: `https://www.instagram.com/${first}/` }
  }
  if (host === 'soundcloud.com') {
    return { source: 'soundcloud', sourceId: first.toLowerCase(), url: `https://soundcloud.com/${first}` }
  }
  if (host === 'youtube.com') {
    if (first.startsWith('@')) {
      return { source: 'youtube', sourceId: first.slice(1).toLowerCase(), url: `https://www.youtube.com/${first}` }
    }
    if (first === 'channel' && segs[1]) {
      return { source: 'youtube', sourceId: segs[1], url: `https://www.youtube.com/channel/${segs[1]}` }
    }
  }
  return null
}

export function parseHandles(text: string): HandleHit[] {
  const seen = new Set<string>()
  const out: HandleHit[] = []
  for (const line of text.split(/\r?\n/)) {
    const h = parseHandleLine(line)
    if (!h || !h.sourceId) continue
    const key = `${h.source}:${h.sourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
  }
  return out
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else cur += ch
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

export function parseCsv(text: string): LeadCandidate[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
  if (lines.length && splitCsvLine(lines[0])[0].toLowerCase() === 'name') lines.shift()

  const out: LeadCandidate[] = []
  for (const line of lines) {
    const cells = splitCsvLine(line)
    if (cells.length < 2) continue
    const [name, url = '', rawEmail = '', genre = '', rawFollowers = ''] = cells
    if (!name) continue
    const email = rawEmail ? (normalizeEmail(rawEmail) ?? '') : ''
    const n = rawFollowers ? Number(rawFollowers.replace(/[\s_]/g, '')) : NaN
    out.push({
      source: 'manual',
      sourceId: (email || parseHandleLine(url)?.sourceId || name).toLowerCase(),
      name,
      url,
      followers: Number.isFinite(n) && n >= 0 ? Math.round(n) : null,
      lastActiveAt: null,
      genre,
      bio: '',
      signals: [],
      email,
      emailSourceUrl: ''
    })
  }
  return out
}

export function withOptOut(body: string): string {
  if (body.includes(OPT_OUT_LINE)) return body
  return `${body.replace(/\s+$/, '')}\n\n${OPT_OUT_LINE}`
}
