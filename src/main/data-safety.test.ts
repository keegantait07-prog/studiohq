import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, app: { getPath: () => tmpdir() } }))

import { applyPendingRestore, autoBackupTarget, checkBackup, openDb, stageRestore } from './db'
import { Sales } from './sales'
import { Crm } from './crm'
import { Content } from './content'
import { archiveWav } from './bounce'
import { parseName, pickMoved } from './filename'
import { p2 } from './splitsheet'
import { cleanSettingsPatch } from './settings-guard'
import { keyConfidence, reconcileBpm } from './analyze-rules'
import { parseLoudness, videoAudioFilter } from './loudness'
import { ProjectIndex } from './flpindex'
import type { Settings } from '../shared/types'

const tmp = mkdtempSync(join(tmpdir(), 'shq-safe-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
let n = 0
const fresh = () => { const dir = join(tmp, `db${++n}`); return { dir, db: openDb(dir) } }

function beat(db: Database.Database, title = 'Night Drive', group?: number) {
  const gid = group ?? Number(db.prepare('INSERT INTO groups(key,name) VALUES(?,?)').run(`${title}-${++n}`, title).lastInsertRowid)
  const id = Number(db.prepare(`INSERT INTO beats(path,filename,title,folder,ext,size,mtime,status,group_id,created_at) VALUES(?,?,?,?,?,1,1,'finished',?,1)`).run(`/b/${++n}.mp3`, 'x.mp3', title, '/b', 'mp3', gid).lastInsertRowid)
  return { id, gid }
}
const sale = (id: number, soldAt: number, exclusive = false) => ({ beatId: id, buyer: 'Ana', buyerEmail: '', contactId: null, licenseId: null, licenseName: exclusive ? 'Exclusive' : 'Lease', exclusive, price: 100, fee: 0, source: 'other', soldAt, notes: '' }) as Parameters<Sales['log']>[0]

describe('migration', () => {
  test('rows left behind by deleted pitches are removed, so new pitches cannot inherit them', () => {
    const { dir, db } = fresh()
    const { id } = beat(db)
    db.pragma('foreign_keys = OFF')
    db.prepare('INSERT INTO pitch_beats(pitch_id,beat_id) VALUES(1,?)').run(id)
    db.pragma('user_version = 2')
    db.close()
    const again = openDb(dir)
    expect((again.prepare('SELECT COUNT(*) c FROM pitch_beats').get() as { c: number }).c).toBe(0)
    again.close()
  })

  test('re-queues only what the detectors worked out', () => {
    const { dir, db } = fresh()
    const a = beat(db).id, b = beat(db).id
    db.prepare(`UPDATE beats SET analyzed_at=5, bpm_source='analysis' WHERE id=?`).run(a)
    db.prepare(`UPDATE beats SET analyzed_at=5, bpm_source='filename', key_source='user' WHERE id=?`).run(b)
    db.pragma('user_version = 2')
    db.close()
    const again = openDb(dir)
    const at = (id: number) => (again.prepare('SELECT analyzed_at v FROM beats WHERE id=?').get(id) as { v: number | null }).v
    expect(at(a)).toBeNull()
    expect(at(b)).toBe(5)
    again.close()
  })
})

describe('restore', () => {
  test('replaces the library, drops the old log and keeps a copy of what was there', () => {
    const { dir, db } = fresh()
    beat(db, 'Kept in backup')
    const backup = join(tmp, `b${++n}.db`)
    db.pragma('wal_checkpoint(TRUNCATE)')
    copyFileSync(join(dir, 'studio-hq.db'), backup)
    beat(db, 'Added later')
    db.close()
    writeFileSync(join(dir, 'studio-hq.db-wal'), 'stale log')

    stageRestore(dir, backup)
    expect(applyPendingRestore(dir)).toBe(true)
    expect(existsSync(join(dir, 'studio-hq.db-wal'))).toBe(false)
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('pre-restore-'))).toBe(true)
    const db2 = openDb(dir)
    expect((db2.prepare('SELECT title FROM beats').all() as { title: string }[]).map((b) => b.title)).toEqual(['Kept in backup'])
    db2.close()
    expect(applyPendingRestore(dir)).toBe(false)
  })

  test('refuses a file that is not a library', () => {
    const f = join(tmp, 'junk.db')
    writeFileSync(f, 'not a database')
    expect(() => checkBackup(f)).toThrow(/backup|opened/)
  })

  test('one automatic backup a day, newest five kept', () => {
    const dir = join(tmp, `auto${++n}`)
    mkdirSync(dir)
    for (let d = 1; d <= 7; d++) writeFileSync(join(dir, `auto-2026-11-0${d}.db`), 'x')
    writeFileSync(join(dir, 'studio-hq-manual.db'), 'x')
    expect(autoBackupTarget(dir, new Date(2026, 10, 7))).toBeNull()
    expect(readdirSync(dir).filter((f) => f.startsWith('auto-')).length).toBe(5)
    expect(autoBackupTarget(dir, new Date(2026, 10, 8))).toContain('auto-2026-11-08.db')
    expect(readdirSync(dir).filter((f) => f.startsWith('auto-')).length).toBe(4) // room for the new one
    expect(existsSync(join(dir, 'studio-hq-manual.db'))).toBe(true)
  })
})

