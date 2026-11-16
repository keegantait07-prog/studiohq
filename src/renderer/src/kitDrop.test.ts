import { describe, expect, it } from 'vitest'
import type { SoundRow } from '@shared/types'
import { matchDropped } from './kitDrop'

const row = (id: number, n: string, e = 'wav'): SoundRow => ({ id, n, d: 0, e, u: 1, k: 'kick', f: false, b: null, y: null, t: [], s: 1, m: null })
const items = [row(1, 'Kick A'), row(2, 'Kick A'), row(3, 'Snare'), row(4, 'Loop', 'mp3')]

describe('matchDropped', () => {
  it('matches by name ignoring case and extension', () => {
    expect(matchDropped(['kick a.WAV'], items).matched.map((s) => s.id)).toEqual([1])
  })
  it('gives two same-named drops two different library files', () => {
    expect(matchDropped(['Kick A.wav', 'Kick A.wav'], items).matched.map((s) => s.id)).toEqual([1, 2])
  })
  it('counts non-wav and unknown files as missed', () => {
    const r = matchDropped(['Loop.mp3', 'Nope.wav', 'Snare.wav'], items)
    expect(r.missed).toBe(2)
    expect(r.matched.map((s) => s.id)).toEqual([3])
  })
  it('skips sounds already taken', () => {
    expect(matchDropped(['Kick A.wav'], items, new Set([1])).matched.map((s) => s.id)).toEqual([2])
  })
})
