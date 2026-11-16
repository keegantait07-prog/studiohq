import type { Lead } from '@shared/leads'
import { startOfDay, type MadePeriod } from './dashUtils'

export type LeadMetric = 'added' | 'contacted'

/** A lead counts as contacted once it has been moved into Pitch CRM. */
export const isContacted = (l: Lead): boolean => l.status === 'in_crm' || l.contactId != null

/**
 * Leads added (by the day they were found), or the ones since moved into Pitch CRM, per day (last 7 or 30 days) or per month (last 12).
 * Leads carry no "contacted at" time, so contacted ones are placed on the day they were added. Skipped leads are left out of both.
 * Feeds the Leads Peak Chart.
 */
export function leadsSeries(leads: Lead[], metric: LeadMetric, period: MadePeriod, now: number): { data: number[]; labels: string[] } {
  const today = new Date(startOfDay(now))
  const starts: Date[] =
    period === 'Yearly'
      ? Array.from({ length: 12 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1))
      : Array.from({ length: period === 'Weekly' ? 7 : 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period === 'Weekly' ? 6 : 29) + i))
  const data = starts.map(() => 0)
  for (const l of leads) {
    if (l.status === 'skipped') continue
    if (metric === 'contacted' && !isContacted(l)) continue
    const t = l.createdAt
    if (t > now) continue
    for (let i = starts.length - 1; i >= 0; i--) if (t >= starts[i].getTime()) { data[i]++; break }
  }
  const fmt: Intl.DateTimeFormatOptions = period === 'Yearly' ? { month: 'short' } : period === 'Weekly' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }
  return { data, labels: starts.map((d) => d.toLocaleDateString(undefined, fmt)) }
}
