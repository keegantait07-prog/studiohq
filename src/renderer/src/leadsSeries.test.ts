import { describe, expect, it } from 'vitest'
import type { Lead } from '@shared/leads'
import { isContacted, leadsSeries } from './leadsSeries'

const now = new Date(2026, 10, 14, 15).getTime() // Sat 14 Nov 2026
const lead = (createdAt: number, status: Lead['status'] = 'new', contactId: number | null = null) => ({ id: createdAt, createdAt, status, contactId }) as Lead
const day = (d: number, h = 10) => new Date(2026, 10, d, h).getTime()

describe('leadsSeries', () => {
  const list = [lead(day(14, 9)), lead(day(14, 11), 'in_crm', 5), lead(day(10), 'saved', 7), lead(day(1)), lead(new Date(2026, 9, 1).getTime()), lead(day(14, 12), 'skipped'), lead(now + 60000)]

  it('counts added leads on the day found, skipping skipped and future ones', () => {
    const w = leadsSeries(list, 'added', 'Weekly', now)
    expect(w.data).toEqual([0, 0, 1, 0, 0, 0, 2])
    expect(w.labels).toHaveLength(7)
    expect(leadsSeries(list, 'added', 'Monthly', now).data.reduce((a, b) => a + b)).toBe(4)
  })

  it('counts only leads that reached Pitch CRM as contacted', () => {
    expect(leadsSeries(list, 'contacted', 'Weekly', now).data).toEqual([0, 0, 1, 0, 0, 0, 1])
    expect(isContacted(lead(1, 'new', 3))).toBe(true)
    expect(isContacted(lead(1))).toBe(false)
  })

  it('groups by month for the yearly view', () => {
    const y = leadsSeries(list, 'added', 'Yearly', now)
    expect(y.data).toHaveLength(12)
    expect(y.data.slice(-2)).toEqual([1, 4])
  })

  it('is all zeros with no leads', () => {
    expect(leadsSeries([], 'added', 'Weekly', now).data).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})
