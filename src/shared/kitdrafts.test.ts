import { describe, expect, test } from 'vitest'
import { emptyHistory, newKit, record, redo, sanitize, undo, uniqueName, upsert } from './kitdrafts'

describe('kits', () => {
  test('uniqueName numbers duplicates', () => {
    const kits = [newKit('My Kit'), newKit('my kit 2')]
    expect(uniqueName(kits, 'Fresh')).toBe('Fresh')
    expect(uniqueName(kits, 'My Kit')).toBe('My Kit 3')
  })
  test('upsert replaces by id, otherwise appends', () => {
    const a = newKit('A'), b = newKit('B')
    expect(upsert([a], b)).toHaveLength(2)
    expect(upsert([a, b], { ...a, name: 'A2' }).map((k) => k.name)).toEqual(['A2', 'B'])
  })
  test('sanitize repairs junk from storage', () => {
    const k = sanitize({ name: 'x', picks: { kicks: [{ id: 1, auto: false }] } as never })
    expect(k.picks.kicks).toHaveLength(1)
    expect(k.picks.snares).toEqual([])
    expect(k.targets.kicks).toBeGreaterThan(0)
    expect(sanitize(null).name).toBe('My Drum Kit')
  })
})

describe('history', () => {
  test('undo restores the picks from before a change, redo brings them back', () => {
    let h = emptyHistory<string>()
    h = record(h, 'empty')          // auto-fill happened: previous = empty
    const u = undo(h, 'filled')!
    expect(u.value).toBe('empty')
    const r = redo(u.h, 'empty')!
    expect(r.value).toBe('filled')
  })
  test('a new change after undo drops redo; nothing to undo returns null', () => {
    let h = record(emptyHistory<number>(), 1)
    h = undo(h, 2)!.h
    expect(record(h, 1).future).toEqual([])
    expect(undo(emptyHistory<number>(), 1)).toBeNull()
  })
  test('history is capped', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < 100; i++) h = record(h, i, 60)
    expect(h.past).toHaveLength(60)
    expect(h.past[59]).toBe(99)
  })
})
