import type { Beat } from '@shared/types'

/** A new order with one id moved a place up (-1) or down (+1). Stays put at the ends. */
export function moveId(ids: number[], id: number, delta: -1 | 1): number[] {
  const out = [...ids]
  const i = out.indexOf(id), j = i + delta
  if (i < 0 || j < 0 || j >= out.length) return out
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Beats that can be added to the site: finished, with audio, present on disk, not on the site yet, and matching the search. */
export function addable(beats: Beat[], onSite: Set<number>, q: string): Beat[] {
  const s = q.trim().toLowerCase()
  return beats.filter((b) => b.status === 'finished' && b.ext !== 'flp' && !b.missing && !onSite.has(b.id) && (!s || b.title.toLowerCase().includes(s)))
}
