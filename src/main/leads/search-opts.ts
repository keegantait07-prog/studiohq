// Search options come from the renderer, so they are clamped here rather than trusted.
export interface SearchOpts { maxSubs?: number; days?: number }

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : undefined

export function cleanSearchOpts(raw: unknown): SearchOpts {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: SearchOpts = {}
  const maxSubs = num(r.maxSubs, 100, 500_000)
  const days = num(r.days, 7, 365)
  if (maxSubs !== undefined) out.maxSubs = maxSubs
  if (days !== undefined) out.days = days
  return out
}