describe('never double-sell', () => {
  test('a lease cannot be redated past the exclusive', () => {
    const { db } = fresh()
    const { id } = beat(db)
    const s = new Sales(db)
    const lease = s.log(sale(id, 100))
    s.log(sale(id, 200, true))
    expect(() => s.update(lease, { soldAt: 300 })).toThrow(/exclusively/)
    s.update(lease, { soldAt: 150 })
    db.close()
  })

  test('an exclusive cannot move before an existing lease', () => {
    const { db } = fresh()
    const { id } = beat(db)
    const s = new Sales(db)
    s.log(sale(id, 100))
    const ex = s.log(sale(id, 200, true))
    expect(() => s.update(ex, { soldAt: 50 })).toThrow(/lease/)
    db.close()
  })

  test('the database itself refuses a second exclusive', () => {
    const { db } = fresh()
    const { id, gid } = beat(db)
    new Sales(db).log(sale(id, 100, true))
    const raw = `INSERT INTO sales(beat_id,group_id,buyer,license_name,exclusive,price,sold_at,created_at) VALUES(?,?,'B','Exclusive',1,1,1,1)`
    expect(() => db.prepare(raw).run(id, gid)).toThrow(/UNIQUE/)
    db.close()
  })
})

describe('history', () => {
  test('removing a contact keeps their pitches and stops follow-ups', () => {
    const { db } = fresh()
    const { id } = beat(db)
    const crm = new Crm(db, () => 7, () => {})
    const c = crm.saveContact({ name: 'Ana' })
    const pitch = Number(db.prepare(`INSERT INTO pitches(contact_id,sent_at,next_followup_at) VALUES(?,1,999)`).run(c).lastInsertRowid)
    db.prepare('INSERT INTO pitch_beats(pitch_id,beat_id) VALUES(?,?)').run(pitch, id)
    crm.deleteContact(c)
    const all = crm.all()
    expect(all.contacts).toEqual([])
    expect(all.pitches[0].contactName).toBe('Ana')
    expect(all.pitches[0].nextFollowupAt).toBeNull()
    expect(all.pitches[0].beats[0].groupId).toBeGreaterThan(0)
    db.close()
  })

  test('a scheduled upload stops being overdue once its date passes, a hand-made plan does not', () => {
    const { db } = fresh()
    const { id } = beat(db)
    const c = new Content(db)
    c.savePost({ beatId: id, platform: 'youtube', status: 'planned', date: 1, url: 'https://youtu.be/x' })
    c.savePost({ beatId: id, platform: 'youtube', status: 'planned', date: 1 })
    expect(c.all().posts.map((p) => p.status).sort()).toEqual(['planned', 'posted'])
    db.close()
  })
})

describe('files', () => {
  test('a converted WAV moves to the archive and never overwrites an earlier one', () => {
    const dir = join(tmp, `w${++n}`)
    mkdirSync(dir)
    const take = () => { const f = join(dir, 'beat.wav'); writeFileSync(f, 'audio'); return archiveWav(f, join(dir, 'masters')) }
    expect(take()).toMatch(/masters\/beat\.wav$/)
    expect(take()).toMatch(/masters\/beat \(2\)\.wav$/)
    expect(existsSync(join(dir, 'beat.wav'))).toBe(false)
  })

  test('a rename matches by name first and refuses to guess between same-size stems', () => {
    const a = { filename: 'a.wav' }, b = { filename: 'b.wav' }
    expect(pickMoved([a, b], 'b.wav')).toBe(b)
    expect(pickMoved([a, b], 'c.wav')).toBeUndefined()
    expect(pickMoved([a], 'c.wav')).toBe(a)
  })

  test('an unplugged project folder does not delete its projects', async () => {
    const { db } = fresh()
    const root = join(tmp, `gone${++n}`)
    db.prepare('INSERT INTO flp_projects(path,name,mtime,size,parsed_at) VALUES(?,?,1,1,1)').run(join(root, 'song.flp'), 'song')
    const idx = new ProjectIndex(db, {} as never, () => [root], join(tmp, `midi${n}`), () => {}, () => {})
    await idx.index()
    expect((db.prepare('SELECT COUNT(*) c FROM flp_projects').get() as { c: number }).c).toBe(1)
    db.close()
  })

  test('a project really deleted from a readable folder is forgotten', async () => {
    const { db } = fresh()
    const root = join(tmp, `here${++n}`)
    mkdirSync(root)
    db.prepare('INSERT INTO flp_projects(path,name,mtime,size,parsed_at) VALUES(?,?,1,1,1)').run(join(root, 'song.flp'), 'song')
    const idx = new ProjectIndex(db, {} as never, () => [root], join(tmp, `midi${n}`), () => {}, () => {})
    await idx.index()
    expect((db.prepare('SELECT COUNT(*) c FROM flp_projects').get() as { c: number }).c).toBe(0)
    db.close()
  })
})

