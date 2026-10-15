export const fmtDur = (s: number | null) => {
  if (s == null) return '–'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
export const fmtBpm = (b: number | null) => (b == null ? '–' : Number.isInteger(b) ? String(b) : b.toFixed(1))
export function ago(ms: number) {
  const d = (Date.now() - ms) / 86400000
  if (d < 1) return 'today'
  if (d < 2) return 'yesterday'
  if (d < 30) return `${Math.floor(d)}d ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}
