import { describe, it, expect } from 'vitest'
import type { Beat } from '@shared/types'
import { readiness } from './readiness'

const beat = (o: Partial<Beat> = {}): Beat => ({
  id: 1, path: '/a.wav', filename: 'a.wav', title: 'a', folder: '', ext: 'wav', size: 1, mtime: 0, duration: 100,
  bpm: 140, bpmSource: 'analysis', bpmConfidence: 'high', keyConfidence: 'high', key: 'Gm', keySource: 'analysis',
  status: 'finished', notes: '', credits: '', groupId: 1, versionLabel: '', projectPath: null, projectConfidence: null,
  missing: false, analyzed: true, hasPreview: false, thumb: [], coverPath: '/c.png',
  tags: { genre: ['trap'], vibe: [], artist: [] }, createdAt: 0, ...o
}) as Beat

describe('readiness', () => {
  it('counts a fully filled-in beat as 5 of 5', () => {
    expect(readiness(beat())).toMatchObject({ done: 5, total: 5 })
  })
  it('names what is missing', () => {
    const r = readiness(beat({ bpm: null, key: null, coverPath: null }))
    expect(r.done).toBe(2)
    expect(r.steps.filter((s) => !s.done).map((s) => s.id)).toEqual(['bpm', 'key', 'cover'])
  })
  it('does not count an artist tag as a genre or vibe tag', () => {
    const r = readiness(beat({ tags: { genre: [], vibe: [], artist: ['x'] } as Beat['tags'] }))
    expect(r.steps.find((s) => s.id === 'tags')?.done).toBe(false)
  })
  it('an FL project with no preview has no audio, and with a preview it does', () => {
    expect(readiness(beat({ ext: 'flp', hasPreview: false })).steps[0].done).toBe(false)
    expect(readiness(beat({ ext: 'flp', hasPreview: true })).steps[0].done).toBe(true)
  })
})
