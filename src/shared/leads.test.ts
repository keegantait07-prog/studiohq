import { describe, it, expect } from 'vitest'
import {
  looksLikeBeatMaker,
  normalizeEmail,
  extractEmails,
  scoreLead,
  parseHandles,
  parseCsv,
  withOptOut,
  OPT_OUT_LINE,
  type LeadCandidate
} from './leads'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

function cand(over: Partial<LeadCandidate> = {}): LeadCandidate {
  return {
    source: 'youtube',
    sourceId: 'x',
    name: 'X',
    url: '',
    followers: null,
    lastActiveAt: null,
    genre: '',
    bio: '',
    signals: [],
    email: '',
    emailSourceUrl: '',
    ...over
  }
}
const opts = { producerGenres: ['trap', 'Drill'], now: NOW }

describe('normalizeEmail', () => {
  it('lowercases and trims', () => expect(normalizeEmail('  Foo@X.com ')).toBe('foo@x.com'))
  it('strips mailto and query', () => expect(normalizeEmail('mailto:a@b.co?subject=hi')).toBe('a@b.co'))
  it('rejects non-emails', () => expect(normalizeEmail('not an email')).toBeNull())
})

describe('extractEmails', () => {
  it('finds, normalises and dedupes', () => {
    expect(extractEmails('Contact: Foo@X.com or foo@x.com, bar@y.org.')).toEqual(['foo@x.com', 'bar@y.org'])
  })
  it('removes junk', () => {
    expect(extractEmails('logo@2x.png x@example.com a@sentry.io real@artist.com')).toEqual(['real@artist.com'])
  })
})

describe('scoreLead', () => {
  it('base is 50 with no data', () => {
    expect(scoreLead(cand(), opts)).toEqual({ score: 50, reasons: [] })
  })
  it('follower tiers', () => {
    const f = (n: number | null) => scoreLead(cand({ followers: n }), opts).score
    expect(f(999)).toBe(75)
    expect(f(1000)).toBe(65)
    expect(f(4999)).toBe(65)
    expect(f(5000)).toBe(55)
    expect(f(19999)).toBe(55)
    expect(f(20000)).toBe(30)
    expect(f(99999)).toBe(30)
    expect(f(100000)).toBe(10)
    expect(f(null)).toBe(50)
  })
  it('recency tiers', () => {
    const a = (d: number | null) => scoreLead(cand({ lastActiveAt: d === null ? null : NOW - d * DAY }), opts).score
    expect(a(10)).toBe(65)
    expect(a(60)).toBe(55)
    expect(a(120)).toBe(50)
    expect(a(200)).toBe(35)
    expect(a(null)).toBe(50)
  })
  it('genre match is case-insensitive', () => {
    expect(scoreLead(cand({ genre: 'DRILL' }), opts).score).toBe(60)
    expect(scoreLead(cand({ genre: 'jazz' }), opts).score).toBe(50)
  })
  it('asks_for_beats adds 30 once', () => {
    expect(scoreLead(cand({ signals: ['asks_for_beats', 'asks_for_beats'] }), opts).score).toBe(80)
  })
  it('clamps to 0-100 and records reasons', () => {
    const hi = scoreLead(
      cand({ followers: 10, lastActiveAt: NOW, genre: 'trap', signals: ['asks_for_beats'] }),
      opts
    )
    expect(hi.score).toBe(100)
    expect(hi.reasons).toHaveLength(4)
    hi.reasons.forEach((r) => expect(r.length).toBeGreaterThan(3))
    const lo = scoreLead(cand({ followers: 500000, lastActiveAt: NOW - 400 * DAY }), opts)
    expect(lo.score).toBe(0)
    expect(lo.reasons).toHaveLength(2)
  })
})

describe('parseHandles', () => {
  it('parses the pinned examples', () => {
    expect(parseHandles('@foo\nhttps://www.instagram.com/bar/?hl=en\nhttps://soundcloud.com/baz')).toEqual([
      { source: 'manual', sourceId: 'foo', url: '' },
      { source: 'manual', sourceId: 'bar', url: 'https://www.instagram.com/bar/' },
      { source: 'soundcloud', sourceId: 'baz', url: 'https://soundcloud.com/baz' }
    ])
  })
  it('parses youtube handle and channel urls', () => {
    const r = parseHandles('https://www.youtube.com/@SomeOne\nhttps://youtube.com/channel/UCabcDEF123')
    expect(r.map((x) => [x.source, x.sourceId])).toEqual([
      ['youtube', 'someone'],
      ['youtube', 'UCabcDEF123']
    ])
  })
  it('drops blanks, duplicates and junk', () => {
    const r = parseHandles('\n@Foo\n@foo\n   \nhello world\n')
    expect(r).toEqual([{ source: 'manual', sourceId: 'foo', url: '' }])
  })
})

