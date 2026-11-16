import type { SoundRow } from '@shared/types'

const stem = (n: string) => n.replace(/\.[^.]+$/, '').trim().toLowerCase()

/** Match dropped file names against the library (WAV only). Names, not paths: the app cannot read a dropped file's folder. */
export function matchDropped(names: string[], items: SoundRow[], taken: Set<number> = new Set()): { matched: SoundRow[]; missed: number } {
  const byName = new Map<string, SoundRow[]>()
  for (const s of items) if (s.e === 'wav') { const k = s.n.trim().toLowerCase(); (byName.get(k) ?? byName.set(k, []).get(k)!).push(s) }
  const used = new Set(taken)
  const matched: SoundRow[] = []
  let missed = 0
  for (const n of names) {
    if (!/\.wav$/i.test(n)) { missed++; continue }
    const hit = (byName.get(stem(n)) ?? []).find((s) => !used.has(s.id))
    if (hit) { used.add(hit.id); matched.push(hit) } else missed++
  }
  return { matched, missed }
}
