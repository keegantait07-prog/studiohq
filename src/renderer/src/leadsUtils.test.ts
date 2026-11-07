import { describe, expect, it } from 'vitest'
import type { Lead } from '@shared/leads'
import { DEFAULT_FILTER, apiFilter, emailSourceLabel, fmtFollowers, isDefaultFilter, reasonText, scoreBand, toPromote, visibleLeads } from './leadsUtils'

const lead = (id: number, status: Lead['status']): Lead => ({
  id, status, source: 'manual', sourceId: `a${id}`, name: `A${id}`, url: '', followers: null, lastActiveAt: null, genre: '', bio: '',
  signals: [], email: '', emailSourceUrl: '', score: 50, reasons: [], contactId: status === 'in_crm' ? 9 : null, createdAt: 0
})

describe('leadsUtils', () => {
  it('bands scores', () => {
    expect(scoreBand(100)).toBe('strong')
    expect(scoreBand(70)).toBe('strong')
    expect(scoreBand(69)).toBe('ok')
    expect(scoreBand(45)).toBe('ok')
    expect(scoreBand(44)).toBe('weak')
    expect(scoreBand(0)).toBe('weak')
  })

  it('formats followers', () => {
    expect(fmtFollowers(null)).toBe('n/a')
    expect(fmtFollowers(0)).toBe('0')
    expect(fmtFollowers(999)).toBe('999')
    expect(fmtFollowers(1200)).toBe('1.2K')
    expect(fmtFollowers(1000)).toBe('1K')
    expect(fmtFollowers(48_300)).toBe('48K')
    expect(fmtFollowers(2_450_000)).toBe('2.5M')
  })

  it('builds the store filter and hides skipped by default', () => {
    expect(apiFilter(DEFAULT_FILTER)).toEqual({})
    expect(isDefaultFilter(DEFAULT_FILTER)).toBe(true)
    const f = { source: 'youtube' as const, minScore: 60, hasEmail: true, status: 'saved' as const }
    expect(apiFilter(f)).toEqual({ source: 'youtube', minScore: 60, hasEmail: true, status: 'saved' })
    expect(isDefaultFilter(f)).toBe(false)
    const all = [lead(1, 'new'), lead(2, 'skipped'), lead(3, 'in_crm')]
    expect(visibleLeads(all, DEFAULT_FILTER).map((l) => l.id)).toEqual([1, 3])
    expect(visibleLeads(all, { ...DEFAULT_FILTER, status: 'all' })).toHaveLength(3)
  })

  it('describes where an email came from', () => {
    expect(emailSourceLabel('', 'https://x.com')).toBe('')
    expect(emailSourceLabel('a@b.co', 'added by you')).toBe('added by you')
    expect(emailSourceLabel('a@b.co', '')).toBe('added by you')
    expect(emailSourceLabel('a@b.co', 'https://www.youtube.com/@kid/about')).toBe('from channel About')
    expect(emailSourceLabel('a@b.co', 'https://www.linktr.ee/kid')).toBe('from linktr.ee')
  })

  it('strips points from reasons', () => {
    expect(reasonText('Asks for beats (+30)')).toBe('Asks for beats')
    expect(reasonText('Large audience (-20)')).toBe('Large audience')
  })

  it('never promotes a lead already in the CRM', () => {
    const all = [lead(1, 'new'), lead(2, 'in_crm'), lead(3, 'saved'), lead(4, 'new')]
    expect(toPromote(all, new Set([1, 2, 3])).map((l) => l.id)).toEqual([1, 3])
  })

  it('never promotes a lead that already has a contact, whatever its status', () => {
    const skipped = { ...lead(5, 'skipped'), contactId: 12 }
    expect(toPromote([lead(1, 'new'), skipped], new Set([1, 5])).map((l) => l.id)).toEqual([1])
  })
})
