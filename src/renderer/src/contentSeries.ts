import type { Post } from '@shared/types'
import type { MadePeriod } from './dashUtils'

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

/** Posts marked posted, counted per day (Weekly: 7 days, Monthly: 30 days) or per month (Yearly: 12 months), ending at `now`. Feeds the Content Peak Chart. */
export function postsSeries(posts: Post[], period: MadePeriod, now: number): { data: number[]; labels: string[] } {
  const today = new Date(startOfDay(now))
  const starts: Date[] =
    period === 'Yearly'
      ? Array.from({ length: 12 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1))
      : Array.from({ length: period === 'Weekly' ? 7 : 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period === 'Weekly' ? 6 : 29) + i))
  const data = starts.map(() => 0)
  const from = starts[0].getTime()
  for (const p of posts) {
    if (p.status !== 'posted' || p.date < from || p.date > now) continue
    for (let i = starts.length - 1; i >= 0; i--) if (p.date >= starts[i].getTime()) { data[i]++; break }
  }
  const fmt: Intl.DateTimeFormatOptions = period === 'Yearly' ? { month: 'short' } : period === 'Weekly' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }
  return { data, labels: starts.map((d) => d.toLocaleDateString(undefined, fmt)) }
}
