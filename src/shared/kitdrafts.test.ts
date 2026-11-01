import { describe, expect, test } from 'vitest'
import { emptyHistory, newKit, record, redo, sanitize, undo, uniqueName, upsert, usageByKey } from './kitdrafts'
import type { SoundRow } from './types'

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

describe('usageByKey', () => {
  const row = (id: number, n: string, s: number) => ({ id, n, s }) as SoundRow
  test('reports other kits that use a sample, including a copy of the same file', () => {
    const rows = new Map([row(1, 'Kick ATM', 500), row(2, 'kick atm', 500), row(3, 'Snare X', 9)].map((r) => [r.id, r] as const))
    const a = newKit('Old Kit'); a.picks.kicks = [{ id: 2, auto: false }]
    const b = newKit('Newer Kit'); b.picks.kicks = [{ id: 1, auto: true }]; b.picks.snares = [{ id: 3, auto: false }]
    const cur = newKit('Now'); cur.picks.kicks = [{ id: 1, auto: false }]
    const u = usageByKey([a, b, cur], cur.id, rows)
    expect(u.get('kick atm|500')).toEqual(['Old Kit', 'Newer Kit'])
    expect(u.get('snare x|9')).toEqual(['Newer Kit'])
    expect(u.has('nothing|0')).toBe(false)
  })
  test('the open kit never counts as a previous kit', () => {
    const rows = new Map([[1, { id: 1, n: 'a', s: 1 } as SoundRow]])
    const k = newKit('Only'); k.picks.kicks = [{ id: 1, auto: false }]
    expect(usageByKey([k], k.id, rows).size).toBe(0)
  })
})
