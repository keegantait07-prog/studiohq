// Studies top type-beat videos through the YouTube Data API and turns them into Style Profiles. Every call is metered against the research quota and cached.
import type Database from 'better-sqlite3'
import { looksLikeBeatMaker } from '../shared/leads'
import { buildStyleProfile } from '../shared/styleProfile'
import { COST, quotaAllows, rankByVelocity } from '../shared/ytQuota'
import type { StyleProfile, YtVideo } from '../shared/ytTypes'
import type { YtAuth } from './ytauth'
import { addQuota, quotaUsed } from './ytkv'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const WEEK = 7 * 86_400_000
const API = 'https://www.googleapis.com/youtube/v3/'
export const QUOTA_MESSAGE = 'Research quota for today is used up. Cached research still works.'

export interface SmallChannel { channelId: string; title: string; subs: number | null; description: string; lastUploadAt: number | null; url: string }

export class YtResearch {
  constructor(private db: Database.Database, private auth: YtAuth, private seeds: () => string[], private fetchFn: typeof fetch = fetch) {}

  quotaToday(): number {
    const u = quotaUsed(this.db)
    return u.research + u.upload
  }

  private cached<T>(key: string, maxAge: number, now: number): T | null {
    const r = this.db.prepare('SELECT json, fetched_at FROM yt_cache WHERE key=?').get(key) as Row | undefined
    return r && now - r.fetched_at < maxAge ? (JSON.parse(r.json) as T) : null
  }
  private store(key: string, v: unknown, now: number): void {
    this.db.prepare('INSERT INTO yt_cache(key,json,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at').run(key, JSON.stringify(v), now)
  }

