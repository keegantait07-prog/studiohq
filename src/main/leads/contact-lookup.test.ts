import { describe, expect, test } from 'vitest'
import { isFetchableUrl, lookupContact } from './contact-lookup'

type Route = { status?: number; type?: string; body?: string | Uint8Array; location?: string }

function stub(routes: Record<string, Route | 'throw'>): { fetchFn: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const r = routes[url]
    if (r === 'throw') throw new Error('network down')
    if (!r) return new Response('', { status: 404 })
    const headers: Record<string, string> = { 'content-type': r.type ?? 'text/html; charset=utf-8' }
    if (r.location) headers.location = r.location
    return new Response((r.body ?? '') as BodyInit, { status: r.status ?? 200, headers })
  }) as typeof fetch
  return { fetchFn, calls }
}

const noSleep = async (): Promise<void> => {}

describe('isFetchableUrl', () => {
  test.each([
    'https://example.org/contact', 'http://beats.example.org', 'https://8.8.8.8/x', 'https://172.32.0.1/', 'https://[2606:4700::1111]/'
  ])('allows %s', (u) => expect(isFetchableUrl(u)).toBe(true))

  test.each([
    'ftp://example.org', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', '',
    'http://localhost/', 'http://foo.localhost/', 'http://127.0.0.1/', 'http://127.9.9.9:8080/', 'http://[::1]/', 'http://0.0.0.0/',
    'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data',
    'http://[fc00::1]/', 'http://[fd12::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://printer.local/'
  ])('refuses %s', (u) => expect(isFetchableUrl(u)).toBe(false))
})

