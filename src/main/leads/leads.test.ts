import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { LeadCandidate } from '../../shared/leads'
import { Crm } from '../crm'
import { openDb } from '../db'
import { Leads } from './index'

const tmp = mkdtempSync(join(tmpdir(), 'shq-leads-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const NOW = 1_700_000_000_000
let n = 0
let db: Database.Database
let crm: Crm
let leads: Leads

beforeEach(() => {
  db = openDb(join(tmp, `db${n++}`))
  crm = new Crm(db, () => 7, () => {})
  leads = new Leads(db, crm, () => ['trap'], () => NOW)
})

function cand(o: Partial<LeadCandidate> = {}): LeadCandidate {
  return {
    source: 'youtube', sourceId: 'a', name: 'Artist A', url: 'https://youtube.com/@a', followers: 500,
    lastActiveAt: NOW - 86_400_000, genre: 'trap', bio: '', signals: [], email: '', emailSourceUrl: '', ...o
  }
}

describe('Leads store', () => {
  test('addCandidates scores on insert and dedupes on (source, sourceId)', () => {
    expect(leads.addCandidates([cand(), cand({ name: 'Again' })])).toEqual({ added: 1, duplicates: 1 })
    expect(leads.addCandidates([cand()])).toEqual({ added: 0, duplicates: 1 })
    expect(leads.addCandidates([cand({ source: 'soundcloud' })])).toEqual({ added: 1, duplicates: 0 })
    const l = leads.list()[0]
    expect(l.score).toBeGreaterThan(50)
    expect(l.reasons.length).toBeGreaterThan(0)
    expect(l.status).toBe('new')
  })

  test('same email in a different case is a duplicate, and emails are stored normalised', () => {
    leads.addCandidates([cand({ sourceId: 'a', email: 'Foo@X.com', emailSourceUrl: 'https://x.com/about' })])
    expect(leads.addCandidates([cand({ sourceId: 'b', email: ' foo@x.COM ', emailSourceUrl: 'https://y.com' })])).toEqual({ added: 0, duplicates: 1 })
    expect(leads.list()[0].email).toBe('foo@x.com')
  })

  test('an email that does not normalise is stored as empty', () => {
    leads.addCandidates([cand({ email: 'not an email', emailSourceUrl: 'https://z.com' })])
    const l = leads.list()[0]
    expect(l.email).toBe('')
  })

  test('a stored email with no source url gets "added by you"', () => {
    leads.addCandidates([cand({ sourceId: 'a', email: 'a@x.com', emailSourceUrl: '' })])
    expect(leads.list()[0].emailSourceUrl).toBe('added by you')
    leads.addCandidates([cand({ sourceId: 'b' })])
    const b = leads.list().find((l) => l.sourceId === 'b')!
    leads.setEmail(b.id, 'B@x.com', '')
    const after = leads.list().find((l) => l.id === b.id)!
    expect(after.email).toBe('b@x.com')
    expect(after.emailSourceUrl).toBe('added by you')
    leads.setEmail(b.id, 'b@x.com', 'https://x.com/contact')
    expect(leads.list().find((l) => l.id === b.id)!.emailSourceUrl).toBe('https://x.com/contact')
  })

  test('get returns one lead or undefined', () => {
    leads.addCandidates([cand({ sourceId: 'g', name: 'Gee' })])
    const id = leads.list()[0].id
    expect(leads.get(id)?.name).toBe('Gee')
    expect(leads.get(id + 99)).toBeUndefined()
  })

  test('list sorts by score descending and filters', () => {
    leads.addCandidates([
      cand({ sourceId: 'low', followers: 150_000, lastActiveAt: null, genre: '' }),
      cand({ sourceId: 'high', followers: 300, email: 'h@x.com', emailSourceUrl: 'https://h.com' }),
      cand({ source: 'reddit', sourceId: 'mid', followers: null, lastActiveAt: null, genre: '' })
    ])
    const all = leads.list()
    expect(all.map((l) => l.sourceId)).toEqual(['high', 'mid', 'low'])
    expect(leads.list({ source: 'reddit' }).map((l) => l.sourceId)).toEqual(['mid'])
    expect(leads.list({ hasEmail: true }).map((l) => l.sourceId)).toEqual(['high'])
    expect(leads.list({ hasEmail: false }).map((l) => l.sourceId)).toEqual(['mid', 'low'])
    expect(leads.list({ minScore: 60 }).map((l) => l.sourceId)).toEqual(['high'])
    leads.setStatus(all[0].id, 'skipped')
    expect(leads.list({ status: 'skipped' }).map((l) => l.sourceId)).toEqual(['high'])
  })

  test('promote creates an artist contact with email and url, and a second lead with the same email links to it', () => {
    leads.addCandidates([cand({ email: 'p@x.com', emailSourceUrl: 'https://p.com' })])
    const id = leads.list()[0].id
    const cid = leads.promote(id)
    const c = crm.all().contacts.find((x) => x.id === cid)!
    expect(c.role).toBe('artist')
    expect(c.email).toBe('p@x.com')
    expect(c.links.some((l) => l.url === 'https://youtube.com/@a')).toBe(true)
    const l = leads.list()[0]
    expect(l.status).toBe('in_crm')
    expect(l.contactId).toBe(cid)

    // a second lead with the same email can only arise via setEmail, since addCandidates dedupes
    leads.addCandidates([cand({ sourceId: 'b', name: 'B' })])
    const b = leads.list().find((x) => x.sourceId === 'b')!
    leads.setEmail(b.id, 'P@x.com', 'https://b.com')
    expect(leads.promote(b.id)).toBe(cid)
    expect(crm.all().contacts).toHaveLength(1)
  })

  test('promote ignores archived contacts', () => {
    const old = crm.saveContact({ name: 'Old', email: 'p@x.com' })
    crm.deleteContact(old)
    leads.addCandidates([cand({ email: 'p@x.com', emailSourceUrl: 'https://p.com' })])
    expect(leads.promote(leads.list()[0].id)).not.toBe(old)
  })

  test('suppress normalises, and isSuppressed matches any case or spacing', () => {
    expect(leads.isSuppressed('foo@x.com')).toBe(false)
    leads.suppress('foo@x.com', 'asked to stop')
    expect(leads.isSuppressed('  FOO@x.com')).toBe(true)
    expect(leads.isSuppressed('mailto:foo@x.com')).toBe(true)
    leads.suppress('FOO@x.com', 'again')
    const list = leads.suppressedList()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ email: 'foo@x.com', reason: 'asked to stop', createdAt: NOW })
  })

  test('skip and save never move a lead out of in_crm', () => {
    leads.addCandidates([cand()])
    const id = leads.list()[0].id
    const cid = leads.promote(id)
    leads.setStatus(id, 'skipped')
    leads.setStatus(id, 'saved')
    expect(leads.get(id)).toMatchObject({ status: 'in_crm', contactId: cid })
  })

  test('promoting an email-less lead twice returns the same contact', () => {
    leads.addCandidates([cand()])
    const id = leads.list()[0].id
    const cid = leads.promote(id)
    expect(leads.promote(id)).toBe(cid)
    expect(crm.all().contacts).toHaveLength(1)
  })

  test('a lead linked to a live contact but no longer in_crm reuses that contact', () => {
    leads.addCandidates([cand()])
    const id = leads.list()[0].id
    const cid = leads.promote(id)
    db.prepare("UPDATE leads SET status='skipped' WHERE id=?").run(id) // as older builds could do
    expect(leads.promote(id)).toBe(cid)
    expect(crm.all().contacts).toHaveLength(1)
    expect(leads.get(id)?.status).toBe('in_crm')
  })

  test('a lead whose contact was archived is linked to a live contact again', () => {
    leads.addCandidates([cand()])
    const id = leads.list()[0].id
    const old = leads.promote(id)
    crm.deleteContact(old)
    const cid = leads.promote(id)
    expect(cid).not.toBe(old)
    expect(crm.all().contacts.map((c) => c.id)).toEqual([cid])
    expect(leads.get(id)).toMatchObject({ status: 'in_crm', contactId: cid })
  })

  test('promote is atomic: a failure after the contact is made leaves nothing behind', () => {
    leads.addCandidates([cand()])
    const id = leads.list()[0].id
    const real = crm.saveContact.bind(crm)
    const spy = vi.spyOn(crm, 'saveContact').mockImplementation((c) => { real(c); throw new Error('boom') })
    expect(() => leads.promote(id)).toThrow('boom')
    spy.mockRestore()
    expect(crm.all().contacts).toHaveLength(0)
    expect(leads.get(id)).toMatchObject({ status: 'new', contactId: null })
  })

  test('a bio that asks for beats adds the asks_for_beats signal once, from any source', () => {
    leads.addCandidates([
      cand({ source: 'soundcloud', sourceId: 's', bio: 'Rapper from Leeds, need beats!' }),
      cand({ source: 'manual', sourceId: 'm', bio: 'looking for a producer', signals: ['asks_for_beats'] }),
      cand({ source: 'audiomack', sourceId: 'q', bio: 'I make my own beats' })
    ])
    const by = (sid: string) => leads.list().find((l) => l.sourceId === sid)!
    expect(by('s').signals).toEqual(['asks_for_beats'])
    expect(by('s').reasons.some((r) => r.startsWith('Asks for beats'))).toBe(true)
    expect(by('m').signals).toEqual(['asks_for_beats'])
    expect(by('q').signals).toEqual([])
  })
})
