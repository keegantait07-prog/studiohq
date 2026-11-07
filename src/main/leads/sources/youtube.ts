// YouTube: small artist channels found through their recent music videos (channel text search mostly returns beat channels). Only emails written in the description are used.
import { asksForBeats, extractEmails, looksLikeBeatMaker, type LeadCandidate } from '../../../shared/leads'
import { QUOTA_MESSAGE, type YtResearch } from '../../ytresearch'
import { SourceError, type LeadSourceModule, type SourceCtx } from './types'

const MAX_SUBS = 50_000
/** A channel named for beats or production, or whose own text advertises beats, is a producer, not an artist. */
const PRODUCER_NAME = /\b(?:beats?|producers?|beat[\s-]*makers?)\b/i
const isProducerChannel = (c: { title: string; description: string }): boolean =>
  PRODUCER_NAME.test(c.title.slice(0, 200)) || looksLikeBeatMaker(c.title) || looksLikeBeatMaker(c.description)

export function youtubeSource(research: Pick<YtResearch, 'smallChannels'>): LeadSourceModule {
  return {
    id: 'youtube',
    async search(query: string, ctx: SourceCtx): Promise<LeadCandidate[]> {
      let channels: Awaited<ReturnType<YtResearch['smallChannels']>>
      try {
        channels = await research.smallChannels(query.trim() || 'rapper', MAX_SUBS, ctx.now)
      } catch (e) {
        const m = e instanceof Error ? e.message : ''
        if (m === QUOTA_MESSAGE || m.startsWith('YouTube said:')) throw new SourceError(m)
        if (m.startsWith('Sign in to Google')) throw new SourceError('Connect your Google account in Settings to search YouTube.')
        if (m.startsWith('Google sign-in expired')) throw new SourceError(m)
        throw e
      }
      return channels.filter((c) => !isProducerChannel(c)).map((c) => ({
        source: 'youtube' as const, sourceId: c.channelId, name: c.title, url: c.url,
        followers: c.subs, lastActiveAt: c.lastUploadAt, genre: '', bio: c.description.slice(0, 300),
        signals: asksForBeats(c.description) ? ['asks_for_beats'] : [],
        email: extractEmails(c.description)[0] ?? '', emailSourceUrl: extractEmails(c.description).length ? c.url : ''
      }))
    }
  }
}
