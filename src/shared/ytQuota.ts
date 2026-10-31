// Ranks research candidates and keeps the day's YouTube API quota split between research and uploads.
import type { YtVideo } from './ytTypes'

/** YouTube Data API v3 unit costs */
export const COST = { search: 100, list: 1, upload: 1600, thumbnail: 50 } as const
export const DAILY = 10000
/** research may use this much of the day, so uploads always have room */
export const RESEARCH_CAP = 3000

const DAY = 86_400_000

export function viewsPerDay(v: Pick<YtVideo, 'views' | 'publishedAt'>, now: number): number {
  const age = (now - Date.parse(v.publishedAt)) / DAY
  return v.views / Math.max(1, age)
}

export function rankByVelocity(vs: YtVideo[], now: number): YtVideo[] {
  return [...vs].sort((a, b) => viewsPerDay(b, now) - viewsPerDay(a, now))
}

export function quotaAllows(used: { research: number; upload: number }, cost: number, kind: 'research' | 'upload'): boolean {
  if (used.research + used.upload + cost > DAILY) return false
  return kind === 'upload' || used.research + cost <= RESEARCH_CAP
}
