import { PLATFORMS, type Beat, type ContentData, type Platform, type Sale } from '@shared/types'

export const DAY = 86400000
export const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() }
export const platformLabel = (p: Platform) => PLATFORMS.find((x) => x.id === p)?.label ?? p
export const platformColor = (p: Platform) => PLATFORMS.find((x) => x.id === p)?.color ?? '#8b8f98'

export interface Suggestion { beat: Beat; score: number; reasons: string[] }

/** Which beats to post next on a platform, best first. Never suggests sold beats or ones posted there in the last 14 days. */
export function suggest(beats: Beat[], content: ContentData, sales: Sale[], platform: Platform, now = Date.now()): Suggestion[] {
  const soldGroups = new Set(sales.filter((s) => s.exclusive).map((s) => s.groupId))
  const byBeat = new Map<number, typeof content.posts>()
  for (const p of content.posts) (byBeat.get(p.beatId) ?? byBeat.set(p.beatId, []).get(p.beatId)!).push(p)
  const videoFor = new Set(content.videos.map((v) => v.beatId))
  const seenGroup = new Set<number>()
  const out: Suggestion[] = []
  // newest first so each group is represented by its latest version
  for (const b of [...beats].sort((x, y) => y.mtime - x.mtime)) {
    if (seenGroup.has(b.groupId)) continue
    seenGroup.add(b.groupId)
    if (b.status === 'sold' || soldGroups.has(b.groupId) || b.status === 'idea' || b.status === 'wip') continue
    const posts = beats.filter((x) => x.groupId === b.groupId).flatMap((x) => byBeat.get(x.id) ?? [])
    const posted = posts.filter((p) => p.status === 'posted')
    const here = posted.filter((p) => p.platform === platform)
    const planned = posts.some((p) => p.status === 'planned' && p.platform === platform)
    if (planned) continue
    if (here.some((p) => now - p.date < 14 * DAY)) continue
    let score = 0
    const reasons: string[] = []
    if (!posted.length) { score += 4; reasons.push('never posted') }
    if (!here.length) { score += 2; if (posted.length) reasons.push(`not on ${platformLabel(platform)} yet`) }
    else { reasons.push(`last on ${platformLabel(platform)} ${Math.floor((now - Math.max(...here.map((p) => p.date))) / DAY)}d ago`) }
    const age = (now - b.mtime) / DAY
    if (age < 30) { score += 2; reasons.push('new') }
    if (b.tags.artist.length) { score += 1; reasons.push('has type-beat artists') } else score -= 1
    if (videoFor.has(b.id)) { score += 1; reasons.push('video ready') }
    if (b.status === 'sent') { score -= 2; reasons.push('pitched, check first') }
    score += Math.min(1, (b.bpm ?? 0) / 200)
    out.push({ beat: b, score, reasons })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Next day (from today) with no post for this platform. */
export function nextFreeDate(content: ContentData, platform: Platform, now = Date.now()): number {
  const taken = new Set(content.posts.filter((p) => p.platform === platform).map((p) => startOfDay(p.date)))
  let d = startOfDay(now)
  while (taken.has(d)) d += DAY
  return d
}

/** Highest-energy window of the beat, snapped to a bar line when the tempo is known. */
export function bestSection(peaks: number[], duration: number, length: number, bpm: number | null): number {
  if (!peaks.length || !duration || duration <= length) return 0
  const per = duration / peaks.length
  const win = Math.max(1, Math.round(length / per))
  let best = 0, bestSum = -1, sum = 0
  for (let i = 0; i < peaks.length; i++) {
    sum += peaks[i] ** 2
    if (i >= win) sum -= peaks[i - win] ** 2
    if (i >= win - 1 && sum > bestSum) { bestSum = sum; best = i - win + 1 }
  }
  let start = best * per
  if (bpm) { const bar = (60 / bpm) * 4; start = Math.round(start / bar) * bar }
  return Math.max(0, Math.min(start, duration - length))
}
