import { describe, expect, it } from 'vitest'
import { DAILY, quotaAllows, rankByVelocity, viewsPerDay } from './ytQuota'
import type { YtVideo } from './ytTypes'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 31)
const vid = (id: string, views: number, daysAgo: number): YtVideo => ({ id, channelId: 'c', channelTitle: 'C', title: id, description: '', tags: [], publishedAt: new Date(now - daysAgo * DAY).toISOString(), views })

describe('viewsPerDay', () => {
  it('divides views by age in days', () => expect(viewsPerDay(vid('a', 1000, 10), now)).toBe(100))
  it('counts a brand-new or future video as one day old', () => {
    expect(viewsPerDay(vid('a', 500, 0), now)).toBe(500)
    expect(viewsPerDay(vid('a', 500, -3), now)).toBe(500)
  })
})

describe('rankByVelocity', () => {
  it('orders fastest first without changing the input', () => {
    const input = [vid('slow', 100, 10), vid('fast', 900, 1), vid('mid', 500, 5)]
    expect(rankByVelocity(input, now).map((x) => x.id)).toEqual(['fast', 'mid', 'slow'])
    expect(input.map((x) => x.id)).toEqual(['slow', 'fast', 'mid'])
  })
})

describe('quotaAllows', () => {
  it('stops research at its 3,000 unit cap', () => {
    expect(quotaAllows({ research: 2950, upload: 0 }, 100, 'research')).toBe(false)
    expect(quotaAllows({ research: 2900, upload: 0 }, 100, 'research')).toBe(true)
  })
  it('lets an upload use everything up to the daily total', () => {
    expect(quotaAllows({ research: 0, upload: 8400 }, 1600, 'upload')).toBe(true)
    expect(quotaAllows({ research: 0, upload: 8401 }, 1600, 'upload')).toBe(false)
  })
  it('refuses research that would push the day past the total', () => {
    expect(quotaAllows({ research: 2000, upload: DAILY - 2050 }, 100, 'research')).toBe(false)
  })
})
