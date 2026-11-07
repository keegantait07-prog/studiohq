import type { Lead, LeadSource, LeadStatus } from '@shared/leads'

export const SOURCE_LABEL: Record<LeadSource, string> = {
  youtube: 'YouTube', soundcloud: 'SoundCloud', audiomack: 'Audiomack', reddit: 'Reddit', x: 'X', manual: 'Added by you'
}
export const STATUS_LABEL: Record<LeadStatus, string> = { new: 'new', saved: 'saved', in_crm: 'in CRM', skipped: 'skipped' }

/** The filter row. `status: 'active'` hides skipped leads; the store filters one status at a time, so that one is applied here. */
export interface LeadFilterUi {
  source: LeadSource | 'all'
  minScore: number
  hasEmail: boolean
  status: LeadStatus | 'active' | 'all'
}
export const DEFAULT_FILTER: LeadFilterUi = { source: 'all', minScore: 0, hasEmail: false, status: 'active' }
export const isDefaultFilter = (f: LeadFilterUi) =>
  f.source === DEFAULT_FILTER.source && f.minScore === DEFAULT_FILTER.minScore && f.hasEmail === DEFAULT_FILTER.hasEmail && f.status === DEFAULT_FILTER.status

export function apiFilter(f: LeadFilterUi): { source?: LeadSource; minScore?: number; hasEmail?: boolean; status?: LeadStatus } {
  const out: { source?: LeadSource; minScore?: number; hasEmail?: boolean; status?: LeadStatus } = {}
  if (f.source !== 'all') out.source = f.source
  if (f.minScore > 0) out.minScore = f.minScore
  if (f.hasEmail) out.hasEmail = true
  if (f.status !== 'all' && f.status !== 'active') out.status = f.status
  return out
}
export const visibleLeads = (leads: Lead[], f: LeadFilterUi) => (f.status === 'active' ? leads.filter((l) => l.status !== 'skipped') : leads)

export type ScoreBand = 'strong' | 'ok' | 'weak'
export const scoreBand = (score: number): ScoreBand => (score >= 70 ? 'strong' : score >= 45 ? 'ok' : 'weak')

export function fmtFollowers(n: number | null): string {
  if (n == null) return 'n/a'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${+(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${+(n / 1_000_000).toFixed(1)}M`
}

/** "Small, up-and-coming audience (+25)" → "Small, up-and-coming audience" for the compact row line. */
export const reasonText = (r: string) => r.replace(/\s*\([+-]?\d+\)\s*$/, '')

/** Where an email came from, in words: "added by you", "from channel About", or "from <site>". */
export function emailSourceLabel(email: string, src: string): string {
  if (!email) return ''
  const s = src.trim()
  if (!s || s === 'added by you') return 'added by you'
  try {
    const u = new URL(s)
    if (/youtube\.com$/i.test(u.hostname) && /\/about\/?$/i.test(u.pathname)) return 'from channel About'
    return `from ${u.hostname.replace(/^www\./, '')}`
  } catch {
    return `from ${s}`
  }
}

/** Selected leads that still need a contact. Leads already in the CRM, or already linked to a contact, are never promoted again. */
export const toPromote = (leads: Lead[], ids: Set<number>) => leads.filter((l) => ids.has(l.id) && l.status !== 'in_crm' && l.contactId == null)
