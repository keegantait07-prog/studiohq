import type { Beat, StudioSession } from '@shared/types'

export const DAY = 86400000
export const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }
export const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
export const weekStart = (now = Date.now()) => { const s = startOfDay(now); return s - ((new Date(s).getDay() + 6) % 7) * DAY } // Monday
export const fmtClock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
export const fmtHM = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m` }

export interface Day { bounces: number; ms: number }
export const sessionMs = (s: StudioSession, now: number) => Math.max(0, (s.endedAt ?? now) - s.startedAt)

/** A day is "active" if a beat was bounced that day or at least 15 minutes were logged in the studio. */
export function activity(beats: Beat[], sessions: StudioSession[], now: number): Map<string, Day> {
  const m = new Map<string, Day>()
  const get = (k: string) => m.get(k) ?? m.set(k, { bounces: 0, ms: 0 }).get(k)!
  for (const b of beats) get(dayKey(b.mtime)).bounces++
  for (const s of sessions) get(dayKey(s.startedAt)).ms += sessionMs(s, now)
  return m
}
export const isActive = (d?: Day) => !!d && (d.bounces > 0 || d.ms >= 15 * 60000)

export function streaks(m: Map<string, Day>, now: number): { current: number; best: number } {
  let cur = 0
  // today doesn't break the streak until it's over
  for (let t = startOfDay(now) + (isActive(m.get(dayKey(now))) ? 0 : -DAY); isActive(m.get(dayKey(t))); t -= DAY) cur++
  const days = [...m.entries()].filter(([, d]) => isActive(d)).map(([k]) => { const [y, mo, d] = k.split('-').map(Number); return new Date(y, mo - 1, d).getTime() }).sort((a, b) => a - b)
  let best = 0, run = 0
  days.forEach((t, i) => { run = i > 0 && Math.round((t - days[i - 1]) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run) })
  return { current: cur, best }
}

/** A beat counts as "made" in the week its first bounce appeared; later versions don't count again. */
export function beatsMadeSince(beats: Beat[], since: number): number {
  const first = new Map<number, number>()
  for (const b of beats) first.set(b.groupId, Math.min(first.get(b.groupId) ?? Infinity, b.mtime))
  return [...first.values()].filter((t) => t >= since).length
}

export type MadePeriod = 'Weekly' | 'Monthly' | 'Yearly'
/** Beats made per day (last 7 or 30 days) or per month (last 12), counting each beat group once at its first file. */
export function madeSeries(beats: Beat[], period: MadePeriod, now: number): { data: number[]; labels: string[] } {
  const first = new Map<number, number>()
  for (const b of beats) first.set(b.groupId, Math.min(first.get(b.groupId) ?? Infinity, b.mtime))
  const today = new Date(startOfDay(now))
  const starts: Date[] =
    period === 'Yearly'
      ? Array.from({ length: 12 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1))
      : Array.from({ length: period === 'Weekly' ? 7 : 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period === 'Weekly' ? 6 : 29) + i))
  const data = starts.map(() => 0)
  for (const t of first.values()) {
    for (let i = starts.length - 1; i >= 0; i--) if (t >= starts[i].getTime()) { if (t <= now) data[i]++; break }
  }
  const fmt: Intl.DateTimeFormatOptions = period === 'Yearly' ? { month: 'short' } : period === 'Weekly' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }
  return { data, labels: starts.map((d) => d.toLocaleDateString(undefined, fmt)) }
}
