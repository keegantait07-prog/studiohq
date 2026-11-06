import { useEffect, useState } from 'react'
import type { ScanStatus, VideoProgress } from '@shared/types'

interface Job { label: string; pct: number | null; at: number; cancel?: () => void }
const STALE = 6000

/** Everything running in the background, in one place that stays put when you change views. */
export function JobsTray({ scan }: { scan: ScanStatus }) {
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  useEffect(() => {
    const put = (id: string, j: Omit<Job, 'at'>) => setJobs((o) => ({ ...o, [id]: { ...j, at: Date.now() } }))
    const a = window.api.onVideoProgress((p: VideoProgress) => put('video', { label: p.label, pct: p.pct, cancel: () => void window.api.cancelVideo() }))
    const b = window.api.onYtProgress((p: VideoProgress) => put('youtube', { label: p.label, pct: p.pct }))
    const c = window.api.onSiteProgress((step: string) => put('site', { label: step, pct: null }))
    const t = setInterval(() => setJobs((o) => {
      const now = Date.now()
      const live = Object.entries(o).filter(([, j]) => now - j.at < STALE && !(j.pct != null && j.pct >= 1 && now - j.at > 1500))
      return live.length === Object.keys(o).length ? o : Object.fromEntries(live)
    }), 1000)
    return () => { a(); b(); c(); clearInterval(t) }
  }, [])

  const all = Object.entries(jobs).map(([id, j]) => ({ id, ...j }))
  if (scan.pending > 0) all.push({ id: 'scan', label: `Analyzing ${scan.total - scan.pending}/${scan.total}`, pct: (scan.total - scan.pending) / Math.max(1, scan.total), at: 0 })
  if (!all.length) return null
  const top = all[0]
  return (
    <div className="scan jobs" role="status" title={all.map((j) => j.label).join('\n')}>
      <span className="jobs-t">{top.label}{all.length > 1 ? ` +${all.length - 1}` : ''}{top.cancel && <button className="ghost" onClick={top.cancel}>Cancel</button>}</span>
      <div className="bar"><div style={{ width: `${(top.pct ?? 0.15) * 100}%` }} /></div>
    </div>
  )
}
