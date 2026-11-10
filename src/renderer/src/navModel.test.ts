import { describe, expect, test } from 'vitest'
import { ALL_VIEWS, SECTIONS, hasDot, sectionOf, sectionTarget } from './navModel'

describe('navModel', () => {
  test('every screen belongs to exactly one section, in a fixed order', () => {
    const seen = SECTIONS.flatMap((s) => s.tabs.map((t) => t.view))
    expect([...seen].sort()).toEqual([...ALL_VIEWS].sort())
    expect(new Set(seen).size).toBe(seen.length)
  })
  test('the sections and their tabs are the ones agreed', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['home', 'make', 'sell', 'reach', 'studio'])
    expect(SECTIONS.find((s) => s.id === 'make')!.tabs.map((t) => t.view)).toEqual(['vault', 'loops', 'sounds', 'kits', 'map'])
    expect(SECTIONS.find((s) => s.id === 'sell')!.tabs.map((t) => t.view)).toEqual(['store', 'sales'])
    expect(SECTIONS.find((s) => s.id === 'reach')!.tabs.map((t) => t.view)).toEqual(['crm', 'leads', 'content', 'feedback'])
    expect(SECTIONS.find((s) => s.id === 'studio')!.tabs.map((t) => t.view)).toEqual(['plugins', 'themes'])
    expect(SECTIONS.find((s) => s.id === 'home')!.tabs.map((t) => t.view)).toEqual(['dashboard'])
  })
  test('sectionOf finds the section of any screen', () => {
    expect(sectionOf('sales').id).toBe('sell')
    expect(sectionOf('loops').id).toBe('make')
    expect(sectionOf('dashboard').id).toBe('home')
  })
  test('clicking a section opens the tab you last used there, else its first tab', () => {
    const make = sectionOf('vault')
    expect(sectionTarget(make, {}, 'dashboard')).toBe('vault')
    expect(sectionTarget(make, { make: 'sounds' }, 'dashboard')).toBe('sounds')
    expect(sectionTarget(make, { make: 'sounds' }, 'kits')).toBe('kits')
  })
  test('a remembered tab from another section is ignored', () => {
    expect(sectionTarget(sectionOf('store'), { sell: 'crm' }, 'vault')).toBe('store')
  })
  test('a rail dot shows when any tab in the section has something to look at', () => {
    const reach = sectionOf('crm')
    expect(hasDot(reach, {})).toBe(false)
    expect(hasDot(reach, { feedback: true })).toBe(true)
    expect(hasDot(sectionOf('store'), { feedback: true })).toBe(false)
  })
})
