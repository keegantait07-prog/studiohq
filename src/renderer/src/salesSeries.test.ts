import { describe, expect, it } from 'vitest'
import type { Sale } from '@shared/types'
import { salesSeries } from './salesSeries'

const now = new Date(2026, 10, 14, 15).getTime()
const sale = (d: number, price: number, fee = 0, m = 10) => ({ soldAt: new Date(2026, m, d, 12).getTime(), price, fee }) as Sale
const ss = [sale(14, 60, 5), sale(12, 100), sale(8, 400, 40), sale(15, 999), sale(1, 25, 0, 2)]

describe('salesSeries', () => {
  it('buckets gross money per day for the last week and ignores future sales', () => {
    expect(salesSeries(ss, 'gross', 'Weekly', now).data).toEqual([400, 0, 0, 0, 100, 0, 60])
  })
  it('subtracts fees for net and counts sales', () => {
    expect(salesSeries(ss, 'net', 'Weekly', now).data.reduce((a, b) => a + b)).toBe(515)
    expect(salesSeries(ss, 'count', 'Monthly', now).data.reduce((a, b) => a + b)).toBe(3)
  })
  it('groups by month for the year view', () => {
    const y = salesSeries(ss, 'gross', 'Yearly', now)
    expect(y.data).toHaveLength(12)
    expect(y.data[11]).toBe(560)
    expect(y.data[3]).toBe(25)
    expect(y.labels).toHaveLength(12)
  })
})
