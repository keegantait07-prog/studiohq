import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTools, type ToolDef, type ToolDeps } from './tools'

const entry = (beatId: number, title: string, o: Record<string, unknown> = {}) => ({ beatId, title, genre: 'Trap', co: [], link: '', addedAt: 1, bpm: 140, key: 'Fm', state: 'live', noLink: true, ...o })
const lead = (id: number, o: Record<string, unknown> = {}) => ({ id, source: 'youtube', sourceId: `s${id}`, name: `Artist ${id}`, url: `https://y/${id}`, followers: 900, lastActiveAt: 1, genre: 'drill', bio: '', signals: [], email: '', emailSourceUrl: '', score: 70, reasons: ['small following'], status: 'new', contactId: null, createdAt: 1, ...o })

let t: Record<string, ToolDef>
let status: { url: string | null; hasToken: boolean; pending: boolean; entries: ReturnType<typeof entry>[] }
let leads: ReturnType<typeof lead>[]
let catalog: Record<'status' | 'addMany' | 'removeMany' | 'reorder' | 'update' | 'publish', ReturnType<typeof vi.fn>>
let leadsDep: Record<'list' | 'get' | 'setStatus' | 'promote' | 'isSuppressed', ReturnType<typeof vi.fn>>
let afterWrite: ReturnType<typeof vi.fn>
let releaseFor: ReturnType<typeof vi.fn>

beforeEach(() => {
  status = { url: 'https://smalls.netlify.app', hasToken: true, pending: true, entries: [entry(1, 'Alpha'), entry(2, 'Bravo', { link: 'https://b', noLink: false, state: 'changed' }), entry(3, 'Sold one', { state: 'sold' })] }
  leads = [lead(1), lead(2, { email: 'two@x.co', emailSourceUrl: 'https://two' }), lead(3, { status: 'in_crm', contactId: 9 })]
  catalog = { status: vi.fn(() => status), addMany: vi.fn((ids: number[]) => ids.length), removeMany: vi.fn(), reorder: vi.fn(), update: vi.fn(), publish: vi.fn(async () => 'https://smalls.netlify.app') }
  leadsDep = { list: vi.fn(() => leads), get: vi.fn((id: number) => leads.find((l) => l.id === id)), setStatus: vi.fn(), promote: vi.fn(() => 7), isSuppressed: vi.fn(() => false) }
  afterWrite = vi.fn()
  releaseFor = vi.fn((id: number) => ({ beatId: id, groupId: id, steps: [{ id: 'store', state: 'done', summary: 'Live' }], done: 1, total: 1 }))
  const beats: Record<number, { id: number; title: string; ext: string }> = { 1: { id: 1, title: 'Alpha', ext: 'mp3' }, 2: { id: 2, title: 'Bravo', ext: 'mp3' }, 4: { id: 4, title: 'Delta', ext: 'mp3' }, 5: { id: 5, title: 'Project only', ext: 'flp' } }
  const deps = {
    store: { listBeats: () => Object.values(beats), getBeat: (id: number) => (beats[id] ? { ...beats[id], peaks: [], versions: [], tags: { vibe: [], genre: [], artist: [] } } : null), updateBeat: vi.fn(), setTags: vi.fn(), releaseFor },
    crm: { all: () => ({ contacts: [] }), due: () => [], saveContact: vi.fn(), deleteContact: vi.fn(), logPitch: vi.fn(), logFollowup: vi.fn() },
    sales: { all: () => ({ sales: [] }), log: vi.fn() },
    content: { all: () => ({ posts: [], videos: [] }), savePost: vi.fn() },
    feedback: { all: () => ({ links: [], comments: [] }) },
    yt: { status: async () => ({}), prepare: vi.fn() },
    catalog, leads: leadsDep, afterWrite
  } as unknown as ToolDeps
  t = Object.fromEntries(buildTools(deps).map((x) => [x.name, x]))
})

describe('kinds', () => {
  it('the new reads are reads and the new changes need approval', () => {
    for (const n of ['release_status', 'store_status', 'list_leads']) expect(t[n]?.kind, n).toBe('read')
    for (const n of ['store_add_beats', 'store_remove_beats', 'store_reorder', 'store_update_entry', 'store_publish', 'promote_lead', 'set_lead_status']) expect(t[n]?.kind, n).toBe('write')
  })
})

