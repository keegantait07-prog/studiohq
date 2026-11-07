import { describe, expect, it } from 'vitest'
import { LEAD_PRESETS, presetGroups, type LeadPreset } from './leadPresets'

const words = (q: string): string[] => q.trim().split(/\s+/)
const of = (source: LeadPreset['source']): LeadPreset[] => LEAD_PRESETS.filter((p) => p.source === source)

describe('lead presets', () => {
  it('have unique kebab-case ids, a label, a group and a short note', () => {
    expect(new Set(LEAD_PRESETS.map((p) => p.id)).size).toBe(LEAD_PRESETS.length)
    for (const p of LEAD_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(p.label.length).toBeGreaterThan(3)
      expect(p.group.length).toBeGreaterThan(2)
      expect(p.note.length).toBeGreaterThan(10)
      expect(p.note.length).toBeLessThanOrEqual(140)
    }
  })
  it('cover the sources that can search without a developer key first', () => {
    expect(of('youtube').length).toBeGreaterThanOrEqual(12)
    expect(of('reddit').length).toBeGreaterThanOrEqual(4)
    expect(of('x').length).toBeGreaterThanOrEqual(3)
    expect(of('soundcloud').length).toBeGreaterThanOrEqual(3)
  })
  it('YouTube presets look for artists, small and recently active, never for beat sellers', () => {
    for (const p of of('youtube')) {
      expect(words(p.query).length).toBeGreaterThanOrEqual(3)
      expect(words(p.query).length).toBeLessThanOrEqual(7)
      expect(p.query).not.toMatch(/\b(beats?|instrumentals?|producers?|type|prod)\b/i)
      expect(p.query).not.toMatch(/[-|"()]/)
      expect(p.maxSubs).toBeGreaterThanOrEqual(500)
      expect(p.maxSubs).toBeLessThanOrEqual(50_000)
      expect(p.days).toBeGreaterThanOrEqual(14)
      expect(p.days).toBeLessThanOrEqual(180)
    }
  })
  it('Reddit presets search for exact request phrases', () => {
    for (const p of of('reddit')) expect(p.query).toMatch(/"[^"]{6,}"/)
  })
  it('X presets always exclude sellers', () => {
    for (const p of of('x')) {
      expect(p.query).toContain('-"for sale"')
      expect(p.query).toContain('-"type beat"')
    }
  })
  it('keeps every query short enough for the search APIs', () => {
    for (const p of LEAD_PRESETS) expect(p.query.length).toBeLessThanOrEqual(120)
  })
  it('groups presets in a stable order for the picker', () => {
    const groups = presetGroups()
    expect(groups.map((g) => g.group)).toEqual([...new Set(LEAD_PRESETS.map((p) => p.group))])
    expect(groups.flatMap((g) => g.presets)).toHaveLength(LEAD_PRESETS.length)
  })
})
