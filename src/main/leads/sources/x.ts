// X: recent posts asking for beats or a producer, one candidate per author. Needs a paid API bearer token from the user.
import { extractEmails, type LeadCandidate } from '../../../shared/leads'
import { asRecords, keyedGet, MAX_RESULTS, str } from './http'
import { type LeadSourceModule, type SourceCtx } from './types'

const BASE = '"need beats" OR "looking for a producer"'

export const xSource: LeadSourceModule = {
  id: 'x',
  async search(query: string, ctx: SourceCtx): Promise<LeadCandidate[]> {
    const terms = query.trim()
    const q = `(${BASE})${terms ? ` ${terms}` : ''} -is:retweet`
    const url = `https://api.x.com/2/tweets/search/recent?${new URLSearchParams({
      query: q, max_results: String(MAX_RESULTS), expansions: 'author_id', 'tweet.fields': 'created_at',
      'user.fields': 'username,name,description,public_metrics'
    })}`
    const body = (await keyedGet('X', url, (k) => `Bearer ${k}`, 'lead_key_x', ctx)) as { data?: unknown; includes?: { users?: unknown } } | null
    const users = new Map(asRecords(body?.includes?.users).map((u) => [str(u.id), u]))
    const seen = new Set<string>()
    const out: LeadCandidate[] = []
    for (const t of asRecords(body?.data)) {
      const author = str(t.author_id)
      const u = users.get(author)
      const handle = str(u?.username)
      if (!u || !handle || seen.has(author)) continue
      seen.add(author)
      const url = `https://x.com/${encodeURIComponent(handle)}`
      const f = (u.public_metrics as { followers_count?: unknown } | undefined)?.followers_count
      const bio = str(u.description)
      const emails = extractEmails(bio)
      out.push({
        source: 'x', sourceId: handle, name: str(u.name) || handle, url, followers: typeof f === 'number' ? f : null,
        lastActiveAt: Date.parse(str(t.created_at)) || null, genre: '', bio: (bio || str(t.text)).slice(0, 300),
        signals: ['asks_for_beats'], email: emails[0] ?? '', emailSourceUrl: emails.length ? url : ''
      })
      if (out.length >= MAX_RESULTS) break
    }
    return out
  }
}
