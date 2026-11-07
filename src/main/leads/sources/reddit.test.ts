import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/reddit-search.json'
import { redditSource } from './reddit'
import { SOURCES } from './index'
import { SourceError, type SourceCtx } from './types'

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
const ctx = (fetchFn: typeof fetch): SourceCtx => ({ fetchFn, getKey: () => null, now: 0 })

describe('redditSource', () => {
  it('yields one candidate per distinct author with the asks_for_beats signal', async () => {
    const out = await redditSource.search('looking for beats', ctx(reply(fixture)))
    expect(out.map((c) => c.sourceId)).toEqual(['lilnova', 'mc_river'])
    expect(out.every((c) => c.source === 'reddit' && c.followers === null && c.signals.includes('asks_for_beats'))).toBe(true)
    expect(out[0].url).toBe('https://www.reddit.com/r/MusicProducers/comments/abc1/looking_for_beats/')
    expect(out[0].email).toBe('')
  })
  it('returns [] for an empty result', async () => {
    expect(await redditSource.search('x', ctx(reply({ data: { children: [] } })))).toEqual([])
  })
  it('raises a retry message on 429 and 403, without retrying', async () => {
    for (const status of [429, 403]) {
      let calls = 0
      const f = (async () => { calls++; return new Response('', { status }) }) as unknown as typeof fetch
      await expect(redditSource.search('x', ctx(f))).rejects.toBeInstanceOf(SourceError)
      await expect(redditSource.search('x', ctx(f))).rejects.toThrow(/Try again later/)
      expect(calls).toBe(2)
    }
  })
  it('sends a generic User-Agent and is registered', async () => {
    let ua = ''
    const f = (async (_u: string, init: RequestInit) => { ua = (init.headers as Record<string, string>)['User-Agent']; return new Response(JSON.stringify(fixture)) }) as unknown as typeof fetch
    await redditSource.search('x', ctx(f))
    expect(ua).toBe('StudioHQ/1.0 (lead finder)')
    expect(SOURCES.reddit).toBe(redditSource)
  })
})
