import { describe, expect, test } from 'vitest'
import type { Beat } from '@shared/types'
import { addable, moveId } from './storeUtils'

describe('moveId', () => {
  test('moves a beat one place up or down', () => {
    expect(moveId([1, 2, 3], 2, -1)).toEqual([2, 1, 3])
    expect(moveId([1, 2, 3], 2, 1)).toEqual([1, 3, 2])
  })
  test('does not wrap at the ends and ignores unknown ids', () => {
    expect(moveId([1, 2, 3], 1, -1)).toEqual([1, 2, 3])
    expect(moveId([1, 2, 3], 3, 1)).toEqual([1, 2, 3])
    expect(moveId([1, 2, 3], 9, 1)).toEqual([1, 2, 3])
  })
  test('does not change the list it was given', () => {
    const a = [1, 2, 3]
    moveId(a, 2, 1)
    expect(a).toEqual([1, 2, 3])
  })
})

describe('addable', () => {
  const b = (id: number, title: string, o: Partial<Beat> = {}) => ({ id, title, status: 'finished', ext: 'mp3', missing: false, ...o }) as Beat
  const beats = [b(1, 'Alpha'), b(2, 'Bravo', { status: 'wip' }), b(3, 'Charlie', { ext: 'flp' }), b(4, 'Delta', { missing: true }), b(5, 'Echo'), b(6, 'alpha two')]
  test('lists finished beats with audio that are not on the site yet', () => {
    expect(addable(beats, new Set([5]), '').map((x) => x.id)).toEqual([1, 6])
  })
  test('filters by title, ignoring case', () => {
    expect(addable(beats, new Set(), 'ALPHA').map((x) => x.id)).toEqual([1, 6])
    expect(addable(beats, new Set(), 'zzz')).toEqual([])
  })
})
