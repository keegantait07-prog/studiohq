import { parseCsv, parseHandles, type LeadCandidate } from '../../shared/leads'

/** Turns pasted text (profile links/handles, or a CSV) into candidates ready for Leads.addCandidates. */
export function importCandidates(text: string, kind: 'handles' | 'csv'): LeadCandidate[] {
  if (kind === 'csv') return parseCsv(text)
  return parseHandles(text).map((h) => ({
    source: h.source,
    sourceId: h.sourceId,
    name: h.sourceId,
    url: h.url,
    followers: null,
    lastActiveAt: null,
    genre: '',
    bio: '',
    signals: [],
    email: '',
    emailSourceUrl: ''
  }))
}
