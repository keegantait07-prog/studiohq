import type { Beat } from '@shared/types'

/** Where the beat is at its fullest: the busiest stretch of the waveform, skipping the intro. Returns seconds. */
export function hotspot(b: Beat): number | null {
  const n = b.thumb.length
  if (!b.duration || n < 8) return null
  const w = Math.max(3, Math.round(n * 0.14))
  let best = -1, at = 0
  for (let i = Math.floor(n * 0.08); i + w <= Math.floor(n * 0.88); i++) {
    let s = 0
    for (let k = 0; k < w; k++) s += b.thumb[i + k]
    if (s > best) { best = s; at = i }
  }
  return Math.max(0, Math.floor((at / n) * b.duration) - 1)
}

/** The other takes of the same beat, newest first: what the A/B key flips between. */
export function takesOf(beats: Beat[], id: number): Beat[] {
  const me = beats.find((b) => b.id === id)
  if (!me) return []
  return beats.filter((b) => b.groupId === me.groupId && b.ext !== 'flp' && !b.missing).sort((a, c) => c.mtime - a.mtime)
}
