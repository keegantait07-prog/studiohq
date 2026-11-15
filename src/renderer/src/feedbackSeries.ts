import type { FeedbackComment } from '@shared/types'
import { startOfDay, type MadePeriod } from './dashUtils'

export type CommentPeriod = MadePeriod

/** Comments received per day (last 7 or 30 days) or per month (last 12), by the time each comment was left. Feeds the Feedback Peak Chart. */
export function commentsSeries(comments: FeedbackComment[], period: CommentPeriod, now: number): { data: number[]; labels: string[] } {
  const today = new Date(startOfDay(now))
  const starts: Date[] =
    period === 'Yearly'
      ? Array.from({ length: 12 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1))
      : Array.from({ length: period === 'Weekly' ? 7 : 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period === 'Weekly' ? 6 : 29) + i))
  const data = starts.map(() => 0)
  for (const c of comments) {
    const t = c.createdAt
    if (t > now) continue
    for (let i = starts.length - 1; i >= 0; i--) if (t >= starts[i].getTime()) { data[i]++; break }
  }
  const fmt: Intl.DateTimeFormatOptions = period === 'Yearly' ? { month: 'short' } : period === 'Weekly' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }
  return { data, labels: starts.map((d) => d.toLocaleDateString(undefined, fmt)) }
}

/** "35m ago", "2h ago", "3d ago". */
export const ago = (ms: number, now = Date.now()): string => {
  const m = Math.floor((now - ms) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}