describe('release_status', () => {
  it('returns the beat\'s checklist', async () => {
    expect(await t.release_status.run({ beatId: 1 })).toMatchObject({ beatId: 1, done: 1, total: 1 })
    expect(releaseFor).toHaveBeenCalledWith(1)
  })
  it('an unknown beat is an error, not a crash', async () => {
    expect(await t.release_status.run({ beatId: 99 })).toEqual({ error: 'No beat with id 99' })
    releaseFor.mockImplementationOnce(() => { throw new Error('That beat no longer exists.') })
    expect(await t.release_status.run({ beatId: 1 })).toEqual({ error: 'That beat no longer exists.' })
  })
})

describe('store_status', () => {
  it('lists the site without ever exposing a token', async () => {
    const r = (await t.store_status.run({})) as Record<string, unknown>
    expect(r).toMatchObject({ url: 'https://smalls.netlify.app', hasToken: true, pending: true, total: 3 })
    expect((r.beats as unknown[])[1]).toEqual({ beatId: 2, title: 'Bravo', genre: 'Trap', link: 'https://b', state: 'changed', noLink: false })
    expect(Object.keys(r).sort()).toEqual(['beats', 'hasToken', 'pending', 'total', 'url'])
  })
  it('honours the limit but reports the total', async () => {
    const r = (await t.store_status.run({ limit: 1 })) as { total: number; beats: unknown[] }
    expect(r.total).toBe(3)
    expect(r.beats).toHaveLength(1)
  })
})

describe('list_leads', () => {
  it('passes valid filters to the leads list and trims each lead to what is useful', async () => {
    const r = (await t.list_leads.run({ source: 'youtube', minScore: 60, hasEmail: true, status: 'new' })) as { total: number; leads: Record<string, unknown>[] }
    expect(leadsDep.list).toHaveBeenCalledWith({ source: 'youtube', minScore: 60, hasEmail: true, status: 'new' })
    expect(r.total).toBe(3)
    expect(r.leads[1]).toEqual({ id: 2, name: 'Artist 2', source: 'youtube', score: 70, reasons: ['small following'], status: 'new', url: 'https://y/2', followers: 900, genre: 'drill', email: 'two@x.co', emailSourceUrl: 'https://two' })
  })
  it('ignores filters it does not understand instead of passing them on', async () => {
    await t.list_leads.run({ source: 'myspace', status: 'maybe', minScore: 'high' })
    expect(leadsDep.list).toHaveBeenCalledWith({})
  })
})

describe('store_add_beats', () => {
  it('adds, does not publish, and tells the user which beats on the card', async () => {
    expect(await t.store_add_beats.run({ beatIds: [4, 1] })).toEqual({ ok: true, added: 2 })
    expect(catalog.addMany).toHaveBeenCalledWith([4, 1])
    expect(catalog.publish).not.toHaveBeenCalled()
    expect(afterWrite).toHaveBeenCalledTimes(1)
    const d = t.store_add_beats.describe({ beatIds: [4, 1] })
    expect(d).toContain('Delta')
    expect(d).toContain('Alpha')
    expect(d).toMatch(/not published/i)
  })
  it('refuses unknown beats, FL projects with no audio, empty lists and huge lists, before approval', () => {
    expect(t.store_add_beats.validate!({ beatIds: [] })).toMatch(/non-empty/)
    expect(t.store_add_beats.validate!({ beatIds: [99] })).toMatch(/99/)
    expect(t.store_add_beats.validate!({ beatIds: [5] })).toMatch(/audio/i)
    expect(t.store_add_beats.validate!({ beatIds: Array.from({ length: 101 }, (_, i) => i + 1) })).toMatch(/at most/)
    expect(t.store_add_beats.validate!({ beatIds: [1, 4] })).toBeNull()
  })
})

