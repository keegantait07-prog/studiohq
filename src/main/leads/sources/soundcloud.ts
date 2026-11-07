// SoundCloud: small artist accounts from the official user search. Needs an API token the user connects in Settings.
import { extractEmails, type LeadCandidate } from '../../../shared/leads'
import { asRecords, keyedGet, MAX_RESULTS, str } from './http'
import { type LeadSourceModule, type SourceCtx } from './types'

const MAX_FOLLOWERS = 5000

export const soundcloudSource: LeadSourceModule = {
  id: 'soundcloud',
  async search(query: string, ctx: SourceCtx): Promise<LeadCandidate[]> {
    const url = `https://api.soundcloud.com/users?${new URLSearchParams({ q: query.trim() || 'trap rapper', limit: String(MAX_RESULTS) })}`
    const users = asRecords(await keyedGet('SoundCloud', url, (k) => `OAuth ${k}`, 'lead_key_soundcloud', ctx))
    const out: LeadCandidate[] = []
    for (const u of users) {
      const followers = typeof u.followers_count === 'number' ? u.followers_count : null
      const link = str(u.permalink_url)
      if (followers === null || followers >= MAX_FOLLOWERS || !link) continue
      const bio = str(u.description)
      const emails = extractEmails(bio)
      out.push({
        source: 'soundcloud', sourceId: str(u.permalink) || String(u.id ?? ''), name: str(u.username) || str(u.permalink),
        url: link, followers, lastActiveAt: Date.parse(str(u.last_modified)) || null, genre: '', bio: bio.slice(0, 300),
        signals: [], email: emails[0] ?? '', emailSourceUrl: emails.length ? link : ''
      })
      if (out.length >= MAX_RESULTS) break
    }
    return out.filter((c) => c.sourceId)
  }
}
