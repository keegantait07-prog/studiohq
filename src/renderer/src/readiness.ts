import type { Beat } from '@shared/types'

export type ReadyId = 'audio' | 'bpm' | 'key' | 'tags' | 'cover'
export interface ReadyStep { id: ReadyId; label: string; done: boolean }

/** How complete a beat's details are: the five things a pitch, a store page or a video needs. */
export function readiness(b: Beat): { steps: ReadyStep[]; done: number; total: number } {
  const steps: ReadyStep[] = [
    { id: 'audio', label: 'Audio file', done: b.ext !== 'flp' || b.hasPreview },
    { id: 'bpm', label: 'BPM', done: b.bpm != null },
    { id: 'key', label: 'Key', done: b.key != null },
    { id: 'tags', label: 'Genre or vibe tag', done: b.tags.genre.length + b.tags.vibe.length > 0 },
    { id: 'cover', label: 'Cover', done: b.coverPath != null }
  ]
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length }
}