describe('store_remove_beats and store_reorder', () => {
  it('remove takes beats off without publishing', async () => {
    expect(await t.store_remove_beats.run({ beatIds: [1] })).toEqual({ ok: true, removed: 1 })
    expect(catalog.removeMany).toHaveBeenCalledWith([1])
    expect(catalog.publish).not.toHaveBeenCalled()
    expect(t.store_remove_beats.describe({ beatIds: [1] })).toContain('Alpha')
  })
  it('only beats that are on the site can be removed or reordered', () => {
    expect(t.store_remove_beats.validate!({ beatIds: [4] })).toMatch(/not on the store/)
    expect(t.store_reorder.validate!({ beatIds: [4] })).toMatch(/not on the store/)
    expect(t.store_reorder.validate!({ beatIds: [2, 1] })).toBeNull()
  })
  it('reorder passes the new order through', async () => {
    expect(await t.store_reorder.run({ beatIds: [2, 1] })).toEqual({ ok: true })
    expect(catalog.reorder).toHaveBeenCalledWith([2, 1])
  })
})

describe('store_update_entry', () => {
  it('changes title, genre and link, and only those', async () => {
    expect(await t.store_update_entry.run({ beatId: 1, title: 'Alpha II', genre: 'Drill', link: 'https://beatstars.com/x' })).toEqual({ ok: true })
    expect(catalog.update).toHaveBeenCalledWith(1, { title: 'Alpha II', genre: 'Drill', link: 'https://beatstars.com/x' })
    expect(t.store_update_entry.describe({ beatId: 1, link: 'https://x.co' })).toContain('https://x.co')
  })
  it('refuses a beat that is not on the site, nothing to change, and a link that is not a web address', () => {
    expect(t.store_update_entry.validate!({ beatId: 4, title: 'x' })).toMatch(/not on the store/)
    expect(t.store_update_entry.validate!({ beatId: 1 })).toMatch(/Nothing to change/)
    expect(t.store_update_entry.validate!({ beatId: 1, link: 'javascript:alert(1)' })).toMatch(/web address/)
    expect(t.store_update_entry.validate!({ beatId: 1, link: '' })).toBeNull()
  })
})

describe('store_publish', () => {
  it('publishes only through the approval path and says what goes live', async () => {
    expect(t.store_publish.kind).toBe('write')
    const d = t.store_publish.describe({})
    expect(d).toContain('2 beats')
    expect(d).toContain('https://smalls.netlify.app')
    expect(await t.store_publish.run({})).toEqual({ ok: true, url: 'https://smalls.netlify.app' })
    expect(afterWrite).toHaveBeenCalledTimes(1)
  })
  it('is refused up front without a token or with an empty store', () => {
    status.hasToken = false
    expect(t.store_publish.validate!({})).toMatch(/Netlify token/)
    status.hasToken = true; status.entries = []
    expect(t.store_publish.validate!({})).toMatch(/nothing on the store/i)
  })
  it('a failed publish comes back as an error and does not refresh as if it worked', async () => {
    catalog.publish.mockRejectedValueOnce(new Error('Netlify rejected the access token (401).'))
    expect(await t.store_publish.run({})).toEqual({ error: 'Netlify rejected the access token (401).' })
    expect(afterWrite).not.toHaveBeenCalled()
  })
})

describe('promote_lead and set_lead_status', () => {
  it('promote adds the lead to the CRM and names it on the card', async () => {
    expect(await t.promote_lead.run({ id: 2 })).toEqual({ ok: true, contactId: 7 })
    expect(leadsDep.promote).toHaveBeenCalledWith(2)
    expect(t.promote_lead.describe({ id: 2 })).toContain('Artist 2')
  })
  it('an unknown lead and an opted-out email are refused before approval', () => {
    expect(t.promote_lead.validate!({ id: 99 })).toMatch(/No lead/)
    leadsDep.isSuppressed.mockReturnValueOnce(true)
    expect(t.promote_lead.validate!({ id: 2 })).toMatch(/opted out/)
    expect(t.promote_lead.validate!({ id: 1 })).toBeNull()
  })
  it('set_lead_status accepts saved or skipped only', async () => {
    expect(await t.set_lead_status.run({ id: 1, status: 'skipped' })).toEqual({ ok: true })
    expect(leadsDep.setStatus).toHaveBeenCalledWith(1, 'skipped')
    expect(t.set_lead_status.validate!({ id: 1, status: 'in_crm' })).toMatch(/saved or skipped/)
    expect(t.set_lead_status.validate!({ id: 99, status: 'saved' })).toMatch(/No lead/)
  })
})