  private async api(path: string, params: Record<string, string>, cost: number): Promise<Row> {
    if (!quotaAllows(quotaUsed(this.db), cost, 'research')) throw new Error(QUOTA_MESSAGE)
    const token = await this.auth.accessToken(this.fetchFn)
    addQuota(this.db, 'research', cost)
    const res = await this.fetchFn(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } })
    const j = (await res.json()) as Row
    if (!res.ok) {
      const reason = j.error?.errors?.[0]?.reason
      if (reason === 'quotaExceeded') throw new Error(QUOTA_MESSAGE)
      if (res.status === 401) throw new Error('Google sign-in expired. Sign in again.')
      throw new Error(`YouTube said: ${j.error?.message ?? res.status}`)
    }
    return j
  }

  private async details(ids: string[]): Promise<YtVideo[]> {
    if (!ids.length) return []
    const j = await this.api('videos', { part: 'snippet,statistics', id: ids.join(',') }, COST.list)
    return (j.items as Row[]).map((i): YtVideo => ({
      id: i.id, channelId: i.snippet.channelId, channelTitle: i.snippet.channelTitle, title: i.snippet.title,
      description: i.snippet.description ?? '', tags: i.snippet.tags ?? [], publishedAt: i.snippet.publishedAt, views: Number(i.statistics?.viewCount ?? 0)
    }))
  }

  /** Top "[artist] type beat" videos, fastest-growing first. */
  async discover(artist: string, now = Date.now()): Promise<YtVideo[]> {
    const key = `discover:${artist.toLowerCase()}`
    const hit = this.cached<YtVideo[]>(key, WEEK, now)
    if (hit) return hit
    const s = await this.api('search', { part: 'snippet', q: `${artist} type beat`, type: 'video', order: 'viewCount', maxResults: '25' }, COST.search)
    const vids = rankByVelocity(await this.details((s.items as Row[]).map((i) => i.id.videoId)), now).slice(0, 15)
    this.store(key, vids, now)
    return vids
  }

  /** Channels matching a search whose subscriber count is under maxSubs (or hidden). One search plus one channels.list, cached for a week. */
  /** Small artist channels, found through recent music videos (rappers upload videos; text-matching channel search mostly returns beat channels). */
  async smallChannels(query: string, maxSubs: number, now = Date.now(), days = 180): Promise<SmallChannel[]> {
    const key = `small2:${query.toLowerCase()}:${maxSubs}:${days}`
    const hit = this.cached<SmallChannel[]>(key, WEEK, now)
    if (hit) return hit
    const q = `${query.trim()} -beat -beats -instrumental -"type beat" -reaction -review -podcast`
    const s = await this.api('search', {
      part: 'snippet', q, type: 'video', videoCategoryId: '10', order: 'relevance', maxResults: '50',
      publishedAfter: new Date(now - days * 86_400_000).toISOString()
    }, COST.search)
    const latest = new Map<string, number>()
    for (const i of (s.items ?? []) as Row[]) {
      const id = i.snippet?.channelId as string | undefined
      if (!id || looksLikeBeatMaker(String(i.snippet?.title ?? ''))) continue
      const t = Date.parse(String(i.snippet?.publishedAt ?? ''))
      latest.set(id, Math.max(latest.get(id) ?? 0, Number.isNaN(t) ? 0 : t))
    }
    const ids = [...latest.keys()].slice(0, 50)
    let out: SmallChannel[] = []
    if (ids.length) {
      const c = await this.api('channels', { part: 'snippet,statistics', id: ids.join(',') }, COST.list)
      out = ((c.items ?? []) as Row[])
        .map((i): SmallChannel => ({
          channelId: i.id, title: i.snippet?.title ?? '', description: i.snippet?.description ?? '', lastUploadAt: latest.get(i.id) || null,
          subs: i.statistics?.hiddenSubscriberCount ? null : Number(i.statistics?.subscriberCount ?? 0),
          url: `https://www.youtube.com/channel/${i.id}`
        }))
        .filter((ch) => ch.subs === null || ch.subs < maxSubs)
    }
    this.store(key, out, now)
    return out
  }


  /** A name, @handle, YouTube URL or channel ID to a channel ID. Resolved once, then remembered. */
  async resolveChannel(entry: string, now = Date.now()): Promise<string | null> {
    const e = entry.trim()
    if (/^UC[\w-]{22}$/.test(e)) return e
    const key = `chan:${e.toLowerCase()}`
    const hit = this.cached<string | null>(key, Infinity, now)
    if (hit) return hit
    const u = e.match(/youtube\.com\/(@[\w.-]+|user\/[\w.-]+|channel\/(UC[\w-]{22}))/i)
    const handle = u?.[1].startsWith('@') ? u[1] : e.startsWith('@') ? e : null
    let id: string | null = null
    if (handle) id = ((await this.api('channels', { part: 'id', forHandle: handle }, COST.list)).items?.[0]?.id as string | undefined) ?? null
    else if (u?.[2]) id = u[2]
    else if (u) id = ((await this.api('channels', { part: 'id', forUsername: u[1].slice(5) }, COST.list)).items?.[0]?.id as string | undefined) ?? null
    else {
      const s = await this.api('search', { part: 'snippet', q: e, type: 'channel', maxResults: '5' }, COST.search)
      id = ((s.items as Row[]).find((i) => String(i.snippet.channelTitle).toLowerCase() === e.toLowerCase())?.id.channelId as string | undefined) ?? null
    }
    if (id) this.store(key, id, now)
    return id
  }

  /** Newest uploads of the seed channels, fastest-growing first. */
  async fromChannels(channels: string[], now = Date.now()): Promise<YtVideo[]> {
    const all: YtVideo[] = []
    for (const entry of channels) {
      const id = await this.resolveChannel(entry, now)
      if (!id) continue
      const key = `channel:${id}`
      let vids = this.cached<YtVideo[]>(key, WEEK, now)
      if (!vids) {
        const c = await this.api('channels', { part: 'contentDetails', id }, COST.list)
        const uploads = c.items?.[0]?.contentDetails?.relatedPlaylists?.uploads as string | undefined
        if (!uploads) continue
        const p = await this.api('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '25' }, COST.list)
        vids = await this.details((p.items as Row[]).map((i) => i.contentDetails.videoId))
        this.store(key, vids, now)
      }
      all.push(...vids)
    }
    return rankByVelocity(all, now)
  }

  private saved(scope: string, now: number): StyleProfile | null {
    const r = this.db.prepare('SELECT json, updated_at FROM yt_style WHERE scope=?').get(scope) as Row | undefined
    return r && now - r.updated_at < WEEK ? (JSON.parse(r.json) as StyleProfile) : null
  }
  private save(p: StyleProfile, now: number): StyleProfile {
    this.db.prepare('INSERT INTO yt_style(scope,json,updated_at) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at').run(p.scope, JSON.stringify(p), now)
    return p
  }

  /** The profile built from the seed channels. */
  async globalProfile(now = Date.now()): Promise<StyleProfile> {
    return this.saved('global', now) ?? this.save(buildStyleProfile(await this.fromChannels(this.seeds(), now), 'global'), now)
  }

  /** The artist's own profile, or the global one when the artist has too little research or the quota is spent. */
  async profileFor(artist: string, now = Date.now()): Promise<StyleProfile> {
    const scope = artist.trim().toLowerCase()
    const hit = scope ? this.saved(scope, now) : null
    if (hit) return hit
    if (scope) {
      try {
        const vids = await this.discover(scope, now)
        if (vids.length >= 3) return this.save(buildStyleProfile(vids, scope), now)
      } catch (e) {
        if ((e as Error).message !== QUOTA_MESSAGE) throw e
      }
    }
    return this.globalProfile(now)
  }
}
