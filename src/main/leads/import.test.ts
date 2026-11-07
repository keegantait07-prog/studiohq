import { describe, it, expect } from 'vitest'
import { importCandidates } from './import'

describe('importCandidates', () => {
  it('maps handles to bare candidates named by their id', () => {
    const [c] = importCandidates('https://www.youtube.com/channel/UC123', 'handles')
    expect(c).toMatchObject({ source: 'youtube', sourceId: 'UC123', name: 'UC123', followers: null, lastActiveAt: null, genre: '', bio: '', email: '', emailSourceUrl: '', signals: [] })
  })
  it('ignores unparseable lines', () => {
    expect(importCandidates('hello world\n', 'handles')).toEqual([])
  })
  it('parses csv rows as manual leads', () => {
    const [c] = importCandidates('name,url,email\nAda,,ada@example.com', 'csv')
    expect(c).toMatchObject({ source: 'manual', name: 'Ada', email: 'ada@example.com' })
  })
})
