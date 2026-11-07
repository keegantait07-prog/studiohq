import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, test } from 'vitest'
import { Crm } from '../crm'
import { openDb } from '../db'
import { assertNotSuppressed, Leads } from './index'

const tmp = mkdtempSync(join(tmpdir(), 'shq-guard-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function make(): Leads {
  const db = openDb(join(tmp, 'db'))
  return new Leads(db, new Crm(db, () => 7, () => {}), () => [], () => 1)
}

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
