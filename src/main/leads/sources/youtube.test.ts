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
  it('keeps small and hidden-subs channels, meters two calls, and caches', async () => {
    const calls: string[] = []
    const r = make(calls)
    const out = await r.smallChannels('trap rapper', 50_000, 1000)
    expect(out.map((c) => c.channelId)).toEqual(['UCaaaaaaaaaaaaaaaaaaaaaa', 'UCcccccccccccccccccccccc'])
    expect(out[1].subs).toBeNull()
    expect(calls).toHaveLength(2)
    expect(r.quotaToday()).toBe(101)
    await r.smallChannels('trap rapper', 50_000, 2000)
    expect(calls).toHaveLength(2)
  })
})
