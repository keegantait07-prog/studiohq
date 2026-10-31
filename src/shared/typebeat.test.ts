import { describe, expect, it } from 'vitest'
import { generateCopy, youtubeTagLength } from './typebeat'

describe('generateCopy', () => {
  it('leads with [FREE] and the artist, and keeps tags inside the YouTube limit', () => {
    const c = generateCopy(
      { title: 'Night Shift', bpm: 140, key: 'C# minor', genre: ['trap'], vibe: ['dark'], artist: ['future'] },
      { producer: 'Smalls', storeUrl: '', email: '', hashtags: '' },
      { free: true, year: 2026 }
    )
    expect(c.titles[0].startsWith('[FREE] Future Type Beat 2026')).toBe(true)
    expect(c.tags.join(',').length).toBeLessThanOrEqual(480)
  })

  it('keeps tags inside YouTube\'s 500 once tags with spaces are counted as quoted', () => {
    const c = generateCopy(
      { title: 'Night Shift', bpm: 140, key: 'C# minor', genre: ['trap', 'drill', 'rnb'], vibe: ['dark', 'sad', 'melodic'], artist: ['future', 'gunna', 'young thug'] },
      { producer: 'Smalls', storeUrl: '', email: '', hashtags: '' },
      { free: true, year: 2026 }
    )
    expect(youtubeTagLength(c.tags)).toBeLessThanOrEqual(480)
  })
})
