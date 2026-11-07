// Audiomack: small artist accounts from the official artist search. Needs an API key the user connects in Settings.
import { extractEmails, type LeadCandidate } from '../../../shared/leads'
import { asRecords, keyedGet, MAX_RESULTS, str } from './http'
import { type LeadSourceModule, type SourceCtx } from './types'

const MAX_FOLLOWERS = 5000

export const audiomackSource: LeadSourceModule = {
  id: 'audiomack',
  async search(query: string, ctx: SourceCtx): Promise<LeadCandidate[]> {
    const url = `https://api.audiomack.com/v1/search?${new URLSearchParams({ q: query.trim() || 'trap rapper', show: 'artists', limit: String(MAX_RESULTS) })}`
    const body = await keyedGet('Audiomack', url, (k) => `Bearer ${k}`, 'lead_key_audiomack', ctx)
    const out: LeadCandidate[] = []
    for (const a of asRecords((body as { results?: unknown } | null)?.results)) {
      const n = a.followers_count ?? a.followers
      const slug = str(a.url_slug)
      if (typeof n !== 'number' || n >= MAX_FOLLOWERS || !slug) continue
      const url = `https://audiomack.com/${encodeURIComponent(slug)}`
      const bio = str(a.bio)
      const emails = extractEmails(bio)
      out.push({
        source: 'audiomack', sourceId: slug, name: str(a.name) || slug, url, followers: n, lastActiveAt: null,
        genre: str(a.genre), bio: bio.slice(0, 300), signals: [], email: emails[0] ?? '', emailSourceUrl: emails.length ? url : ''
      })
      if (out.length >= MAX_RESULTS) break
    }
    return out
  }
}
