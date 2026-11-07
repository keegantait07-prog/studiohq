import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, expect, test } from 'vitest'
import { openDb } from '../db'
import { producerGenres } from './genres'

const tmp = mkdtempSync(join(tmpdir(), 'shq-genres-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

test('producer genres are the distinct genre tags on your beats, lowercased', () => {
  const db = openDb(join(tmp, 'db'))
  expect(producerGenres(db)).toEqual([])
  db.prepare(`INSERT INTO groups(id,key,name) VALUES(1,'k','g')`).run()
  const beat = db.prepare(`INSERT INTO beats(id,path,filename,title,folder,ext,size,mtime,group_id,created_at,kind) VALUES(?,?,?,?,'/','wav',1,1,1,1,?)`)
  beat.run(1, '/a.wav', 'a.wav', 'A', 'beat')
  beat.run(2, '/b.wav', 'b.wav', 'B', 'beat')
  beat.run(3, '/l.wav', 'l.wav', 'L', 'loop')
  const tag = db.prepare('INSERT INTO tags(beat_id,kind,value) VALUES(?,?,?)')
  tag.run(1, 'genre', 'Trap')
  tag.run(2, 'genre', 'trap')
  tag.run(2, 'genre', 'drill')
  tag.run(1, 'vibe', 'dark')
  tag.run(3, 'genre', 'house')
  expect(producerGenres(db).sort()).toEqual(['drill', 'trap'])
})
