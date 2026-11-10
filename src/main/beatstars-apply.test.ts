import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { openDb } from './db'
import { addBeat } from './test-helpers'
import { applyImport, readImport } from './beatstars-apply'

const tmp = mkdtempSync(join(tmpdir(), 'shq-bsa-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const HEAD = 'Order ID,Date,Track Title,License Type,Buyer,Buyer Email,Amount,Service Fee'
const line = (id: string, title: string, lic = 'MP3 Lease', amount = '25.00', fee = '2.50') => `${id},2026-10-03,${title},${lic},Sam,s@x.co,${amount},${fee}`
let db: Database.Database
let n = 0
const csv = (...lines: string[]) => { const p = join(tmp, `f${++n}.csv`); writeFileSync(p, [HEAD, ...lines].join('\n') + '\n'); return p }
const cols = (path: string) => readImport(db, path).columns
const sales = () => db.prepare('SELECT * FROM sales ORDER BY id').all() as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  db = openDb(join(tmp, `db${++n}`))
  addBeat(db, { id: 1, title: 'Alpha' })
  addBeat(db, { id: 2, title: 'Bravo' })
  addBeat(db, { id: 3, title: 'Charlie' })
})

describe('applyImport', () => {
  test('writes sales rows from BeatStars with the order id, tier, price and fee', () => {
    const f = csv(line('A1', 'Alpha'), line('A2', 'Bravo', 'WAV Lease', '50.00', '5.00'))
    const r = applyImport(db, f, cols(f), {})
    expect(r).toEqual({ imported: 2, duplicates: 0, skipped: 0, unmatched: 0 })
    const [a, b] = sales()
    expect(a).toMatchObject({ beat_id: 1, source: 'beatstars', external_id: 'A1', price: 25, fee: 2.5, buyer: 'Sam', buyer_email: 's@x.co', license_name: 'MP3 Lease', exclusive: 0 })
    expect(a.license_id).not.toBeNull()
    expect(b).toMatchObject({ beat_id: 2, external_id: 'A2', price: 50, fee: 5 })
  })

  test('importing the same file twice writes nothing the second time', () => {
    const f = csv(line('A1', 'Alpha'), line('A2', 'Bravo'))
    applyImport(db, f, cols(f), {})
    expect(applyImport(db, f, cols(f), {})).toEqual({ imported: 0, duplicates: 2, skipped: 0, unmatched: 0 })
    expect(sales()).toHaveLength(2)
  })

  test('a later export with two more orders and its columns in another order adds only the new ones', () => {
    const f1 = csv(line('A1', 'Alpha'))
    applyImport(db, f1, cols(f1), {})
    const p = join(tmp, `re${++n}.csv`)
    writeFileSync(p, ['Amount,Order ID,Track Title,Date,Buyer,License Type,Service Fee', '25,A1,Alpha,2026-10-03,Sam,MP3 Lease,2.5', '25,A2,Bravo,2026-10-04,Sam,MP3 Lease,2.5', '25,A3,Charlie,2026-10-05,Sam,MP3 Lease,2.5'].join('\n'))
    expect(applyImport(db, p, readImport(db, p).columns, {})).toMatchObject({ imported: 2, duplicates: 1 })
    expect(sales().map((s) => s.external_id)).toEqual(['A1', 'A2', 'A3'])
  })

  test('an exclusive sale marks the beat sold and leaves the site with changes pending', () => {
    const f = csv(line('E1', 'Alpha', 'Exclusive', '500.00', '50.00'))
    applyImport(db, f, cols(f), {})
    expect(sales()[0].exclusive).toBe(1)
    expect((db.prepare('SELECT status FROM beats WHERE id=1').get() as { status: string }).status).toBe('sold')
    expect((db.prepare("SELECT value FROM settings WHERE key='site_dirty'").get() as { value: string }).value).toBe('1')
  })

  test('a sale dated after an earlier exclusive of the same beat is skipped', () => {
    const f1 = csv(line('E1', 'Alpha', 'Exclusive', '500.00'))
    applyImport(db, f1, cols(f1), {})
    const f2 = csv(line('L1', 'Alpha'))
    expect(applyImport(db, f2, cols(f2), {})).toMatchObject({ imported: 0, skipped: 1 })
    expect(sales()).toHaveLength(1)
  })

  test('unmatched rows are counted and not written; the user can pick a beat for them', () => {
    const f = csv(line('A1', 'Nope'))
    expect(applyImport(db, f, cols(f), {})).toMatchObject({ imported: 0, unmatched: 1 })
    expect(applyImport(db, f, cols(f), { 2: 3 })).toMatchObject({ imported: 1 })
    expect(sales()[0].beat_id).toBe(3)
  })

  test('the column mapping is remembered for the next read', () => {
    const p = join(tmp, `odd${++n}.csv`)
    writeFileSync(p, 'Ref,When,Thing,Cash\nR1,2026-10-03,Alpha,25\n')
    expect(readImport(db, p).missing).toEqual(['orderId', 'date', 'title', 'gross'])
    const map = { orderId: 0, date: 1, title: 2, gross: 3 }
    expect(applyImport(db, p, map, {})).toMatchObject({ imported: 1 })
    const again = readImport(db, p)
    expect(again.missing).toEqual([])
    expect(again.columns).toMatchObject(map)
  })

  test('a failure part-way writes nothing', () => {
    db.exec(`CREATE TRIGGER boom BEFORE INSERT ON sales WHEN NEW.external_id='A3' BEGIN SELECT RAISE(ABORT,'boom'); END`)
    const f = csv(line('A1', 'Alpha'), line('A2', 'Bravo'), line('A3', 'Charlie'))
    expect(() => applyImport(db, f, cols(f), {})).toThrow(/boom/)
    expect(sales()).toHaveLength(0)
  })
})

describe('file rule', () => {
  const msg = /isn't a sales export Studio HQ can read/
  test('refuses non-csv, empty and header-only files, and missing paths', () => {
    const txt = join(tmp, 'a.txt'); writeFileSync(txt, HEAD + '\n' + line('A1', 'Alpha'))
    const empty = join(tmp, 'e.csv'); writeFileSync(empty, '')
    const headerOnly = join(tmp, 'h.csv'); writeFileSync(headerOnly, HEAD + '\n')
    for (const p of [txt, empty, headerOnly, join(tmp, 'missing.csv'), tmp]) {
      expect(() => readImport(db, p)).toThrow(msg)
      expect(() => applyImport(db, p, {}, {})).toThrow(msg)
    }
  })
})
