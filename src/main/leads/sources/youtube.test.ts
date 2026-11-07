import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/youtube-search.json'
import { youtubeSource } from './youtube'
import { SourceError, type SourceCtx } from './types'
import { QUOTA_MESSAGE, YtResearch, type SmallChannel } from '../../ytresearch'
import { openDb } from '../../db'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ctx: SourceCtx = { fetchFn: fetch, getKey: () => null, now: 1_762_000_000_000 }
const url = (id: string): string => `https://www.youtube.com/channel/${id}`
const chans: SmallChannel[] = [
  { channelId: 'UCa', title: 'Nova Kid', subs: 1800, description: 'Looking for beats! nova@novakid.com', lastUploadAt: null, url: url('UCa') },
  { channelId: 'UCb', title: 'No Contact', subs: null, description: 'New artist. DM me.', lastUploadAt: null, url: url('UCb') }
]

describe('youtubeSource', () => {
  it('maps channels to candidates, using only emails in the description', async () => {
    const out = await youtubeSource({ smallChannels: async () => chans }).search('trap', ctx)
    expect(out[0]).toMatchObject({ source: 'youtube', sourceId: 'UCa', email: 'nova@novakid.com', emailSourceUrl: url('UCa'), followers: 1800, signals: ['asks_for_beats'] })
    expect(out[1]).toMatchObject({ email: '', emailSourceUrl: '', followers: null, signals: [] })
  })
  it('returns [] when nothing matches', async () => {
    expect(await youtubeSource({ smallChannels: async () => [] }).search('x', ctx)).toEqual([])
  })
  it('surfaces quota exhaustion and signed-out state as SourceError', async () => {
    const quota = youtubeSource({ smallChannels: async () => { throw new Error(QUOTA_MESSAGE) } })
    await expect(quota.search('x', ctx)).rejects.toThrow(new SourceError(QUOTA_MESSAGE))
    const out = youtubeSource({ smallChannels: async () => { throw new Error('Sign in to Google in Settings first.') } })
    await expect(out.search('x', ctx)).rejects.toBeInstanceOf(SourceError)
    await expect(out.search('x', ctx)).rejects.toThrow(/Connect your Google account/)
  })
})

describe('youtubeSource options', () => {
  it('passes the preset subscriber cap and recency window to the search', async () => {
    const seen: unknown[][] = []
    const src = youtubeSource({ smallChannels: async (...a: unknown[]) => { seen.push(a); return [] } } as never)
    await src.search('uk drill rapper freestyle', { ...ctx, opts: { maxSubs: 10_000, days: 90 } })
    expect(seen[0]).toEqual(['uk drill rapper freestyle', 10_000, ctx.now, 90])
    await src.search('x', ctx)
    expect(seen[1]).toEqual(['x', 50_000, ctx.now, 180])
  })
})

describe('YtResearch.smallChannels', () => {
  const make = (calls: string[]) => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'shq-yt-')))
    const auth = { accessToken: async () => 'tok' } as never
    const f = (async (u: string) => {
      calls.push(u)
      return new Response(JSON.stringify(u.includes('/search?') ? fixture.search : fixture.channels), { status: 200 })
    }) as unknown as typeof fetch
    return new YtResearch(db, auth, () => [], f)
  }
  const NOW = Date.parse('2026-11-07T00:00:00Z')
  it('keeps small and hidden-subs channels, meters two calls, and caches', async () => {
    const calls: string[] = []
    const r = make(calls)
    const out = await r.smallChannels('trap rapper', 50_000, NOW)
    expect(out.map((c) => c.channelId)).toEqual(['UCaaaaaaaaaaaaaaaaaaaaaa', 'UCcccccccccccccccccccccc'])
    expect(out[1].subs).toBeNull()
    expect(calls).toHaveLength(2)
    expect(r.quotaToday()).toBe(101)
    await r.smallChannels('trap rapper', 50_000, NOW + 1000)
    expect(calls).toHaveLength(2)
  })
  it('finds artists through their music videos, not by matching channel text', async () => {
    const calls: string[] = []
    await make(calls).smallChannels('drill rapper london', 50_000, NOW)
    const search = new URL(calls[0])
    expect(search.searchParams.get('type')).toBe('video')
    expect(search.searchParams.get('videoCategoryId')).toBe('10')
    expect(search.searchParams.get('publishedAfter')).toBe(new Date(NOW - 180 * 86_400_000).toISOString())
    const q = search.searchParams.get('q') ?? ''
    expect(q).toContain('drill rapper london')
    expect(q).toMatch(/-"?type beat"?/)
    expect(q).toMatch(/-beats?\b/)
  })
  it('honours the recency window and subscriber cap, and keeps them apart in the cache', async () => {
    const calls: string[] = []
    const r = make(calls)
    const out = await r.smallChannels('drill', 1000, NOW, 90)
    expect(new URL(calls[0]).searchParams.get('publishedAfter')).toBe(new Date(NOW - 90 * 86_400_000).toISOString())
    expect(out.map((c) => c.channelId)).toEqual(['UCcccccccccccccccccccccc'])
    await r.smallChannels('drill', 1000, NOW, 30)
    expect(calls).toHaveLength(4)
  })
  it('excludes reaction, review and podcast uploads as well as beats', async () => {
    const calls: string[] = []
    await make(calls).smallChannels('drill', 50_000, NOW)
    const q = new URL(calls[0]).searchParams.get('q') ?? ''
    for (const w of ['-reaction', '-review', '-podcast']) expect(q).toContain(w)
  })
  it('never looks up channels whose only matching video is a beat upload, and reports the latest upload', async () => {
    const calls: string[] = []
    const out = await make(calls).smallChannels('drill', 50_000, NOW)
    const ids = new URL(calls[1]).searchParams.get('id') ?? ''
    expect(ids).not.toContain('UCdddddddddddddddddddddd')
    expect(ids.split(',')).toHaveLength(3)
    expect(out.find((c) => c.channelId === 'UCaaaaaaaaaaaaaaaaaaaaaa')?.lastUploadAt).toBe(Date.parse('2026-11-01T12:00:00Z'))
  })
})

describe('youtubeSource beat-maker filter', () => {
  const mk = (over: Partial<SmallChannel>): SmallChannel => ({ channelId: 'UCx', title: 'X', subs: 100, description: '', lastUploadAt: null, url: url('UCx'), ...over })
  it('drops channels that look like producers and keeps rappers', async () => {
    const list = [
      mk({ channelId: 'UC1', title: 'Nova Kid', description: 'Rapper from London. New single out now.' }),
      mk({ channelId: 'UC2', title: 'Dark Beats', description: 'Free type beats for rappers. Beats for sale: buy at example.com' }),
      mk({ channelId: 'UC3', title: 'Metro Type Beats', description: 'Daily uploads' }),
      mk({ channelId: 'UC4', title: 'Kay Rivers', description: 'Rapper and producer from Atlanta.' }),
      mk({ channelId: 'UC5', title: 'LowKey Producer', description: 'Hip hop' })
    ]
    const out = await youtubeSource({ smallChannels: async () => list }).search('drill', ctx)
    expect(out.map((c) => c.sourceId)).toEqual(['UC1', 'UC4'])
  })
})
