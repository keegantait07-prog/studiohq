import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, test } from 'vitest'
import { openDb } from './db'
import { addBeat } from './test-helpers'

const tmp = mkdtempSync(join(tmpdir(), 'shq-mig-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('db migrations', () => {
  test('a fresh database is stamped with the latest version and takes no snapshot', () => {
    const dir = join(tmp, 'fresh')
    const db = openDb(dir)
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(2)
    db.close()
    expect(() => readdirSync(join(dir, 'backups'))).toThrow()
  })

  test('an old unversioned database is upgraded in place and snapshotted first', () => {
    const dir = join(tmp, 'old')
    openDb(dir).close()
    const raw = new Database(join(dir, 'studio-hq.db'))
    raw.pragma('user_version = 0') // what every database made before versioning looks like
    raw.close()
    const db = openDb(dir)
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(2)
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('pre-migration-v0-'))).toBe(true)
    db.close()
  })

  test('reopening an up-to-date database does nothing', () => {
    const dir = join(tmp, 'again')
    openDb(dir).close()
    openDb(dir).close()
    expect(() => readdirSync(join(dir, 'backups'))).toThrow()
  })

  test('a database at the version before Lead Finder upgrades and gains both tables', () => {
    const dir = join(tmp, 'pre-leads')
    openDb(dir).close()
    const raw = new Database(join(dir, 'studio-hq.db'))
    raw.exec('DROP TABLE leads; DROP TABLE suppressed')
    raw.pragma('user_version = 3')
    raw.close()
    const db = openDb(dir)
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(4)
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('leads','suppressed')").all() as { name: string }[]).map((r) => r.name).sort()
    expect(names).toEqual(['leads', 'suppressed'])
    db.close()
  })
  test('a database at the version before Store upgrades and gains the store columns', () => {
    const dir = join(tmp, 'pre-store')
    openDb(dir).close()
    const raw = new Database(join(dir, 'studio-hq.db'))
    raw.exec('DROP INDEX sales_external; ALTER TABLE sales DROP COLUMN external_id; ALTER TABLE license_types DROP COLUMN files; ALTER TABLE license_types DROP COLUMN perks')
    raw.pragma('user_version = 4')
    raw.close()
    const db = openDb(dir)
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(5)
    const cols = (t: string) => (db.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name)
    expect(cols('license_types')).toEqual(expect.arrayContaining(['files', 'perks']))
    expect(cols('sales')).toContain('external_id')
    addBeat(db, { id: 1, title: 'x' })
    const ins = db.prepare("INSERT INTO sales(beat_id,group_id,buyer,license_name,price,source,sold_at,created_at,external_id) VALUES(1,1,'b','Lease',1,'beatstars',1,1,?)")
    ins.run(null); ins.run(null)
    ins.run('A1')
    expect(() => ins.run('A1')).toThrow()
    db.close()
  })
})
