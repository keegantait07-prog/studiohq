import { describe, expect, it } from 'vitest'
import type { Post } from '@shared/types'
import { postsSeries } from './contentSeries'

const now = new Date(2026, 10, 14, 15).getTime() // Sat 14 Nov 2026
const post = (date: number, status: Post['status'] = 'posted') => ({ id: 1, beatId: 1, platform: 'tiktok', status, date, url: '', caption: '' }) as Post

describe('postsSeries', () => {
  it('counts only posted posts, per day or month, up to now', () => {
    const posts = [post(new Date(2026, 10, 14, 9).getTime()), post(new Date(2026, 10, 14, 10).getTime()), post(new Date(2026, 10, 10).getTime()), post(new Date(2026, 10, 13).getTime(), 'planned'), post(new Date(2026, 10, 20).getTime()), post(new Date(2026, 8, 3).getTime())]
    const w = postsSeries(posts, 'Weekly', now)
    expect(w.data).toEqual([0, 0, 1, 0, 0, 0, 2])
    expect(w.labels).toHaveLength(7)
    expect(postsSeries(posts, 'Monthly', now).data.reduce((a, b) => a + b)).toBe(3)
    const y = postsSeries(posts, 'Yearly', now)
    expect(y.data.slice(-3)).toEqual([1, 0, 3])
  })
})
