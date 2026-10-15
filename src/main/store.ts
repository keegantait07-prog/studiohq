import type Database from 'better-sqlite3'
import { dirname, basename, extname, relative, sep } from 'path'
import { homedir, cpus } from 'os'
import { Worker } from 'worker_threads'
import createWorker from './analyze.worker?nodeWorker'
import type { AnalyzeResult } from './analyze.worker'
import { parseName, genreFromFolder } from './filename'
import { normalizeKey } from '../shared/key'
import { scanProjects, matchProject, type ProjectFile } from './projects'
import { TAG_KINDS, type Beat, type BeatDetail, type BeatPatch, type ScanStatus, type Settings, type Status, type TagKind } from '../shared/types'

const DEFAULTS: Settings = {
  watchFolders: [`${homedir()}/Desktop/! BEATS`],
  projectFolders: [`${homedir()}/Documents/Image-Line/FL Studio/Projects`],
  includeIdeas: false,
  ownHandles: ['smalls', 'prodbysmalls'],
  producerName: '',
  followupDays: 7,
  notify: true
}

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export class Store {
  private projects: ProjectFile[] = []
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: number[] = []
  private queued = new Set<number>()
  private scan: ScanStatus = { pending: 0, done: 0, total: 0 }
  private dirty = new Set<number>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    readonly db: Database.Database,
    private emitChanged: (ids: number[]) => void,
    private emitScan: (s: ScanStatus) => void
  ) {
    const n = Math.max(1, Math.min(3, cpus().length - 2))
    for (let i = 0; i < n; i++) {
      const w = createWorker({}) as Worker
      w.on('message', (r: AnalyzeResult) => this.onResult(w, r))
      w.on('error', (e) => console.error('analysis worker error', e))
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  // ---- settings ----
  getSettings(): Settings {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key='app'`).get() as { value: string } | undefined
    return { ...DEFAULTS, ...(r ? JSON.parse(r.value) : {}) }
  }
  saveSettings(s: Settings): void {
    this.db.prepare(`INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(s))
  }

  // ---- reads ----
  private tagMap(): Map<number, Record<TagKind, string[]>> {
    const m = new Map<number, Record<TagKind, string[]>>()
    for (const t of this.db.prepare(`SELECT beat_id, kind, value FROM tags ORDER BY value`).all() as Row[]) {
      let e = m.get(t.beat_id)
      if (!e) m.set(t.beat_id, (e = { vibe: [], genre: [], artist: [] }))
      e[t.kind as TagKind].push(t.value)
    }
    return m
  }
  private toBeat(r: Row, tags?: Record<TagKind, string[]>): Beat {
    return {
      id: r.id, path: r.path, filename: r.filename, title: r.title, folder: r.folder, ext: r.ext, size: r.size, mtime: r.mtime,
      duration: r.duration, bpm: r.bpm, bpmSource: r.bpm_source, bpmConfidence: r.bpm_confidence,
      key: r.key, keySource: r.key_source, status: r.status, notes: r.notes, credits: r.credits,
      groupId: r.group_id, versionLabel: r.version_label, projectPath: r.project_path, projectConfidence: r.project_confidence,
      missing: !!r.missing, analyzed: r.analyzed_at != null, thumb: r.thumb ? JSON.parse(r.thumb) : [],
      tags: tags ?? { vibe: [], genre: [], artist: [] }, createdAt: r.created_at
    }
  }
  listBeats(): Beat[] {
    const tags = this.tagMap()
    const rows = this.db.prepare(`SELECT id,path,filename,title,folder,ext,size,mtime,duration,bpm,bpm_source,bpm_confidence,key,key_source,status,notes,credits,group_id,version_label,project_path,project_confidence,missing,analyzed_at,thumb,created_at FROM beats WHERE missing=0 ORDER BY mtime DESC`).all() as Row[]
    return rows.map((r) => this.toBeat(r, tags.get(r.id)))
  }
  getBeat(id: number): BeatDetail | null {
    const r = this.db.prepare(`SELECT * FROM beats WHERE id=?`).get(id) as Row | undefined
    if (!r) return null
    const tags = this.tagMap()
    const versions = (this.db.prepare(`SELECT * FROM beats WHERE group_id=? AND missing=0 ORDER BY mtime DESC`).all(r.group_id) as Row[]).map((v) => this.toBeat(v, tags.get(v.id)))
    return { ...this.toBeat(r, tags.get(id)), peaks: r.peaks ? JSON.parse(r.peaks) : [], versions }
  }
  allTags(): Record<TagKind, string[]> {
    const out: Record<TagKind, string[]> = { vibe: [], genre: [], artist: [] }
    for (const t of this.db.prepare(`SELECT kind, value, COUNT(*) c FROM tags GROUP BY kind, value ORDER BY c DESC`).all() as Row[]) out[t.kind as TagKind].push(t.value)
    return out
  }
  pathOf(id: number): string | null {
    return (this.db.prepare(`SELECT path FROM beats WHERE id=?`).get(id) as Row | undefined)?.path ?? null
  }

  // ---- writes from UI ----
  updateBeat(id: number, p: BeatPatch): void {
    const set: string[] = []
    const val: unknown[] = []
    const add = (col: string, v: unknown) => { set.push(`${col}=?`); val.push(v) }
    if (p.title !== undefined) add('title', p.title.trim() || 'Untitled')
    if (p.status !== undefined) add('status', p.status)
    if (p.bpm !== undefined) { add('bpm', p.bpm); add('bpm_source', p.bpm == null ? null : 'user'); add('bpm_confidence', p.bpm == null ? null : 'high') }
    if (p.key !== undefined) { const k = p.key ? normalizeKey(p.key) : null; add('key', k); add('key_source', k ? 'user' : null) }
    if (p.notes !== undefined) add('notes', p.notes)
    if (p.versionLabel !== undefined) add('version_label', p.versionLabel.trim())
    if (p.projectPath !== undefined) { add('project_path', p.projectPath); add('project_confidence', p.projectPath ? 1 : null) }
    if (!set.length) return
    this.db.prepare(`UPDATE beats SET ${set.join(',')} WHERE id=?`).run(...val, id)
    this.touch(id)
  }
  setTags(id: number, tags: Record<TagKind, string[]>): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM tags WHERE beat_id=?`).run(id)
      const ins = this.db.prepare(`INSERT OR IGNORE INTO tags(beat_id,kind,value) VALUES(?,?,?)`)
      for (const k of TAG_KINDS) for (const v of tags[k] ?? []) if (v.trim()) ins.run(id, k, v.trim().toLowerCase())
    })
    tx()
    this.touch(id)
  }

  // ---- ingestion ----
  refreshProjects(): void {
    this.projects = scanProjects(this.getSettings().projectFolders)
  }
  relinkProjects(): void {
    const rows = this.db.prepare(`SELECT id,title FROM beats WHERE missing=0 AND (project_path IS NULL OR project_confidence<1)`).all() as Row[]
    const upd = this.db.prepare(`UPDATE beats SET project_path=?, project_confidence=? WHERE id=?`)
    this.db.transaction(() => {
      for (const r of rows) {
        const m = matchProject(r.title, this.projects)
        upd.run(m?.path ?? null, m?.score ?? null, r.id)
      }
    })()
    this.touchAll()
  }

  groupFor(key: string, name: string): number {
    const g = this.db.prepare(`SELECT id FROM groups WHERE key=?`).get(key) as Row | undefined
    if (g) return g.id
    return Number(this.db.prepare(`INSERT INTO groups(key,name) VALUES(?,?)`).run(key, name).lastInsertRowid)
  }

  upsertFile(path: string, size: number, mtime: number, root: string): void {
    const ex = this.db.prepare(`SELECT id,size,mtime,analyzed_at,missing FROM beats WHERE path=?`).get(path) as Row | undefined
    if (ex) {
      if (ex.size === size && Math.abs(ex.mtime - mtime) < 1) {
        if (ex.missing) { this.db.prepare(`UPDATE beats SET missing=0 WHERE id=?`).run(ex.id); this.touch(ex.id) }
        if (ex.analyzed_at == null) this.enqueue(ex.id)
        return
      }
      this.db.prepare(`UPDATE beats SET size=?, mtime=?, analyzed_at=NULL, missing=0 WHERE id=?`).run(size, mtime, ex.id)
      this.touch(ex.id)
      this.enqueue(ex.id)
      return
    }
    // moved/renamed file? same size + mtime as a row that went missing
    const moved = this.db.prepare(`SELECT id,analyzed_at FROM beats WHERE missing=1 AND size=? AND mtime=?`).get(size, mtime) as Row | undefined
    if (moved) {
      this.db.prepare(`UPDATE beats SET path=?, filename=?, folder=?, missing=0 WHERE id=?`).run(path, basename(path), dirname(path), moved.id)
      this.touch(moved.id)
      if (moved.analyzed_at == null) this.enqueue(moved.id)
      return
    }

    const rel = relative(root, path)
    const top = rel.includes(sep) ? rel.split(sep)[0] : ''
    const hints = parseName(path, top, this.getSettings().ownHandles)
    const gk = hints.groupKey || path
    const gid = this.groupFor(gk, hints.title)
    const ideas = /idea|scrap/i.test(top)
    const folderGenre = genreFromFolder(top)
    const proj = matchProject(hints.title, this.projects)
    const id = Number(
      this.db.prepare(
        `INSERT INTO beats(path,filename,title,folder,ext,size,mtime,bpm,bpm_source,bpm_confidence,key,key_source,status,credits,group_id,version_label,project_path,project_confidence,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        path, basename(path), hints.title, dirname(path), extname(path).slice(1).toLowerCase(), size, mtime,
        hints.bpm, hints.bpm ? 'filename' : null, hints.bpm ? 'high' : null,
        hints.key, hints.key ? 'filename' : null,
        (ideas ? 'idea' : 'finished') satisfies Status, hints.credits.join(' '), gid, hints.versionLabel,
        proj?.path ?? null, proj?.score ?? null, Date.now()
      ).lastInsertRowid
    )
    const ins = this.db.prepare(`INSERT OR IGNORE INTO tags(beat_id,kind,value) VALUES(?,?,?)`)
    hints.vibe.forEach((v) => ins.run(id, 'vibe', v))
    hints.genre.forEach((v) => ins.run(id, 'genre', v))
    if (folderGenre && !hints.genre.includes(folderGenre)) ins.run(id, 'genre', folderGenre)
    this.touch(id)
    this.enqueue(id)
  }

  markMissing(path: string): void {
    const r = this.db.prepare(`SELECT id FROM beats WHERE path=?`).get(path) as Row | undefined
    if (!r) return
    this.db.prepare(`UPDATE beats SET missing=1 WHERE id=?`).run(r.id)
    this.touch(r.id)
  }
  markUnseenMissing(roots: string[], seen: Set<string>): void {
    const rows = this.db.prepare(`SELECT id,path FROM beats WHERE missing=0`).all() as Row[]
    const upd = this.db.prepare(`UPDATE beats SET missing=1 WHERE id=?`)
    let n = 0
    this.db.transaction(() => {
      for (const r of rows) {
        if (!seen.has(r.path) && roots.some((root) => r.path.startsWith(root + sep))) { upd.run(r.id); n++ }
      }
    })()
    if (n) this.touchAll()
  }

  // ---- analysis queue ----
  enqueue(id: number): void {
    if (this.queued.has(id)) return
    this.queued.add(id)
    this.queue.push(id)
    this.scan.total++
    this.pump()
  }
  reanalyze(id: number): void {
    this.db.prepare(`UPDATE beats SET analyzed_at=NULL WHERE id=?`).run(id)
    this.enqueue(id)
  }
  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const id = this.queue.shift()!
      const path = this.pathOf(id)
      if (!path) { this.queued.delete(id); this.scan.done++; continue }
      this.idle.pop()!.postMessage({ id, path })
    }
    this.scan.pending = this.queue.length + (this.workers.length - this.idle.length)
    this.emitScan({ ...this.scan })
    if (this.scan.pending === 0) this.scan = { pending: 0, done: 0, total: 0 }
  }
  private onResult(w: Worker, r: AnalyzeResult): void {
    this.idle.push(w)
    this.queued.delete(r.id)
    this.scan.done++
    if (r.ok) {
      const cur = this.db.prepare(`SELECT bpm_source, key_source FROM beats WHERE id=?`).get(r.id) as Row | undefined
      if (cur) {
        const useBpm = r.bpm != null && cur.bpm_source !== 'user' && cur.bpm_source !== 'filename'
        const useKey = r.key && cur.key_source !== 'user' && cur.key_source !== 'filename'
        this.db.prepare(
          `UPDATE beats SET duration=?, peaks=?, thumb=?, analyzed_at=?,
             bpm=CASE WHEN ? THEN ? ELSE bpm END, bpm_source=CASE WHEN ? THEN 'analysis' ELSE bpm_source END, bpm_confidence=CASE WHEN ? THEN ? ELSE bpm_confidence END,
             key=CASE WHEN ? THEN ? ELSE key END, key_source=CASE WHEN ? THEN 'analysis' ELSE key_source END
           WHERE id=?`
        ).run(
          r.duration ?? null, JSON.stringify(r.peaks ?? []), JSON.stringify(r.thumb ?? []), Date.now(),
          useBpm ? 1 : 0, r.bpm ?? null, useBpm ? 1 : 0, useBpm ? 1 : 0, r.bpmConfidence ?? null,
          useKey ? 1 : 0, r.key ?? null, useKey ? 1 : 0, r.id
        )
      }
    } else {
      console.error('analysis failed', r.id, r.error)
      // mark analyzed so a broken file isn't retried on every launch
      this.db.prepare(`UPDATE beats SET analyzed_at=? WHERE id=?`).run(Date.now(), r.id)
    }
    this.touch(r.id)
    this.pump()
  }

  // ---- change events ----
  private touch(id: number): void {
    this.dirty.add(id)
    this.flushTimer ??= setTimeout(() => this.flush(), 150)
  }
  bumpAll(): void { this.touchAll() }
  private touchAll(): void {
    this.dirty.add(-1)
    this.flushTimer ??= setTimeout(() => this.flush(), 150)
  }
  private flush(): void {
    this.flushTimer = null
    const ids = [...this.dirty]
    this.dirty.clear()
    this.emitChanged(ids)
  }
}