describe('lookupContact', () => {
  test('finds a mailto link and reports that page as the source', async () => {
    const { fetchFn } = stub({ 'https://a.com/': { body: '<a href="mailto:Hi@A.com?subject=x">mail</a>' } })
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: noSleep })).toEqual({ email: 'hi@a.com', sourceUrl: 'https://a.com/' })
  })

  test('finds an email in visible text but not in scripts', async () => {
    const { fetchFn } = stub({ 'https://a.com/': { body: '<script>var x="no@real.com"</script><p>Book: booking@a.com</p>' } })
    expect((await lookupContact('https://a.com/', { fetchFn, sleep: noSleep }))?.email).toBe('booking@a.com')
  })

  test('follows a contact link on the same host and reports that page', async () => {
    const { fetchFn, calls } = stub({
      'https://a.com/': { body: '<a href="/contact-us">Say hi</a><a href="https://other.com/contact">x</a>' },
      'https://a.com/contact-us': { body: '<p>mail me@a.com</p>' }
    })
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: noSleep })).toEqual({ email: 'me@a.com', sourceUrl: 'https://a.com/contact-us' })
    expect(calls).not.toContain('https://other.com/contact')
  })

  test('follows at most two links, matched by link text too', async () => {
    const { fetchFn, calls } = stub({
      'https://a.com/': { body: '<a href="/p1">About</a><a href="/p2">Business</a><a href="/p3">Booking</a>' },
      'https://a.com/p1': { body: 'nothing' }, 'https://a.com/p2': { body: 'nothing' }, 'https://a.com/p3': { body: 'late@a.com' }
    })
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: noSleep })).toBeNull()
    expect(calls).not.toContain('https://a.com/p3')
  })

  test('ignores junk addresses', async () => {
    const { fetchFn } = stub({ 'https://a.com/': { body: '<img src="logo@2x.png"> x@example.com bug@sentry.io logo@2x.png' } })
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: noSleep })).toBeNull()
  })

  test('returns null for non-HTML content', async () => {
    const { fetchFn } = stub({ 'https://a.com/': { type: 'application/pdf', body: 'a@a.com' } })
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: noSleep })).toBeNull()
  })

  test('returns null when robots.txt disallows the path, without fetching it', async () => {
    const { fetchFn, calls } = stub({
      'https://a.com/robots.txt': { type: 'text/plain', body: 'User-agent: Googlebot\nDisallow:\n\nUser-agent: *\nDisallow: /private\n' },
      'https://a.com/private/page': { body: 'a@a.com' }
    })
    expect(await lookupContact('https://a.com/private/page', { fetchFn, sleep: noSleep })).toBeNull()
    expect(calls).not.toContain('https://a.com/private/page')
  })

  test('robots with an empty Disallow or other agents does not block', async () => {
    const { fetchFn } = stub({
      'https://a.com/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow:\n\nUser-agent: bad\nDisallow: /\n' },
      'https://a.com/': { body: 'a@a.com' }
    })
    expect((await lookupContact('https://a.com/', { fetchFn, sleep: noSleep }))?.email).toBe('a@a.com')
  })

  test('respects robots for followed links', async () => {
    const { fetchFn, calls } = stub({
      'https://a.com/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /contact' },
      'https://a.com/': { body: '<a href="/contact">c</a>' },
      'https://a.com/contact': { body: 'a@a.com' }
    })
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: noSleep })).toBeNull()
    expect(calls).not.toContain('https://a.com/contact')
  })

  test('returns null when fetch throws or the status is bad', async () => {
    expect(await lookupContact('https://a.com/', { fetchFn: stub({ 'https://a.com/': 'throw' }).fetchFn, sleep: noSleep })).toBeNull()
    expect(await lookupContact('https://a.com/', { fetchFn: stub({ 'https://a.com/': { status: 500, body: 'a@a.com' } }).fetchFn, sleep: noSleep })).toBeNull()
    expect(await lookupContact('https://a.com/', { fetchFn: stub({}).fetchFn, sleep: noSleep })).toBeNull()
  })

  test('returns null when the sleep itself throws', async () => {
    const { fetchFn } = stub({ 'https://a.com/': { body: 'a@a.com' } })
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: async () => { throw new Error('x') } })).toBeNull()
  })

  test('refuses off-site and private redirects, follows same-host ones', async () => {
    const off = stub({ 'https://a.com/': { status: 302, location: 'https://evil.com/', body: '' }, 'https://evil.com/': { body: 'a@evil.com' } })
    expect(await lookupContact('https://a.com/', { fetchFn: off.fetchFn, sleep: noSleep })).toBeNull()
    expect(off.calls).not.toContain('https://evil.com/')
    const priv = stub({ 'https://a.com/': { status: 301, location: 'http://127.0.0.1/admin' } })
    expect(await lookupContact('https://a.com/', { fetchFn: priv.fetchFn, sleep: noSleep })).toBeNull()
    expect(priv.calls).not.toContain('http://127.0.0.1/admin')
    const same = stub({ 'https://a.com/': { status: 301, location: '/home' }, 'https://a.com/home': { body: 'ok@a.com' } })
    expect(await lookupContact('https://a.com/', { fetchFn: same.fetchFn, sleep: noSleep })).toEqual({ email: 'ok@a.com', sourceUrl: 'https://a.com/home' })
  })

  test('refuses a private-host or non-http start URL without fetching', async () => {
    const { fetchFn, calls } = stub({})
    expect(await lookupContact('http://192.168.0.5/', { fetchFn, sleep: noSleep })).toBeNull()
    expect(await lookupContact('file:///etc/passwd', { fetchFn, sleep: noSleep })).toBeNull()
    expect(calls).toEqual([])
  })

  test('waits minGapMs between consecutive fetches, not before the first', async () => {
    const { fetchFn, calls } = stub({ 'https://a.com/': { body: '<a href="/contact">c</a>' }, 'https://a.com/contact': { body: 'none' } })
    const gaps: number[] = []
    await lookupContact('https://a.com/', { fetchFn, sleep: async (ms) => { gaps.push(ms) }, minGapMs: 1234 })
    expect(calls).toHaveLength(3)
    expect(gaps).toEqual([1234, 1234])
    const d: number[] = []
    await lookupContact('https://a.com/', { fetchFn, sleep: async (ms) => { d.push(ms) } })
    expect(d[0]).toBe(3000)
  })

  test('reads at most 1 MB: an address past the cap is not seen', async () => {
    const body = 'x'.repeat(1_048_576 + 100) + ' late@a.com'
    const { fetchFn } = stub({ 'https://a.com/': { body } })
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: noSleep })).toBeNull()
    const early = stub({ 'https://a.com/': { body: 'early@a.com ' + 'x'.repeat(2_000_000) } })
    expect((await lookupContact('https://a.com/', { fetchFn: early.fetchFn, sleep: noSleep }))?.email).toBe('early@a.com')
  })

  test('times out a hung fetch and returns null', async () => {
    const fetchFn = ((_u: unknown, init?: RequestInit) => new Promise((_, rej) => { init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))) })) as typeof fetch
    expect(await lookupContact('https://a.com/', { fetchFn, sleep: noSleep, timeoutMs: 20 })).toBeNull()
  })

  test('treats a host and its www twin as the same site, both directions, but not other hosts', async () => {
    const up = stub({ 'https://a.com/': { status: 301, location: 'https://www.a.com/' }, 'https://www.a.com/': { body: 'x@a.com' } })
    expect(await lookupContact('https://a.com/', { fetchFn: up.fetchFn, sleep: noSleep })).toEqual({ email: 'x@a.com', sourceUrl: 'https://www.a.com/' })
    const down = stub({ 'https://www.a.com/': { status: 301, location: 'https://a.com/' }, 'https://a.com/': { body: 'x@a.com' } })
    expect((await lookupContact('https://www.a.com/', { fetchFn: down.fetchFn, sleep: noSleep }))?.email).toBe('x@a.com')
    const link = stub({ 'https://www.a.com/': { body: '<a href="https://a.com/contact">c</a>' }, 'https://a.com/contact': { body: 'y@a.com' } })
    expect((await lookupContact('https://www.a.com/', { fetchFn: link.fetchFn, sleep: noSleep }))?.sourceUrl).toBe('https://a.com/contact')
    const other = stub({ 'https://a.com/': { status: 302, location: 'https://wwwa.com/' }, 'https://wwwa.com/': { body: 'z@a.com' } })
    expect(await lookupContact('https://a.com/', { fetchFn: other.fetchFn, sleep: noSleep })).toBeNull()
    expect(other.calls).not.toContain('https://wwwa.com/')
  })
})

