import { describe, expect, test } from 'vitest'
import { KIT_SLOTS, autoFill, candidates, clearAuto, cleanTag, emptyPicks, planKit, sampleName, slotOf, type Picks, type SlotId } from './kitmaker'
import type { SoundRow } from './types'

const row = (id: number, n: string, k: SoundRow['k'], o: Partial<SoundRow> = {}): SoundRow => ({ id, n, d: 0, e: 'wav', u: 0.5, k, f: false, b: null, y: null, t: [], s: 1000 + id, m: null, ...o })
const targets = (n: number) => Object.fromEntries(KIT_SLOTS.map((s) => [s.id, n])) as Record<SlotId, number>

describe('slotOf', () => {
  test('maps kinds to slots and splits open hats by name', () => {
    expect(slotOf(row(1, 'Kick Big', 'kick'))).toBe('kicks')
    expect(slotOf(row(2, 'Hi Hat Anti', 'hat'))).toBe('hats')
    expect(slotOf(row(3, 'OH12 @weaksauce', 'hat'))).toBe('opens')
    expect(slotOf(row(4, 'Open Hat Wide', 'hat'))).toBe('opens')
    expect(slotOf(row(5, 'Crash 1', 'hat'))).toBe('opens')
    expect(slotOf(row(6, 'Accent 808 Alter', '808'))).toBe('808s')
    expect(slotOf(row(7, 'Big', 'hat'), '/kits/Jersey/Opens')).toBe('opens')
    expect(slotOf(row(8, 'Big', 'hat'), '/kits/Jersey/Hi Hats')).toBe('hats')
  })
  test('hides non-wav and non-drum sounds', () => {
    expect(slotOf(row(1, 'x', 'kick', { e: 'mp3' }))).toBeNull()
    expect(slotOf(row(2, 'x', 'melody'))).toBeNull()
    expect(slotOf(row(3, 'x', 'midi', { e: 'mid' }))).toBeNull()
  })
})

describe('candidates', () => {
  test('the same sample reused across kits is listed once', () => {
    const a = row(1, 'Kick ATM', 'kick', { s: 500 }), b = row(2, 'kick atm', 'kick', { s: 500 }), c = row(3, 'Kick ATM', 'kick', { s: 501 })
    expect(candidates([a, b, c]).kicks.map((r) => r.id)).toEqual([1, 3])
  })
})

describe('sampleName', () => {
  test('numbers, pads and tags', () => {
    expect(sampleName('kicks', 0, 20, row(1, 'k', 'kick'), 'Smalls')).toBe('Kick 01 @Smalls.wav')
    expect(sampleName('kicks', 99, 120, row(1, 'k', 'kick'), '@Smalls')).toBe('Kick 100 @Smalls.wav')
  })
  test('808s carry key, loops carry tempo', () => {
    expect(sampleName('808s', 2, 10, row(1, 'x', '808', { y: 'F# minor' }), 't')).toBe('808 03 F#m @t.wav')
    expect(sampleName('loops', 0, 3, row(1, 'x', 'loop', { b: 140 }), 't')).toBe('Loop 01 140BPM @t.wav')
  })
  test('no tag means no suffix; the tag is made file-safe', () => {
    expect(sampleName('snares', 0, 5, row(1, 's', 'snare'), '')).toBe('Snare 01.wav')
    expect(cleanTag(' @my/tag ')).toBe('my tag'.replace(' ', ''))
  })
})

describe('autoFill', () => {
  const items = Array.from({ length: 30 }, (_, i) => row(i + 1, `Kick ${i}`, 'kick'))
  test('fills to the target without repeats and keeps hand picks', () => {
    const p: Picks = { ...emptyPicks(), kicks: [{ id: 7, auto: false }] }
    const f = autoFill(p, candidates(items), targets(10), () => 0.3)
    expect(f.kicks).toHaveLength(10)
    expect(new Set(f.kicks.map((x) => x.id)).size).toBe(10)
    expect(f.kicks[0]).toEqual({ id: 7, auto: false })
    expect(f.kicks.slice(1).every((x) => x.auto)).toBe(true)
  })
  test('stops at what exists', () => {
    const f = autoFill(emptyPicks(), candidates(items.slice(0, 3)), targets(10))
    expect(f.kicks).toHaveLength(3)
    expect(f.snares).toHaveLength(0)
  })
  test('re-roll keeps only hand picks', () => {
    const f = autoFill({ ...emptyPicks(), kicks: [{ id: 7, auto: false }] }, candidates(items), targets(5))
    expect(clearAuto(f).kicks).toEqual([{ id: 7, auto: false }])
  })
})

describe('planKit', () => {
  test('numbers each folder separately, in slot order', () => {
    const rows = new Map([row(1, 'a', 'kick'), row(2, 'b', 'kick'), row(3, 'c', 'snare')].map((r) => [r.id, r] as const))
    const p: Picks = { ...emptyPicks(), kicks: [{ id: 1, auto: false }, { id: 2, auto: true }], snares: [{ id: 3, auto: false }] }
    expect(planKit(p, rows, 'me').map((f) => `${f.folder}/${f.name}`)).toEqual(['Kicks/Kick 01 @me.wav', 'Kicks/Kick 02 @me.wav', 'Snares/Snare 01 @me.wav'])
  })
})
