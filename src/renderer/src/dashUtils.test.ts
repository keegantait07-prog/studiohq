import { describe, expect, it } from 'vitest'
import type { Beat } from '@shared/types'
import { madeSeries } from './dashUtils'

const now = new Date(2026, 10, 14, 15).getTime() // Sat 14 Nov 2026
const beat = (groupId: number, mtime: number) => ({ groupId, mtime }) as Beat

describe('madeSeries', () => {
  it('counts each beat group once, on the day of its first file', () => {
    const beats = [beat(1, new Date(2026, 10, 14, 9).getTime()), beat(1, new Date(2026, 10, 14, 10).getTime()), beat(2, new Date(2026, 10, 10).getTime()), beat(3, new Date(2026, 9, 1).getTime())]
    const w = madeSeries(beats, 'Weekly', now)
    expect(w.data).toEqual([0, 0, 1, 0, 0, 0, 1])
    expect(w.labels).toHaveLength(7)
    expect(madeSeries(beats, 'Monthly', now).data.reduce((a, b) => a + b)).toBe(2)
    const y = madeSeries(beats, 'Yearly', now)
    expect(y.data.slice(-2)).toEqual([1, 2])
  })
})