describe('hostile pages finish in linear time', () => {
  const MB = 1_048_576
  const hostile: Record<string, string> = {
    'run of <': '<'.repeat(MB),
    'run of <script>': '<script>'.repeat(Math.ceil(MB / 8)),
    'run of unclosed <!--': '<!--'.repeat(Math.ceil(MB / 4)),
    'run of unclosed <a ': '<a '.repeat(Math.ceil(MB / 3)),
    'run of <a href=" unclosed': '<a href="contact'.repeat(Math.ceil(MB / 17)),
    'run of <a> then late >': '<a '.repeat(Math.ceil(MB / 3) - 1) + '>',
    'run of mailto:': 'mailto:'.repeat(Math.ceil(MB / 7)),
    'run of @': '@'.repeat(MB),
    'long word run': 'x'.repeat(MB),
    'run of href + spaces': 'href'.padEnd(MB, ' '),
    'comment-hash robots-like': '#'.repeat(MB)
  }
  for (const [name, body] of Object.entries(hostile)) {
    test(`${name} returns within budget`, async () => {
      const { fetchFn } = stub({ 'https://a.com/': { body } })
      const t0 = Date.now()
      await lookupContact('https://a.com/', { fetchFn, sleep: noSleep })
      const ms = Date.now() - t0
      console.log(`hostile ${name}: ${ms} ms`)
      expect(ms).toBeLessThan(1500)
    })
  }

  test('a hostile robots.txt is also fast', async () => {
    const { fetchFn } = stub({ 'https://a.com/robots.txt': { type: 'text/plain', body: '#'.repeat(MB) }, 'https://a.com/': { body: 'a@a.com' } })
    const t0 = Date.now()
    expect((await lookupContact('https://a.com/', { fetchFn, sleep: noSleep }))?.email).toBe('a@a.com')
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})
