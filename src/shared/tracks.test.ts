import { describe, expect, it } from 'vitest'
import { buildLine, sinceYouLeft, type LineInput } from './tracks'
import type { Beat, Pitch, Post, Sale, SplitGroup } from './types'

const NOW = new Date(2026, 10, 6, 12).getTime()
const DAY = 86400000
const beat = (id: number, o: Partial<Beat> = {}): Beat => ({ id, groupId: id, title: `B${id}`, ext: 'mp3', status: 'finished', mtime: id, createdAt: 0, tags: { vibe: ['dark'], genre: [], artist: [] }, ...o }) as Beat
const pitch = (o: Partial<Pitch>, groupId = 1): Pitch => ({ id: 1, contactId: 7, status: 'sent', nextFollowupAt: null, respondedAt: null, beats: [{ beatId: 1, groupId }], ...o }) as unknown as Pitch
const post = (o: Partial<Post>): Post => ({ id: 1, beatId: 1, platform: 'youtube', status: 'posted', date: NOW, url: '', caption: '', ...o })
const sale = (o: Partial<Sale> = {}): Sale => ({ id: 1, beatId: 1, groupId: 1, buyer: 'Ana', exclusive: false, price: 50, fee: 5, soldAt: NOW, ...o }) as Sale
const line = (o: Partial<LineInput>) => buildLine({ beats: [beat(1)], pitches: [], posts: [], sales: [], splits: [], now: NOW, ...o })

describe('lanes', () => {
  it('an FL project with no audio is Inbox and asks for a bounce', () => {
    const [c] = line({ beats: [beat(1, { ext: 'flp', status: 'wip' })] })
    expect([c.lane, c.next.kind]).toEqual(['inbox', 'bounce'])
  })
  it('a WIP with audio asks to be finished', () => { expect(line({ beats: [beat(1, { status: 'wip' })] })[0].next.kind).toBe('finish') })
  it('an untouched bounce with no tags stays in Inbox, whatever its status says', () => {
    const [c] = line({ beats: [beat(1, { tags: { vibe: [], genre: [], artist: [] } })] })
    expect([c.lane, c.next.kind]).toEqual(['inbox', 'tag'])
  })
  it('a finished, tagged beat nobody has seen is Ready, and suggests a video', () => {
    const [c] = line({})
    expect([c.lane, c.next.kind]).toEqual(['ready', 'post'])
  })
  it('posted but never pitched is Out and suggests a pitch', () => {
    const [c] = line({ posts: [post({})] })
    expect([c.lane, c.next.kind]).toEqual(['out', 'pitch'])
  })
  it('any sale puts it in Earning, and a lease does not end its life', () => {
    const [c] = line({ sales: [sale()] })
    expect(c.lane).toBe('earning')
    expect(c.next.kind).toBe('post')
  })
  it('an exclusive is finished business', () => {
    const [c] = line({ sales: [sale({ exclusive: true })] })
    expect(c.tracks.sell.label).toBe('Sold to Ana')
    expect(c.next.kind).toBe('none')
  })
})

describe('urgency', () => {
  it('a due follow-up beats everything and names the contact', () => {
    const [c] = line({ pitches: [pitch({ nextFollowupAt: NOW - 1 })], posts: [post({ status: 'planned', date: NOW - 3 * DAY })] })
    expect(c.next).toMatchObject({ kind: 'followup', contactId: 7 })
    expect(c.urgent).toBe(true)
  })
  it('a plan from before today is overdue, today is not', () => {
    expect(line({ posts: [post({ status: 'planned', date: NOW - 2 * DAY })] })[0].next.kind).toBe('overdue')
    expect(line({ posts: [post({ status: 'planned', date: NOW })] })[0].tracks.post.state).toBe('active')
  })
  it('a private upload asks to be published', () => {
    expect(line({ posts: [post({ status: 'private', url: 'https://youtu.be/x' })] })[0].next).toMatchObject({ kind: 'publish', url: 'https://youtu.be/x' })
  })
  it('unfinished splits need attention, and complete ones do not', () => {
    const s = (t: number): SplitGroup => ({ groupId: 1, beatId: 1, title: '', count: 1, parties: 2, pubTotal: t, masterTotal: 100, sheetAt: null })
    expect(line({ splits: [s(90)] })[0].next.kind).toBe('splits')
    expect(line({ splits: [s(100)] })[0].next.kind).toBe('post')
  })
  it('urgent cards come first', () => {
    const cards = line({ beats: [beat(1), beat(2)], pitches: [pitch({ nextFollowupAt: NOW - 1 })] })
    expect(cards[0].groupId).toBe(1)
  })
})

describe('versions', () => {
  it('versions collapse into one card that plays the newest audio', () => {
    const cards = line({ beats: [beat(1, { groupId: 9, mtime: 5 }), beat(2, { groupId: 9, mtime: 9 }), beat(3, { groupId: 9, mtime: 99, ext: 'flp' })] })
    expect(cards.length).toBe(1)
    expect(cards[0].beat.id).toBe(2)
    expect(cards[0].versions).toBe(3)
  })
  it('a pitch of one version counts for the whole beat', () => {
    const cards = line({ beats: [beat(1, { groupId: 9 }), beat(2, { groupId: 9 })], pitches: [pitch({}, 9)] })
    expect(cards[0].lane).toBe('out')
  })
  it('a post of an older version counts too', () => {
    const cards = line({ beats: [beat(1, { groupId: 9 }), beat(2, { groupId: 9 })], posts: [post({ beatId: 1 })] })
    expect(cards[0].tracks.post.state).toBe('done')
  })
})

describe('since you left', () => {
  it('counts new work once per beat and nets the money', () => {
    const s = sinceYouLeft({
      beats: [beat(1, { groupId: 5, createdAt: 100 }), beat(2, { groupId: 5, createdAt: 100 }), beat(3, { createdAt: 1 }), beat(4, { createdAt: 100, ext: 'flp' })],
      pitches: [pitch({ respondedAt: 100 }), pitch({ nextFollowupAt: NOW - 1 })], posts: [post({ status: 'planned', date: NOW - 2 * DAY })],
      sales: [sale({ soldAt: 100 }), sale({ soldAt: 1 })], splits: [], now: NOW, since: 50, comments: [{ createdAt: 100, seen: false }, { createdAt: 100, seen: true }]
    })
    expect(s).toEqual({ bounces: 1, replies: 1, sales: 1, earned: 45, comments: 1, due: 1, overdue: 1 })
  })
})
