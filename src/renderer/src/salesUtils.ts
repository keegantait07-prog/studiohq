import type { Sale } from '@shared/types'

export const money = (n: number) => '$' + (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const net = (s: Sale) => s.price - s.fee
export const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
export const toInputDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** local noon of a yyyy-mm-dd string, so timezone shifts never move the day */
export const fromInputDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime() }
export const errMsg = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export type RangeKey = '12m' | 'ytd' | 'all'
export function inRange(ms: number, r: RangeKey, now = new Date()): boolean {
  if (r === 'all') return true
  if (r === 'ytd') return new Date(ms).getFullYear() === now.getFullYear()
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime()
  return ms >= start
}

export interface MonthBucket { key: string; label: string; leases: number; exclusives: number; count: number }
export function monthly(sales: Sale[], r: RangeKey, useNet: boolean, now = new Date()): MonthBucket[] {
  const val = (s: Sale) => (useNet ? net(s) : s.price)
  let start: Date
  if (r === '12m') start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  else if (r === 'ytd') start = new Date(now.getFullYear(), 0, 1)
  else {
    const first = sales.length ? Math.min(...sales.map((s) => s.soldAt)) : now.getTime()
    start = new Date(new Date(first).getFullYear(), new Date(first).getMonth(), 1)
    const earliest = new Date(now.getFullYear(), now.getMonth() - 35, 1)
    if (start < earliest) start = earliest
  }
  const out: MonthBucket[] = []
  for (let d = new Date(start); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'short', year: d.getMonth() === 0 || out.length === 0 ? '2-digit' : undefined }), leases: 0, exclusives: 0, count: 0 })
  }
  const idx = new Map(out.map((b, i) => [b.key, i]))
  for (const s of sales) {
    const d = new Date(s.soldAt)
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`)
    if (i == null) continue
    if (s.exclusive) out[i].exclusives += val(s)
    else out[i].leases += val(s)
    out[i].count++
  }
  return out
}

export interface Ranked { key: string; label: string; total: number; count: number }
export function rank(sales: Sale[], by: (s: Sale) => { key: string; label: string }, useNet: boolean): Ranked[] {
  const m = new Map<string, Ranked>()
  for (const s of sales) {
    const { key, label } = by(s)
    const e = m.get(key) ?? { key, label, total: 0, count: 0 }
    e.total += useNet ? net(s) : s.price
    e.count++
    m.set(key, e)
  }
  return [...m.values()].sort((a, b) => b.total - a.total)
}
export const buyerKey = (s: Sale) => (s.contactId ? { key: `c${s.contactId}`, label: s.buyer } : { key: s.buyer.trim().toLowerCase(), label: s.buyer })
