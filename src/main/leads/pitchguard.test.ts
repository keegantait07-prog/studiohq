import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, test } from 'vitest'
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
