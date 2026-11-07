import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { buildTools, type ToolDeps } from '../assistant/tools'
import { Crm } from '../crm'
import { openDb } from '../db'
import { assertContactNotSuppressed, assertNotSuppressed, assertPitchNotSuppressed, Leads } from './index'

const tmp = mkdtempSync(join(tmpdir(), 'shq-guard-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function setup() {
  const db = openDb(join(tmp, `db${n++}`))
  const crm = new Crm(db, () => 7, () => {})
  return { crm, leads: new Leads(db, crm, () => [], () => 1) }
}
const make = (): Leads => setup().leads

describe('assertNotSuppressed', () => {
  test('throws for a suppressed address in any case or padding, quoting the email as given', () => {
    const leads = make()
    leads.suppress('ada@example.com', 'opted out')
    expect(() => assertNotSuppressed(leads, ' Ada@Example.com ')).toThrow(new Error(' Ada@Example.com  opted out and cannot be pitched.'))
    expect(() => assertNotSuppressed(leads, 'ada@example.com')).toThrow('ada@example.com opted out and cannot be pitched.')
  })
  test('allows unsuppressed and empty addresses', () => {
    const leads = make()
    expect(() => assertNotSuppressed(leads, 'bob@example.com')).not.toThrow()
    expect(() => assertNotSuppressed(leads, '')).not.toThrow()
  })
})

describe('server guards', () => {
  test('contact guard checks any contact with an email and throws for unknown or archived-then-missing ids', () => {
    const { crm, leads } = setup()
    const id = crm.saveContact({ name: 'Ada', email: 'Ada@Example.com' })
    const free = crm.saveContact({ name: 'Bob', email: 'bob@example.com' })
    leads.suppress('ada@example.com', 'opted out')
    expect(() => assertContactNotSuppressed(leads, crm, id)).toThrow('Ada@Example.com opted out and cannot be pitched.')
    expect(() => assertContactNotSuppressed(leads, crm, free)).not.toThrow()
    crm.deleteContact(id)
    expect(() => assertContactNotSuppressed(leads, crm, id)).toThrow('opted out')
    expect(() => assertContactNotSuppressed(leads, crm, 9999)).toThrow('Contact not found.')
  })
  test('pitch guard resolves the contact via the pitch and throws for an unknown pitch', () => {
    const { crm, leads } = setup()
    const id = crm.saveContact({ name: 'Ada', email: 'ada@example.com' })
    const pid = crm.logPitch({ contactId: id, beatIds: [], channel: 'email', subject: 's', link: '', packId: null })
    expect(() => assertPitchNotSuppressed(leads, crm, pid)).not.toThrow()
    leads.suppress('ADA@example.com', 'opted out')
    expect(() => assertPitchNotSuppressed(leads, crm, pid)).toThrow('opted out and cannot be pitched.')
    expect(() => assertPitchNotSuppressed(leads, crm, 9999)).toThrow('Pitch not found.')
  })
})

const pitchOf = (contactId: number) => ({ contactId, beatIds: [], channel: 'email' as const, subject: 's', link: '', packId: null })

describe('the CRM itself refuses opted-out contacts (every caller shares it)', () => {
  test('logPitch and logFollowup throw for a suppressed contact; unknown ids throw', () => {
    const { crm, leads } = setup()
    const id = crm.saveContact({ name: 'Ada', email: 'ada@example.com' })
    const pid = crm.logPitch(pitchOf(id))
    leads.suppress('ada@example.com', 'opted out')
    expect(() => crm.logPitch(pitchOf(id))).toThrow('ada@example.com opted out and cannot be pitched.')
    expect(() => crm.logFollowup(pid)).toThrow('opted out and cannot be pitched.')
    expect(() => crm.logPitch(pitchOf(9999))).toThrow('Contact not found.')
    expect(() => crm.logFollowup(9999)).toThrow('Pitch not found.')
  })

  test('the assistant log_pitch tool is blocked for a suppressed contact and for a follow-up on their pitch', async () => {
    const { crm, leads } = setup()
    const id = crm.saveContact({ name: 'Ada', email: 'Ada <ada@example.com>' })
    const pid = crm.logPitch(pitchOf(id))
    leads.suppress('ada@example.com', 'opted out')
    const afterWrite = vi.fn()
    const noop = (): never => { throw new Error('not used') }
    const tools = buildTools({
      store: { listBeats: () => [], getBeat: () => null, updateBeat: noop, setTags: noop } as unknown as ToolDeps['store'],
      crm, sales: { all: noop, log: noop } as unknown as ToolDeps['sales'], content: { all: noop, savePost: noop } as unknown as ToolDeps['content'],
      feedback: { all: () => ({ links: [], comments: [] }) } as unknown as ToolDeps['feedback'], yt: { status: noop, prepare: noop } as unknown as ToolDeps['yt'], afterWrite
    })
    const logPitch = tools.find((t) => t.name === 'log_pitch')!
    expect(await logPitch.run({ contactId: id, beatIds: [] })).toEqual({ error: 'Ada <ada@example.com> opted out and cannot be pitched.' })
    expect(await logPitch.run({ followUpPitchId: pid })).toEqual({ error: 'Ada <ada@example.com> opted out and cannot be pitched.' })
    expect(afterWrite).not.toHaveBeenCalled()
    expect(crm.all().pitches.find((p) => p.id === pid)?.followupCount).toBe(0)
  })
})

describe('opting out stops follow-ups', () => {
  test('suppress clears the follow-up date of open pitches to that address, and only those', () => {
    const { crm, leads } = setup()
    const ada = crm.saveContact({ name: 'Ada', email: 'Ada <ADA@example.com>' })
    const bob = crm.saveContact({ name: 'Bob', email: 'bob@example.com' })
    const open = crm.logPitch(pitchOf(ada))
    const other = crm.logPitch(pitchOf(bob))
    leads.suppress('ada@example.com', 'opted out')
    const next = (id: number) => crm.all().pitches.find((p) => p.id === id)?.nextFollowupAt
    expect(next(open)).toBeNull()
    expect(next(other)).not.toBeNull()
  })

  test('due() never lists a suppressed address, even if a date comes back', () => {
    const { crm, leads } = setup()
    const ada = crm.saveContact({ name: 'Ada', email: 'ada@example.com' })
    const bob = crm.saveContact({ name: 'Bob', email: 'bob@example.com' })
    const pa = crm.logPitch(pitchOf(ada))
    const pb = crm.logPitch(pitchOf(bob))
    leads.suppress('ada@example.com', 'opted out')
    const db = (crm as unknown as { db: { prepare(s: string): { run(...a: unknown[]): void } } }).db
    db.prepare('UPDATE pitches SET next_followup_at=? WHERE id IN (?,?)').run(Date.now() - 1000, pa, pb)
    expect(crm.due().map((d) => d.pitchId)).toEqual([pb])
  })

  test('editing an opted-out contact does not restart their follow-ups', () => {
    const { crm, leads } = setup()
    const ada = crm.saveContact({ name: 'Ada', email: 'ada@example.com' })
    const pa = crm.logPitch(pitchOf(ada))
    leads.suppress('ada@example.com', 'opted out')
    crm.saveContact({ id: ada, name: 'Ada', email: 'ada@example.com', followupDays: 3 })
    crm.updatePitch(pa, { status: 'listened' })
    expect(crm.all().pitches.find((p) => p.id === pa)?.nextFollowupAt).toBeNull()
  })
})

describe('free-text contact emails', () => {
  test('suppress stores every address found and isSuppressed matches any of them', () => {
    const { leads } = setup()
    leads.suppress('Ada <ada@x.com>', 'opted out')
    expect(leads.isSuppressed('ada@x.com')).toBe(true)
    expect(leads.isSuppressed('Ada Lovelace <ADA@x.com>')).toBe(true)
    expect(leads.isSuppressed('bob@y.com, ada@x.com')).toBe(true)
    expect(leads.isSuppressed('bob@y.com')).toBe(false)
    leads.suppress('c@x.com, d@y.com', 'opted out')
    expect(leads.suppressedList().map((s) => s.email).sort()).toEqual(['ada@x.com', 'c@x.com', 'd@y.com'])
  })

  test('suppress with no address throws a clear error and stores nothing', () => {
    const { leads } = setup()
    expect(() => leads.suppress('call me', 'opted out')).toThrow('Add a valid email address to this contact first.')
    expect(() => leads.suppress('', 'opted out')).toThrow('Add a valid email address to this contact first.')
    expect(leads.suppressedList()).toEqual([])
  })

  test('the pitch guard catches a suppressed address hidden in a free-text email', () => {
    const { crm, leads } = setup()
    const id = crm.saveContact({ name: 'Two', email: 'bob@y.com, ada@x.com' })
    leads.suppress('ada@x.com', 'opted out')
    expect(() => assertContactNotSuppressed(leads, crm, id)).toThrow('opted out')
    expect(() => crm.logPitch(pitchOf(id))).toThrow('opted out')
  })
})
