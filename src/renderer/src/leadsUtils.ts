import { GENRE_TAGS, type Lead, type LeadRole, type LeadSize, type LeadSource, type LeadStatus } from '@shared/leads'

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

export const SIZE_LABEL: Record<LeadSize, string> = { big: 'Big artists', small: 'Small artists', team: 'Team and gatekeepers' }
export const SIZE_HINT: Record<LeadSize, string> = {
  big: 'Headliners. Work through the people around them.',
  small: 'Up-and-coming. The easiest to land and the way up.',
  team: 'Managers, engineers, A&Rs and media. Go through them first.'
}
export const ROLE_LABEL: Record<LeadRole, string> = { artist: 'Artist', manager: 'Manager', engineer: 'Engineer', 'a&r': 'A&R', media: 'Media', producer: 'Producer', label: 'Label' }

/** Where the list is looking: everything, one size, one genre, or one ladder (the artist whose circle the lead belongs to). */
export type LeadView = { t: 'all' } | { t: 'size'; k: LeadSize } | { t: 'genre'; k: string } | { t: 'ladder'; k: string }
export type EmailTab = 'all' | 'email' | 'dm'

export function inView(l: Lead, v: LeadView): boolean {
  return v.t === 'all' || (v.t === 'size' ? l.size === v.k : v.t === 'genre' ? l.genres.includes(v.k) : l.ladder === v.k)
}
export const hasEmail = (l: Lead) => l.email !== ''
export function matchesText(l: Lead, q: string): boolean {
  const t = q.trim().toLowerCase()
  return !t || [l.name, l.handle, l.email, l.ladder, l.note, ...l.moreEmails].some((x) => x.toLowerCase().includes(t))
}
/** Genres with at least one lead, in the sidebar order, plus anything a lead names that is not a standard tag. */
export function genreCounts(leads: Lead[]): [string, number][] {
  const n = new Map<string, number>()
  for (const l of leads) for (const g of l.genres) n.set(g, (n.get(g) ?? 0) + 1)
  const order = [...GENRE_TAGS] as string[]
  return [...n.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99) || b[1] - a[1])
}
export function ladderCounts(leads: Lead[]): [string, number][] {
  const n = new Map<string, number>()
  for (const l of leads) if (l.ladder) n.set(l.ladder, (n.get(l.ladder) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
export type LeadGroup = { title: string; hint: string; leads: Lead[] }
/** A size view splits by main genre. Every other view splits by size, big first. */
export function groupLeads(leads: Lead[], v: LeadView): LeadGroup[] {
  if (v.t === 'size') {
    const m = new Map<string, Lead[]>()
    for (const l of leads) { const g = l.genres[0] ?? 'No genre yet'; m.set(g, [...(m.get(g) ?? []), l]) }
    return [...m.entries()].map(([title, ls]) => ({ title, hint: '', leads: ls }))
  }
  return (['big', 'small', 'team'] as const).map((k) => ({ title: SIZE_LABEL[k], hint: SIZE_HINT[k], leads: leads.filter((l) => l.size === k) })).filter((g) => g.leads.length)
}
