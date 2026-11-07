import { describe, expect, it } from 'vitest'
import { cleanSearchOpts } from './search-opts'

describe('cleanSearchOpts', () => {
  it('passes sensible numbers through as integers', () => {
    expect(cleanSearchOpts({ maxSubs: 10_000, days: 90 })).toEqual({ maxSubs: 10_000, days: 90 })
    expect(cleanSearchOpts({ maxSubs: 9999.7 })).toEqual({ maxSubs: 9999 })
  })
  it('clamps out-of-range values', () => {
    expect(cleanSearchOpts({ maxSubs: 5, days: 1 })).toEqual({ maxSubs: 100, days: 7 })
    expect(cleanSearchOpts({ maxSubs: 9e9, days: 9999 })).toEqual({ maxSubs: 500_000, days: 365 })
  })
  it('ignores anything that is not a finite number', () => {
    expect(cleanSearchOpts({ maxSubs: '10000', days: NaN })).toEqual({})
    expect(cleanSearchOpts(null)).toEqual({})
    expect(cleanSearchOpts('x')).toEqual({})
    expect(cleanSearchOpts({ other: 1 })).toEqual({})
  })
})
