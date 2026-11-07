// Reddit: people asking for beats or producers in a few music subreddits. Best-effort, public JSON endpoint, no login.
import type { LeadCandidate } from '../../../shared/leads'
import { SourceError, type LeadSourceModule, type SourceCtx } from './types'

const SUBS = 'MusicProducers+makinghiphop+beatsforsale'
const MAX_POSTS = 50
const LIMIT_MESSAGE = 'Reddit is limiting requests right now. Try again later.'
const SKIP_AUTHORS = new Set(['[deleted]', 'AutoModerator'])

export const redditSource: LeadSourceModule = {
  id: 'reddit',
  async search(query: string, ctx: SourceCtx): Promise<LeadCandidate[]> {
    const q = query.trim() || 'looking for beats'
    const url = `https://www.reddit.com/r/${SUBS}/search.json?${new URLSearchParams({ q, restrict_sr: '1', sort: 'new', limit: String(MAX_POSTS) })}`
    let res: Response
    try {
      res = await ctx.fetchFn(url, { headers: { 'User-Agent': 'StudioHQ/1.0 (lead finder)', Accept: 'application/json' } })
    } catch {
      throw new SourceError('Could not reach Reddit. Check your connection and try again.')
    }
    if (res.status === 403 || res.status === 429) throw new SourceError(LIMIT_MESSAGE)
    if (!res.ok) throw new SourceError(`Reddit returned an error (${res.status}). Try again later.`)
    let posts: Array<{ data?: Record<string, unknown> }>
    try {
      posts = ((await res.json()) as { data?: { children?: Array<{ data?: Record<string, unknown> }> } }).data?.children ?? []
    } catch {
      throw new SourceError('Reddit sent a reply Studio HQ could not read. Try again later.')
    }
    const seen = new Set<string>()
    const out: LeadCandidate[] = []
    for (const p of posts.slice(0, MAX_POSTS)) {
      const d = p.data
      const author = typeof d?.author === 'string' ? d.author : ''
      if (!author || SKIP_AUTHORS.has(author) || seen.has(author.toLowerCase())) continue
      seen.add(author.toLowerCase())
      const created = typeof d?.created_utc === 'number' ? d.created_utc * 1000 : null
      out.push({
        source: 'reddit', sourceId: author, name: author,
        url: `https://www.reddit.com${String(d?.permalink ?? `/user/${author}`)}`,
        followers: null, lastActiveAt: created, genre: '',
        bio: String(d?.title ?? '').slice(0, 300), signals: ['asks_for_beats'], email: '', emailSourceUrl: ''
      })
    }
    return out
  }
}
