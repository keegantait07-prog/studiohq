import { describe, expect, it } from 'vitest'
import type { FeedbackComment } from '@shared/types'
import { ago, commentsSeries } from './feedbackSeries'

const now = new Date(2026, 10, 14, 15).getTime() // Sat 14 Nov 2026
const c = (createdAt: number) => ({ id: String(createdAt), slug: 'a', beatId: 1, beatIndex: 0, name: '', time: 0, text: '', createdAt, seen: true, resolved: false }) as FeedbackComment

describe('commentsSeries', () => {
  const list = [c(new Date(2026, 10, 14, 9).getTime()), c(new Date(2026, 10, 14, 10).getTime()), c(new Date(2026, 10, 10).getTime()), c(new Date(2026, 9, 1).getTime()), c(now + 60000)]

  it('counts every comment on the day it was left, ignoring future times', () => {
    const w = commentsSeries(list, 'Weekly', now)
    expect(w.data).toEqual([0, 0, 1, 0, 0, 0, 2])
    expect(w.labels).toHaveLength(7)
    expect(commentsSeries(list, 'Monthly', now).data.reduce((a, b) => a + b)).toBe(3)
  })

  it('groups by month for the yearly view', () => {
    const y = commentsSeries(list, 'Yearly', now)
    expect(y.data).toHaveLength(12)
    expect(y.data.slice(-2)).toEqual([1, 3])
  })

  it('is all zeros with no comments', () => {
    expect(commentsSeries([], 'Weekly', now).data).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})

describe('ago', () => {
  it('reads minutes, hours and days', () => {
    expect(ago(now - 20000, now)).toBe('just now')
    expect(ago(now - 35 * 60000, now)).toBe('35m ago')
    expect(ago(now - 3 * 3600000, now)).toBe('3h ago')
    expect(ago(now - 2 * 86400000, now)).toBe('2d ago')
  })
})
