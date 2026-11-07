import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, test } from 'vitest'
import { openDb } from './db'

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
})
