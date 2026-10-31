import { describe, expect, it } from 'vitest'
import { beatProfile, suggestArtists, type KnownArtist } from './beatProfile'

const base = { title: 'Night', bpm: 140, key: 'C# minor', tags: { vibe: ['dark'], genre: ['trap'], artist: [] as string[] } }
const flat = (n: number, x: number) => Array.from({ length: n }, () => x)

describe('beatProfile energy', () => {
  it('is low, medium or high from the mean of the waveform summary', () => {
    expect(beatProfile({ ...base, thumb: flat(48, 0.1) }).energy).toBe('low')
    expect(beatProfile({ ...base, thumb: flat(48, 0.4) }).energy).toBe('medium')
    expect(beatProfile({ ...base, thumb: flat(48, 0.7) }).energy).toBe('high')
  })
  it('is unknown without a waveform summary', () => expect(beatProfile({ ...base, thumb: [] }).energy).toBeNull())
  it('carries the tags and tempo through', () => {
    const p = beatProfile({ ...base, thumb: [] })
    expect(p).toMatchObject({ title: 'Night', bpm: 140, key: 'C# minor', genre: ['trap'], vibe: ['dark'], artist: [] })
  })
})

describe('suggestArtists', () => {
  const known: KnownArtist[] = [
    { artist: 'Melodic Guy', genre: ['rnb'], bpmRange: [70, 100] },
    { artist: 'Trap Guy', genre: ['trap'], bpmRange: [130, 160] },
    { artist: 'Future', genre: ['trap'], bpmRange: [120, 150] }
  ]
  it('puts the artist matching genre and tempo first', () => {
    const p = beatProfile({ ...base, thumb: [] })
    expect(suggestArtists(p, known)[0]).toBe('Trap Guy')
  })
  it('never suggests an artist the beat already has', () => {
    const p = beatProfile({ ...base, tags: { ...base.tags, artist: ['future'] }, thumb: [] })
    expect(suggestArtists(p, known).map((a) => a.toLowerCase())).not.toContain('future')
  })
  it('returns an empty list, not blanks, when nothing matches', () => {
    const p = beatProfile({ ...base, tags: { vibe: [], genre: ['jazz'], artist: [] }, bpm: 60, thumb: [] })
    expect(suggestArtists(p, known)).toEqual([])
  })
  it('respects the limit', () => {
    const p = beatProfile({ ...base, thumb: [] })
    expect(suggestArtists(p, known, 1)).toHaveLength(1)
  })
})
