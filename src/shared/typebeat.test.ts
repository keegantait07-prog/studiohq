import { describe, expect, it } from 'vitest'
import { generateCopy } from './typebeat'

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
})
