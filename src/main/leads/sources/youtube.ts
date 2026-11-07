// YouTube: small channels whose public description matches the search. Only emails written in the description are used.
import { extractEmails, type LeadCandidate } from '../../../shared/leads'
import { QUOTA_MESSAGE, type YtResearch } from '../../ytresearch'
import { SourceError, type LeadSourceModule, type SourceCtx } from './types'

const MAX_SUBS = 50_000
const ASKS = /need(ing)? beats|looking for (a )?(producer|beats)/i

export function youtubeSource(research: Pick<YtResearch, 'smallChannels'>): LeadSourceModule {
  return {
    id: 'youtube',
    async search(query: string, ctx: SourceCtx): Promise<LeadCandidate[]> {
      let channels: Awaited<ReturnType<YtResearch['smallChannels']>>
      try {
        channels = await research.smallChannels(query.trim() || 'rapper new music', MAX_SUBS, ctx.now)
      } catch (e) {
        const m = e instanceof Error ? e.message : ''
        if (m === QUOTA_MESSAGE || m.startsWith('YouTube said:')) throw new SourceError(m)
        if (m.startsWith('Sign in to Google')) throw new SourceError('Connect your Google account in Settings to search YouTube.')
        if (m.startsWith('Google sign-in expired')) throw new SourceError(m)
        throw e
      }
      return channels.map((c) => ({
        source: 'youtube' as const, sourceId: c.channelId, name: c.title, url: c.url,
        followers: c.subs, lastActiveAt: c.lastUploadAt, genre: '', bio: c.description.slice(0, 300),
        signals: ASKS.test(c.description) ? ['asks_for_beats'] : [],
        email: extractEmails(c.description)[0] ?? '', emailSourceUrl: extractEmails(c.description).length ? c.url : ''
      }))
    }
  }
}