describe('parseCsv', () => {
  it('handles BOM, CRLF, header, quoted comma, blank line, bad row', () => {
    const csv =
      '﻿name,url,email,genre,followers\r\n' +
      '"Doe, Jane",https://soundcloud.com/jane,Jane@X.com,trap,1200\r\n' +
      '\r\n' +
      'bad row with no fields\r\n' +
      'Bob,,,drill,\r\n'
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      source: 'manual',
      name: 'Doe, Jane',
      url: 'https://soundcloud.com/jane',
      email: 'jane@x.com',
      genre: 'trap',
      followers: 1200
    })
    expect(rows[1]).toMatchObject({ name: 'Bob', email: '', followers: null })
  })
  it('works without a header', () => {
    const rows = parseCsv('Ann,https://x.com/ann,ann@a.com,rnb,50')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Ann')
  })
})

describe('withOptOut', () => {
  it('appends once and is idempotent', () => {
    const once = withOptOut('Hey there')
    expect(once).toContain(OPT_OUT_LINE)
    expect(withOptOut(once)).toBe(once)
    expect(once.split(OPT_OUT_LINE)).toHaveLength(2)
  })
})

describe('asksForBeats', () => {
  it('matches public requests for beats or a producer', async () => {
    const { asksForBeats } = await import('./leads')
    for (const t of ['I NEED BEATS asap', 'needing beats for my tape', 'Looking for a producer', 'looking for beats!', 'send me beats', 'Send me your beats', 'need a producer', 'need producers', 'DM for beats', 'dm me beats', 'beats wanted', 'looking for producers']) {
      expect(asksForBeats(t), t).toBe(true)
    }
  })
  it('ignores bios that do not ask', async () => {
    const { asksForBeats } = await import('./leads')
    for (const t of ['', 'I make beats', 'beats by me', 'producer and rapper', 'no beats needed', 'Buy my beats at shop.com', 'Dm for features']) {
      expect(asksForBeats(t), t).toBe(false)
    }
  })
  it('stays fast on very long text', async () => {
    const { asksForBeats } = await import('./leads')
    const t0 = Date.now()
    expect(asksForBeats('need '.repeat(200_000))).toBe(false)
    expect(Date.now() - t0).toBeLessThan(500)
  })
})

describe('emailsIn', () => {
  it('pulls every address out of free text, normalised, with no junk filter', async () => {
    const { emailsIn } = await import('./leads')
    expect(emailsIn('Ada <Ada@Example.com>')).toEqual(['ada@example.com'])
    expect(emailsIn('a@x.com, b@y.com; A@X.com')).toEqual(['a@x.com', 'b@y.com'])
    expect(emailsIn('mailto:foo@x.com')).toEqual(['foo@x.com'])
    expect(emailsIn('no address here')).toEqual([])
    expect(emailsIn('')).toEqual([])
  })
})

describe('looksLikeBeatMaker', () => {
  it.each([
    'Dark Drill Type Beat 2026 | Free',
    'Metro Type Beats',
    'Free beats for rappers. Beats for sale: buy at example.com',
    'Official beatmaker channel',
    'Instrumentals and royalty free beats'
  ])('flags producer text: %s', (t) => expect(looksLikeBeatMaker(t)).toBe(true))
  it.each([
    'Nova Kid - Run It Up (Official Video)',
    'Rapper from London. New single out now.',
    'Rapper and producer from Atlanta.',
    'Beat the odds - Freestyle',
    '',
    'Looking for beats! DM me'
  ])('keeps artist text: %s', (t) => expect(looksLikeBeatMaker(t)).toBe(false))
  it('is linear on long hostile input', () => {
    const t0 = Date.now()
    looksLikeBeatMaker('b'.repeat(500_000) + ' type ' + 'beat '.repeat(100_000))
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})

describe('lead categories', () => {
  it('names the genre tags in free text', async () => {
    const { genreTags, sizeFor } = await import('./leads')
    expect(genreTags('southside / melodic rap')).toEqual(['Southside', 'Melodic'])
    expect(genreTags('4pf type piano or triplet hi hat')).toEqual(['4PF piano and triplets'])
    expect(genreTags('melodic hard')).toEqual(['Melodic', 'Hard'])
    expect(genreTags('rap any')).toEqual(['Open to anything'])
    expect(genreTags('')).toEqual([])
    expect(sizeFor({ role: 'manager', followers: 5 })).toBe('team')
    expect(sizeFor({ followers: 250_000 })).toBe('big')
    expect(sizeFor({ followers: null })).toBe('small')
  })

  it('reads role, size, ladder and note from optional CSV columns', () => {
    const [a, b] = parseCsv('name,url,email,genre,followers,role,size,ladder,note\nAda,,ada@x.com,southside,,Manager,,Lil Baby,mgmt\nBo,,,melodic,,nope,big,,')
    expect(a).toMatchObject({ role: 'manager', ladder: 'Lil Baby', note: 'mgmt' })
    expect(b.role).toBeUndefined()
    expect(b.size).toBe('big')
  })
})
