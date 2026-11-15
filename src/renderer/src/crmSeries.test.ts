import { describe, expect, it } from 'vitest'
import type { Pitch } from '@shared/types'
import { isReply, pitchSeries } from './crmSeries'

const now = new Date(2026, 10, 14, 15).getTime() // Sat 14 Nov 2026
const pitch = (sentAt: number, status: Pitch['status'] = 'sent', respondedAt: number | null = null) => ({ sentAt, status, respondedAt }) as Pitch

describe('pitchSeries', () => {
  const ps = [
    pitch(new Date(2026, 10, 14, 9).getTime()),
    pitch(new Date(2026, 10, 10).getTime(), 'liked', new Date(2026, 10, 13).getTime()),
    pitch(new Date(2026, 10, 9).getTime(), 'replied'),
    pitch(new Date(2026, 8, 1).getTime(), 'listened')
  ]
  it('counts pitches sent per day', () => {
    expect(pitchSeries(ps, 'sent', 'Weekly', now).data).toEqual([0, 1, 1, 0, 0, 0, 1])
    expect(pitchSeries(ps, 'sent', 'Yearly', now).data.reduce((a, b) => a + b)).toBe(4)
  })
  it('places replies at their reply time, else at the send time', () => {
    const w = pitchSeries(ps, 'replies', 'Weekly', now)
    expect(w.data).toEqual([0, 1, 0, 0, 0, 1, 0])
    expect(pitchSeries(ps, 'replies', 'Monthly', now).data.reduce((a, b) => a + b)).toBe(2)
    expect(w.labels).toHaveLength(7)
  })
  it('knows a reply by its status or reply time', () => {
    expect(isReply(pitch(0))).toBe(false)
    expect(isReply(pitch(0, 'listened'))).toBe(false)
    expect(isReply(pitch(0, 'passed'))).toBe(true)
    expect(isReply(pitch(0, 'sent', 5))).toBe(true)
  })
})
