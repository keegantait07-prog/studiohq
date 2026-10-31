import { describe, expect, it } from 'vitest'
import { buildPrompt, fallbackPackage, fillLink, parsePackage, validateBeatstarsUrl, validatePackage } from './ytPackage'
import { buildStyleProfile } from './styleProfile'
import { LINK_PLACEHOLDER, type BeatProfile, type PackageDraft, type YtVideo } from './ytTypes'

const beat: BeatProfile = { title: 'Night Shift', bpm: 140, key: 'C# minor', genre: ['trap'], vibe: ['dark'], artist: ['future'], energy: 'high' }
const vid = (i: number): YtVideo => ({ id: `v${i}`, channelId: 'c', channelTitle: 'C', title: `[FREE] Future Type Beat 2026 - "Name ${i}" | Dark Trap`, description: 'Buy: https://beatstars.com/x\n#typebeat', tags: ['future type beat'], publishedAt: '2026-10-01T00:00:00Z', views: 10 })
const style = buildStyleProfile(Array.from({ length: 12 }, (_, i) => vid(i)), 'future')
const good = (): PackageDraft => ({
  titles: ['A Type Beat 1', 'A Type Beat 2', 'A Type Beat 3'],
  description: `Buy: ${LINK_PLACEHOLDER}\n#typebeat`,
  tags: ['future type beat', 'trap beat'],
  hashtags: ['#typebeat'],
  source: 'claude'
})

describe('validateBeatstarsUrl', () => {
  it('accepts a BeatStars link, trimmed, keeping its query string', () => {
    expect(validateBeatstarsUrl('  https://www.beatstars.com/beat/x-123?utm=1 ')).toEqual({ ok: true, url: 'https://www.beatstars.com/beat/x-123?utm=1' })
    expect(validateBeatstarsUrl('https://beatstars.com/beat/x-123').ok).toBe(true)
  })
  it.each(['http://beatstars.com/x', 'https://beatstars.com.evil.com/x', 'https://evilbeatstars.com/x', 'https://youtube.com/x', 'https://evil.com/?u=beatstars.com', '', 'not a url'])('rejects %j', (u) => {
    const r = validateBeatstarsUrl(u)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
  })
})

describe('validatePackage', () => {
  const has = (p: PackageDraft, word: string, ex: string[] = []) => validatePackage(p, ex).some((x) => x.includes(word))
  it('passes a good package', () => expect(validatePackage(good(), [])).toEqual([]))
  it('flags a title over 100 characters', () => expect(has({ ...good(), titles: ['x'.repeat(101), 'b', 'c'] }, 'too long')).toBe(true))
  it('flags fewer than three titles', () => expect(has({ ...good(), titles: ['a', 'b'] }, 'at least 3')).toBe(true))
  it('flags a missing or doubled link placeholder', () => {
    expect(has({ ...good(), description: 'no link' }, 'placeholder')).toBe(true)
    expect(has({ ...good(), description: `${LINK_PLACEHOLDER} ${LINK_PLACEHOLDER}` }, 'placeholder')).toBe(true)
  })
  it('flags any other URL, in any field', () => {
    expect(has({ ...good(), description: `${LINK_PLACEHOLDER} https://x.com` }, 'URL')).toBe(true)
    expect(has({ ...good(), tags: ['see http://x.com'] }, 'URL')).toBe(true)
  })
  it('flags tags over 480 characters', () => expect(has({ ...good(), tags: ['t'.repeat(481)] }, 'tags')).toBe(true))
  it('flags a title copied from an example, ignoring case', () => expect(has(good(), 'copies', ['a type beat 1'])).toBe(true))
})

describe('parsePackage', () => {
  const json = JSON.stringify({ titles: ['a', 'b', 'c'], description: `x ${LINK_PLACEHOLDER}`, tags: ['t'], hashtags: ['#h'] })
  it('reads plain JSON as a Claude package', () => expect(parsePackage(json)).toMatchObject({ titles: ['a', 'b', 'c'], source: 'claude' }))
  it('reads JSON wrapped in a code fence', () => expect(parsePackage('```json\n' + json + '\n```')?.titles).toHaveLength(3))
  it('returns null for prose or a missing field', () => {
    expect(parsePackage('Sure! Here are some titles')).toBeNull()
    expect(parsePackage(JSON.stringify({ description: 'x', tags: [], hashtags: [] }))).toBeNull()
  })
})

describe('fillLink', () => {
  it('leaves no placeholder behind', () => expect(fillLink(`Buy: ${LINK_PLACEHOLDER}`, 'https://beatstars.com/b')).toBe('Buy: https://beatstars.com/b'))
})

describe('fallbackPackage', () => {
  it('has the placeholder, three titles and never says undefined, even with no artist', () => {
    const p = fallbackPackage({ ...beat, artist: [] }, 'Smalls', 2026)
    expect(p.source).toBe('template')
    expect(p.titles.length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(p)).not.toContain('undefined')
    expect(p.description).toContain(LINK_PLACEHOLDER)
    expect(validatePackage(p, [])).toEqual([])
  })
})

describe('buildPrompt', () => {
  const { system, user } = buildPrompt(beat, style, 'Smalls')
  it('gives Claude the beat and the learned style', () => {
    expect(user).toContain('140')
    expect(user).toContain('[FREE]')
    expect(user).toContain('future')
  })
  it('includes at most 8 example videos', () => expect((user.match(/^Example title:/gm) ?? []).length).toBeLessThanOrEqual(8))
  it('tells Claude to return JSON, use the placeholder and not copy examples', () => {
    expect(system).toContain(LINK_PLACEHOLDER)
    expect(system.toLowerCase()).toContain('json')
    expect(system.toLowerCase()).toContain('never copy')
  })
})
