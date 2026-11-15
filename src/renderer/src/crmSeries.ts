import type { Pitch } from '@shared/types'
import { startOfDay, type MadePeriod } from './dashUtils'

export type PitchMetric = 'sent' | 'replies'

/** a pitch counts as a reply once it has a reply time, or a status that only a reply can give it */
export const isReply = (p: Pitch): boolean => p.respondedAt != null || p.status === 'replied' || p.status === 'liked' || p.status === 'passed' || p.status === 'placed'

/**
 * Pitches sent, or replies received, per day (last 7 or 30 days) or per month (last 12).
 * Replies are placed at their reply time when known, else at the pitch's send time.
 */
export function pitchSeries(pitches: Pitch[], metric: PitchMetric, period: MadePeriod, now: number): { data: number[]; labels: string[] } {
  const today = new Date(startOfDay(now))
  const starts: Date[] =
    period === 'Yearly'
      ? Array.from({ length: 12 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1))
      : Array.from({ length: period === 'Weekly' ? 7 : 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period === 'Weekly' ? 6 : 29) + i))
  const data = starts.map(() => 0)
  for (const p of pitches) {
    if (metric === 'replies' && !isReply(p)) continue
    const t = metric === 'replies' ? (p.respondedAt ?? p.sentAt) : p.sentAt
    if (t > now) continue
    for (let i = starts.length - 1; i >= 0; i--) if (t >= starts[i].getTime()) { data[i]++; break }
  }
  const fmt: Intl.DateTimeFormatOptions = period === 'Yearly' ? { month: 'short' } : period === 'Weekly' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }
  return { data, labels: starts.map((d) => d.toLocaleDateString(undefined, fmt)) }
}
