// Fixtures here are hand-written from each service's documented response shape, not captured from live APIs.
import { describe, expect, it } from 'vitest'
import sc from './__fixtures__/soundcloud-users.json'
import am from './__fixtures__/audiomack-search.json'
import xf from './__fixtures__/x-recent-search.json'
import { soundcloudSource } from './soundcloud'
import { audiomackSource } from './audiomack'
import { xSource } from './x'
import { SOURCES } from './index'
import { SourceError, type LeadSourceModule, type SourceCtx } from './types'

const KEY = 'sekret-key-123'
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
const ctx = (fetchFn: typeof fetch, key: string | null = KEY): SourceCtx => ({ fetchFn, getKey: (n) => (key ? (n.startsWith('lead_key_') ? key : null) : null), now: 0 })

const cases: Array<[string, LeadSourceModule, unknown, string]> = [
  ['SoundCloud', soundcloudSource, sc, 'lead_key_soundcloud'],
  ['Audiomack', audiomackSource, am, 'lead_key_audiomack'],
  ['X', xSource, xf, 'lead_key_x']
]

describe.each(cases)('%s', (label, mod, fixture, keyName) => {
  it('asks for a key when none is saved, without calling the network', async () => {
    let calls = 0
    const f = (async () => { calls++; return new Response('{}') }) as unknown as typeof fetch
    await expect(mod.search('x', ctx(f, null))).rejects.toThrow(new SourceError(`Connect ${label} in Settings to search it.`))
    expect(calls).toBe(0)
  })
  it('reads the key under its own name and keeps it out of the URL and the results', async () => {
    const asked: string[] = []
    let url = ''
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify(fixture)) }) as unknown as typeof fetch
    const out = await mod.search('trap', { fetchFn: f, getKey: (n) => { asked.push(n); return KEY }, now: 0 })
    expect(asked).toEqual([keyName])
    expect(url).not.toContain(KEY)
    expect(JSON.stringify(out)).not.toContain(KEY)
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((c) => c.source === mod.id)).toBe(true)
  })
  it('maps 401/403 to a key message, 429 to retry later, other failures to SourceError, no retries', async () => {
    for (const [status, re] of [[401, /Check your .* key in Settings\./], [403, /Check your .* key in Settings\./], [429, /Retry later/], [500, /Retry later/]] as const) {
      let calls = 0
      const f = (async () => { calls++; return new Response('', { status }) }) as unknown as typeof fetch
      await expect(mod.search('x', ctx(f))).rejects.toBeInstanceOf(SourceError)
      expect(calls).toBe(1)
      await expect(mod.search('x', ctx(f))).rejects.toThrow(re)
    }
    const boom = (async () => { throw new Error(`down ${KEY}`) }) as unknown as typeof fetch
    const e = await mod.search('x', ctx(boom)).catch((x) => x)
    expect(e).toBeInstanceOf(SourceError)
    expect(e.message).not.toContain(KEY)
    const bad = (async () => new Response('not json')) as unknown as typeof fetch
    await expect(mod.search('x', ctx(bad))).rejects.toBeInstanceOf(SourceError)
  })
  it('returns [] for an empty reply and is registered', async () => {
    expect(await mod.search('x', ctx(reply({})))).toEqual([])
    expect(SOURCES[mod.id]).toBe(mod)
  })
})

describe('soundcloudSource', () => {
  it('keeps only accounts under 5,000 followers and uses emails only from the bio', async () => {
    const out = await soundcloudSource.search('trap', ctx(reply(sc)))
    expect(out.map((c) => c.sourceId)).toEqual(['novakid', 'quietmc'])
    expect(out[0]).toMatchObject({ followers: 1800, email: 'nova@novakid.com', emailSourceUrl: 'https://soundcloud.com/novakid' })
    expect(out[1]).toMatchObject({ email: '', emailSourceUrl: '' })
  })
  it('builds the query with URLSearchParams', async () => {
    let url = ''
    const f = (async (u: string) => { url = u; return new Response('[]') }) as unknown as typeof fetch
    await soundcloudSource.search('a&b=c d', ctx(f))
    expect(new URL(url).searchParams.get('q')).toBe('a&b=c d')
  })
})

describe('audiomackSource', () => {
  it('keeps only accounts under 5,000 followers', async () => {
    const out = await audiomackSource.search('trap', ctx(reply(am)))
    expect(out.map((c) => c.sourceId)).toEqual(['kiddrift', 'lowkey'])
    expect(out[0]).toMatchObject({ url: 'https://audiomack.com/kiddrift', genre: 'hip-hop', email: 'drift@kiddrift.com', emailSourceUrl: 'https://audiomack.com/kiddrift' })
  })
})

describe('xSource', () => {
  it('yields one asks_for_beats candidate per author; followers null unless public_metrics is given', async () => {
    const out = await xSource.search('', ctx(reply(xf)))
    expect(out.map((c) => c.sourceId)).toEqual(['lilnova', 'drillgirl'])
    expect(out.every((c) => c.signals.join() === 'asks_for_beats')).toBe(true)
    expect(out[0]).toMatchObject({ followers: 1200, url: 'https://x.com/lilnova', email: 'nova@lilnova.com', emailSourceUrl: 'https://x.com/lilnova' })
    expect(out[1]).toMatchObject({ followers: null, email: '' })
  })
  it('searches the beat phrases plus the user terms, through URLSearchParams', async () => {
    let url = ''
    const f = (async (u: string) => { url = u; return new Response('{}') }) as unknown as typeof fetch
    await xSource.search('drill', ctx(f))
    const q = new URL(url).searchParams.get('query') as string
    expect(q).toContain('"need beats" OR "looking for a producer"')
    expect(q).toContain('drill')
    await xSource.search('', ctx(f))
    expect(new URL(url).searchParams.get('query')).toContain('"need beats"')
  })
})
