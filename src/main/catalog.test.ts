import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'shq-cat-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

import type Database from 'better-sqlite3'
import { openDb } from './db'
import { Catalog } from './catalog'
import { addBeat } from './test-helpers'

const A = 9001, B = 9002, C = 9003, D = 9004, FLP = 9005
let db: Database.Database
let cat: Catalog
let n = 0
beforeEach(() => {
  db = openDb(join(tmp, `db${++n}`))
  cat = new Catalog(db, () => null, () => '', () => [])
  for (const [id, title] of [[A, 'Alpha'], [B, 'Bravo'], [C, 'Charlie'], [D, 'Delta']] as const) addBeat(db, { id, title, bpm: 140, key: 'F#m' })
  addBeat(db, { id: FLP, title: 'Project only', ext: 'flp' })
})
const order = () => cat.status().entries.map((e) => e.beatId)
const entry = (id: number) => cat.status().entries.find((e) => e.beatId === id)!

test('addMany puts beats at the top in the order given, unpublished and without links', () => {
  expect(cat.addMany([A, B, C])).toBe(3)
  expect(order()).toEqual([A, B, C])
  expect(cat.status().entries.every((e) => e.state === 'changed' && e.noLink)).toBe(true)
  expect(entry(A)).toMatchObject({ bpm: 140, key: 'F#m', title: 'Alpha' })
  expect(cat.status().pending).toBe(true)
})

test('addMany skips beats already on the site', () => {
  cat.addMany([A, B, C])
  expect(cat.addMany([B, D])).toBe(1)
  expect(order()).toEqual([D, A, B, C])
})

test('addMany skips FL projects that have no audio', () => {
  expect(cat.addMany([FLP, A])).toBe(1)
  expect(order()).toEqual([A])
})

test('reorder lists the given beats first and keeps the rest in their order', () => {
  cat.addMany([A, B, C]); cat.addMany([D])
  cat.reorder([C, A])
  expect(order()).toEqual([C, A, D, B])
})

test('reorder ignores ids that are not on the site', () => {
  cat.addMany([A, B])
  cat.reorder([999999, B])
  expect(order()).toEqual([B, A])
})

test('a beat sold exclusively shows as sold, a beat whose file is gone shows as missing', () => {
  cat.addMany([A, B])
  db.prepare("INSERT INTO sales(beat_id,group_id,buyer,license_name,exclusive,price,source,sold_at,created_at) VALUES(?,?,'x','Exclusive',1,500,'other',1,1)").run(B, B)
  db.prepare('UPDATE beats SET missing=1 WHERE id=?').run(A)
  expect(entry(B).state).toBe('sold')
  expect(entry(A).state).toBe('missing')
})

test('giving a beat its own link clears the no-link flag and leaves changes pending', () => {
  cat.addMany([A])
  db.prepare("UPDATE settings SET value='0' WHERE key='site_dirty'").run()
  cat.update(A, { link: 'https://x' })
  expect(entry(A).noLink).toBe(false)
  expect(entry(A).state).toBe('changed')
  expect(cat.status().pending).toBe(true)
})

test('a row that has been published and not touched since is live', () => {
  cat.addMany([A])
  db.prepare('UPDATE site_beats SET dirty=0').run()
  expect(entry(A).state).toBe('live')
  cat.addMany([B])
  cat.reorder([B, A])
  expect(entry(A).state).toBe('live') // its position did not change
})

test('removeMany takes beats off and leaves changes pending', () => {
  cat.addMany([A, B])
  db.prepare("UPDATE settings SET value='0' WHERE key='site_dirty'").run()
  cat.removeMany([A])
  expect(order()).toEqual([B])
  expect(cat.status().pending).toBe(true)
})
