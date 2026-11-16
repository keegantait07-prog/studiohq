import type { Sale } from '@shared/types'
import { startOfDay, type MadePeriod } from './dashUtils'

export type SalesMetric = 'gross' | 'net' | 'count'

/** Sales per day (last 7 or 30 days) or per month (last 12), as gross money, money after fees, or number of sales. */
export function salesSeries(sales: Sale[], metric: SalesMetric, period: MadePeriod, now: number): { data: number[]; labels: string[] } {
  const today = new Date(startOfDay(now))
  const starts: Date[] =
    period === 'Yearly'
      ? Array.from({ length: 12 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1))
      : Array.from({ length: period === 'Weekly' ? 7 : 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period === 'Weekly' ? 6 : 29) + i))
  const data = starts.map(() => 0)
  for (const s of sales) {
    if (s.soldAt > now) continue
    const v = metric === 'count' ? 1 : metric === 'net' ? s.price - s.fee : s.price
    for (let i = starts.length - 1; i >= 0; i--) if (s.soldAt >= starts[i].getTime()) { data[i] += v; break }
  }
  const fmt: Intl.DateTimeFormatOptions = period === 'Yearly' ? { month: 'short' } : period === 'Weekly' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }
  return { data: data.map((d) => Math.round(d * 100) / 100), labels: starts.map((d) => d.toLocaleDateString(undefined, fmt)) }
}
