import { describe, expect, it } from 'vitest'
import { buildStyleProfile, describeProfile } from './styleProfile'
import type { YtVideo } from './ytTypes'

const v = (title: string, description: string, tags: string[]): YtVideo => ({ id: title, channelId: 'c', channelTitle: 'C', title, description, tags, publishedAt: '2026-10-01T00:00:00Z', views: 1000 })
const desc = 'Buy: https://beatstars.com/x\nProd. Someone\n#typebeat #future #trap'
const videos = [
  v('[FREE] Future Type Beat 2026 - "Night" | Dark Trap', desc, ['future type beat', 'trap beat']),
  v('[FREE] Future Type Beat 2026 - "Gold" | Dark Trap', desc, ['future type beat', 'dark trap']),
  v('[FREE] Future x Gunna Type Beat 2026 - "Ice" | Trap', desc, ['future type beat', 'gunna type beat']),
  v('future type beat 2026 | dark trap', desc, ['future type beat'])
]

describe('buildStyleProfile', () => {
  const p = buildStyleProfile(videos, 'future')
  it('measures how often titles use a bracket tag, year, quoted name and pair', () => {
    expect(p.sample).toBe(4)
    expect(p.title.bracketRate['[FREE]']).toBe(0.75)
    expect(p.title.yearRate).toBe(1)
    expect(p.title.quotedNameRate).toBe(0.75)
    expect(p.title.pairRate).toBe(0.25)
    expect(p.title.casing).toBe('title')
  })
  it('finds the most used separator', () => {
    expect(p.title.separators[' | ']).toBe(1)
    expect(p.title.separators[' - ']).toBe(0.75)
  })
  it('reads the description layout and hashtags', () => {
    expect(p.description.linkLine).toBe(1)
    expect(p.description.hashtagBlockRate).toBe(1)
    expect(p.hashtags.medianCount).toBe(3)
    expect(p.description.medianLines).toBe(3)
  })
  it('lists common tags and keeps at most 8 examples in the given order', () => {
    expect(p.tags.top[0]).toBe('future type beat')
    expect(p.examples.length).toBeLessThanOrEqual(8)
    expect(p.examples[0].title).toBe(videos[0].title)
  })
  it('gives zeroed rates, not NaN, for no videos', () => {
    const e = buildStyleProfile([], 'global')
    expect(e.sample).toBe(0)
    expect(e.title.yearRate).toBe(0)
    expect(Number.isNaN(e.title.medianLength)).toBe(false)
    expect(e.examples).toEqual([])
  })
})

describe('describeProfile', () => {
  it('states the bracket finding in plain language', () => {
    const lines = describeProfile(buildStyleProfile(videos, 'future'))
    expect(lines.some((l) => l.includes('75%') && l.includes('[FREE]'))).toBe(true)
  })
})
