import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'shq-rel-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

import type Database from 'better-sqlite3'
import { openDb } from './db'
import { Catalog } from './catalog'
import { addBeat } from './test-helpers'
import { releaseFor } from './release'

let db: Database.Database
let n = 0
beforeEach(() => {
  db = openDb(join(tmp, `db${++n}`))
  addBeat(db, { id: 1, title: 'Alpha', groupId: 1 })
  addBeat(db, { id: 2, title: 'Alpha v2', groupId: 1 })
  addBeat(db, { id: 3, title: 'Other', groupId: 3 })
})
const step = (id: string, beatId = 1) => releaseFor(db, beatId).steps.find((s) => s.id === id)!
const contact = () => Number(db.prepare("INSERT INTO contacts(name,role,created_at) VALUES('Ana','artist',1)").run().lastInsertRowid)
const pitch = (contactId: number, beatId: number, status: string) => {
  const id = Number(db.prepare("INSERT INTO pitches(contact_id,sent_at,status) VALUES(?,?,?)").run(contactId, 1, status).lastInsertRowid)
  db.prepare('INSERT INTO pitch_beats(pitch_id,beat_id) VALUES(?,?)').run(id, beatId)
}

test('a beat with no activity', () => {
  const r = releaseFor(db, 1)
  expect(r.steps.map((s) => s.id)).toEqual(['store', 'video', 'post', 'pitch', 'feedback', 'splits', 'sale'])
  expect(r.steps.map((s) => s.state)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo', 'na', 'todo'])
  expect(r).toMatchObject({ beatId: 1, groupId: 1, done: 0, total: 6 })
})

test('activity on another version of the same song counts', () => {
  db.prepare("INSERT INTO posts(beat_id,platform,status,date,created_at) VALUES(2,'tiktok','posted',1,1)").run()
  expect(step('post', 1)).toMatchObject({ state: 'done', summary: '1 posted · TikTok' })
  expect(step('post', 3).state).toBe('todo')
})

test('works before Catalog has created site_beats', () => {
  expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='site_beats'").get()).toBeUndefined()
  expect(step('store')).toMatchObject({ state: 'todo', summary: 'Not on the store' })
})

describe('with the site table', () => {
  beforeEach(() => { new Catalog(db, () => null, () => '', () => []) })
  test('on the site is done with a from price; dirty or a missing file is in progress', () => {
    db.prepare("INSERT INTO site_beats(beat_id,title,position,added_at,dirty) VALUES(2,'Alpha',0,1,0)").run()
    db.prepare("UPDATE license_types SET default_price=NULL").run()
    db.prepare("UPDATE license_types SET default_price=30 WHERE name='WAV Lease'").run()
    expect(step('store')).toMatchObject({ state: 'done', summary: 'Live · from $30' })
    db.prepare('UPDATE site_beats SET dirty=1').run()
    expect(step('store')).toMatchObject({ state: 'doing', summary: 'Changes not published' })
    db.prepare('UPDATE site_beats SET dirty=0').run()
    db.prepare('UPDATE beats SET missing=1 WHERE id=2').run()
    expect(step('store')).toMatchObject({ state: 'doing', summary: 'File missing' })
  })
})

test('an exclusive sale takes the beat off the store', () => {
  db.prepare("INSERT INTO sales(beat_id,group_id,buyer,license_name,exclusive,price,source,sold_at,created_at) VALUES(2,1,'x','Exclusive',1,500,'other',1,1)").run()
  const r = releaseFor(db, 1)
  expect(r.steps.find((s) => s.id === 'store')).toMatchObject({ state: 'na', summary: 'Sold exclusively' })
  expect(r.steps.find((s) => s.id === 'sale')!.summary).toBe('1 sale · $500 · exclusive')
  expect(r.total).toBe(5)
})

test('an unknown beat', () => {
  expect(() => releaseFor(db, 999)).toThrow('That beat no longer exists.')
})

test('youtube videos count and are listed', () => {
  const v = db.prepare("INSERT INTO videos(beat_id,format,path,created_at) VALUES(?,?,?,?)")
  v.run(1, 'vertical', '/a.mp4', 1); v.run(2, 'youtube', '/b.mp4', 2)
  expect(step('video')).toMatchObject({ state: 'done', summary: '2 videos · vertical, youtube' })
})

describe('feedback', () => {
  const link = (slug: string, beatIds: number[]) => {
    const id = Number(db.prepare("INSERT INTO packs(slug,title,created_at,kind) VALUES(?,?,?,'feedback')").run(slug, slug, 1).lastInsertRowid)
    beatIds.forEach((b, i) => db.prepare('INSERT INTO pack_beats(pack_id,beat_id,position) VALUES(?,?,?)').run(id, b, i))
  }
  const comment = (id: string, slug: string, beatIndex: number, seen: number) =>
    db.prepare("INSERT INTO feedback_comments(id,slug,beat_index,name,time,text,created_at,seen) VALUES(?,?,?,?,?,?,?,?)").run(id, slug, beatIndex, 'n', 0, 't', 1, seen)

  test('an unseen comment is in progress, seeing it makes the step done', () => {
    link('a', [2]); comment('c1', 'a', 0, 0); comment('c2', 'a', 0, 1)
    expect(step('feedback')).toMatchObject({ state: 'doing', summary: '1 link · 1 new comment' })
    db.prepare("UPDATE feedback_comments SET seen=1").run()
    expect(step('feedback')).toMatchObject({ state: 'done', summary: '1 link · 0 new comments' })
  })
  test('a comment pointing past the link\'s beats is ignored', () => {
    link('a', [1]); comment('c1', 'a', 5, 0)
    expect(step('feedback')).toMatchObject({ state: 'done', summary: '1 link · 0 new comments' })
  })
  test('a comment on another song in the same link is not counted', () => {
    link('a', [3, 1]); comment('c1', 'a', 0, 0)
    expect(step('feedback', 1)).toMatchObject({ state: 'done' })
    expect(step('feedback', 3)).toMatchObject({ state: 'doing' })
  })
})

test('pitch and splits', () => {
  pitch(contact(), 2, 'placed')
  expect(step('pitch')).toMatchObject({ state: 'done', summary: 'Pitched to 1 · 1 replied' })
  db.prepare("UPDATE beats SET credits='@someone' WHERE id=1").run()
  expect(step('splits')).toMatchObject({ state: 'todo' })
  db.prepare("INSERT INTO beat_splits(group_id,name,pub_pct,master_pct) VALUES(1,'a',30,50),(1,'b',30,50)").run()
  expect(step('splits')).toMatchObject({ state: 'doing', summary: 'Publishing 60% · Master 100%' })
})
