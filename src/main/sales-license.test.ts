import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterAll, expect, test } from 'vitest'
import { openDb } from './db'
import { Sales } from './sales'

const tmp = mkdtempSync(join(tmpdir(), 'shq-lic-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

test('starter perks fill matching empty tiers only', () => {
  const dir = join(tmp, 'starter')
  openDb(dir).close()
  const raw = new Database(join(dir, 'studio-hq.db'))
  raw.exec(`DELETE FROM license_types;
    INSERT INTO license_types(id,name,exclusive,default_price,sort,files,perks) VALUES
      (1,'mp3 lease',0,25,0,'','[]'),(2,'Custom',0,10,1,'','[]'),(3,'WAV Lease',0,50,2,'','["mine"]')`)
  raw.pragma('user_version = 4')
  raw.exec('DROP INDEX sales_external; ALTER TABLE sales DROP COLUMN external_id')
  raw.close()
  const db = openDb(dir)
  const by = Object.fromEntries(new Sales(db).all().licenses.map((l) => [l.name, l]))
  expect(by['mp3 lease'].files).toBe('MP3')
  expect(by['mp3 lease'].perks).toEqual(['Up to 100k streams', '1 music video', 'Non-profit performances', 'Credit "Prod. SMALLS"'])
  expect(by['Custom'].files).toBe('')
  expect(by['Custom'].perks).toEqual([])
  expect(by['WAV Lease'].perks).toEqual(['mine'])
  expect(by['WAV Lease'].files).toBe('')
  db.close()
})

test('a brand new database starts with files and perks on its seeded tiers', () => {
  const db = openDb(join(tmp, 'fresh'))
  const l = new Sales(db).all().licenses
  expect(l.find((x) => x.name === 'MP3 Lease')?.files).toBe('MP3')
  expect(l.find((x) => x.name === 'Unlimited Lease')?.files).toBe('MP3 + WAV + Stems')
  expect(l.find((x) => x.name === 'Exclusive')?.perks).toHaveLength(4)
  db.close()
})

test('saveLicense round-trips files and perks', () => {
  const db = openDb(join(tmp, 'save'))
  const s = new Sales(db)
  const id = s.saveLicense({ name: 'Stems', exclusive: false, defaultPrice: 80, files: ' WAV + Stems ', perks: [' a ', '', 'b', '1', '2', '3', '4', '5', '6', '7'] })
  const l = s.all().licenses.find((x) => x.id === id)!
  expect(l.files).toBe('WAV + Stems')
  expect(l.perks).toEqual(['a', 'b', '1', '2', '3', '4', '5', '6'])
  s.saveLicense({ id, name: 'Stems', exclusive: false })
  expect(s.all().licenses.find((x) => x.id === id)!.perks).toEqual(['a', 'b', '1', '2', '3', '4', '5', '6'])
  db.close()
})