describe('names', () => {
  test('"final" is a version at the end of a name, part of the title at the start', () => {
    expect(parseName('/b/Final Boss.mp3', '', []).title).toBe('Final Boss')
    expect(parseName('/b/Night final.mp3', '', []).title).toBe('Night')
    expect(parseName('/b/Night final.mp3', '', []).versionLabel).toBe('final')
  })
})

describe('split sheets', () => {
  test('percentages print cleanly', () => {
    expect(p2(100)).toBe('100%')
    expect(p2(99.99999999999999)).toBe('100%')
    expect(p2(33.3)).toBe('33.3%')
    expect(p2(33.34)).toBe('33.34%')
    expect(p2(10)).toBe('10%')
  })
})

describe('settings from the renderer', () => {
  const now = { producerName: '', goalBeats: 3, notify: true, ownHandles: ['a'], claudePath: '', watchFolders: [], exportDir: '/x', ytImageFolder: '' } as unknown as Settings
  test('programs and folders cannot be set, unknown keys and wrong types are dropped', () => {
    expect(cleanSettingsPatch({ claudePath: '/tmp/evil', watchFolders: ['/'], exportDir: '/', ytImageFolder: '/', hacked: 1, goalBeats: 'x', ownHandles: [1] }, now)).toEqual({})
  })
  test('ordinary settings pass', () => {
    expect(cleanSettingsPatch({ producerName: 'Smalls', goalBeats: 5, notify: false, ownHandles: ['b'] }, now)).toEqual({ producerName: 'Smalls', goalBeats: 5, notify: false, ownHandles: ['b'] })
  })
  test('junk is ignored', () => { expect(cleanSettingsPatch(null, now)).toEqual({}) })
})

describe('tempo', () => {
  test('agreeing estimators are confident', () => { expect(reconcileBpm(140.2, 140)).toEqual({ bpm: 140, confidence: 'high' }) })
  test('the real half-time misses from the library resolve to the right tempo', () => {
    expect(reconcileBpm(79.5, 159).bpm).toBe(159)
    expect(reconcileBpm(76.6, 153).bpm).toBe(153)
    expect(reconcileBpm(77.7, 154).bpm).toBe(154)
    expect(reconcileBpm(79.5, 159).confidence).toBe('low')
  })
  test('a real disagreement stays flagged', () => { expect(reconcileBpm(120, 145)).toEqual({ bpm: 120, confidence: 'low' }) })
})

describe('key', () => {
  test('weak detections are flagged', () => {
    expect(keyConfidence(0.85)).toBe('high')
    expect(keyConfidence(0.8)).toBe('high')
    expect(keyConfidence(0.79)).toBe('low')
  })
})

describe('video loudness', () => {
  const report = 'noise\n[Parsed_loudnorm_0]\n{\n "input_i" : "-27.50",\n "input_tp" : "4.90",\n "input_lra" : "3.0"\n}\n'
  test('reads the ffmpeg report', () => {
    expect(parseLoudness(report)).toEqual({ lufs: -27.5, truePeak: 4.9 })
    expect(parseLoudness('no json')).toBeNull()
  })
  test('quiet beats come up, capped', () => {
    expect(videoAudioFilter({ lufs: -20, truePeak: -3 })).toMatch(/^volume=6\.0dB,alimiter/)
    expect(videoAudioFilter({ lufs: -40, truePeak: -3 })).toMatch(/^volume=12\.0dB,/)
  })
  test('loud beats are only limited, and an unknown level still gets the limiter', () => {
    expect(videoAudioFilter({ lufs: -7.5, truePeak: 4.9 })).toMatch(/^alimiter/)
    expect(videoAudioFilter(null)).toMatch(/^alimiter/)
  })
})
