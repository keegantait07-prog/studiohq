import type Database from 'better-sqlite3'
import { dirname, basename, extname, relative, sep } from 'path'
import { existsSync, statSync } from 'fs'
import { homedir, cpus } from 'os'
import { Worker } from 'worker_threads'
import createWorker from './analyze.worker?nodeWorker'
import type { AnalyzeResult } from './analyze.worker'
import { parseName, genreFromFolder } from './filename'
import { normalizeKey } from '../shared/key'
import { scanProjects, matchProject, type ProjectFile } from './projects'
import { TAG_KINDS, type Beat, type BeatDetail, type BeatPatch, type ScanStatus, type Settings, type Status, type TagKind, type VaultKind } from '../shared/types'

const DEFAULTS: Settings = {
  watchFolders: [`${homedir()}/Desktop/! BEATS`],
  loopFolders: [`${homedir()}/Desktop/! LOOPS`],
  projectFolders: [`${homedir()}/Documents/Image-Line/FL Studio/Projects`],
  includeIdeas: false,
  ownHandles: ['smalls', 'prodbysmalls'],
  producerName: '',
  followupDays: 7,
  notify: true,
  storeUrl: '',
  contactEmail: '',
  hashtags: '#typebeat #producer #instrumental',
  exportDir: `${homedir()}/Movies/Studio HQ`,
  soundFolders: [`${homedir()}/Desktop/!DRUM KITS`],
  goalBeats: 3,
  goalPitches: 5,
  goalPosts: 3,
  autoTrackFL: false,
  includeMidiPacks: false,
  projectBeatDays: 30,
  ytSeedChannels: ['BuJaa BEATS', 'Soulker', 'CashMoneyAP', 'Fat Cat Beats', 'Profetesa Beats'],
  ytImageFolder: '',
  ytClientId: '',
  claudePath: ''
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
    for (const t of this.db.prepare(`SELECT beat_id, kind, value FROM tags ORDER BY rowid`).all() as Row[]) {
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
      missing: !!r.missing, hasPreview: !!r.preview_path, analyzed: r.analyzed_at != null, thumb: r.thumb ? JSON.parse(r.thumb) : [], coverPath: r.cover_path ?? null,
      tags: tags ?? { vibe: [], genre: [], artist: [] }, createdAt: r.created_at
    }
  }
  listBeats(kind: VaultKind = 'beat'): Beat[] {
    const tags = this.tagMap()
    const rows = this.db.prepare(`SELECT id,path,filename,title,folder,ext,size,mtime,duration,bpm,bpm_source,bpm_confidence,key,key_source,status,notes,credits,group_id,version_label,project_path,project_confidence,missing,analyzed_at,thumb,cover_path,preview_path,created_at FROM beats b WHERE kind=? AND missing=0 AND NOT (ext='flp' AND EXISTS (SELECT 1 FROM beats a WHERE a.project_path=b.path AND a.ext!='flp' AND a.missing=0)) ORDER BY mtime DESC`).all(kind) as Row[]
    return rows.map((r) => this.toBeat(r, tags.get(r.id)))
  }
  listLoops(): Beat[] { return this.listBeats('loop') }
  getBeat(id: number): BeatDetail | null {
    const r = this.db.prepare(`SELECT * FROM beats WHERE id=?`).get(id) as Row | undefined
    if (!r) return null
    const tags = this.tagMap()
    const versions = (this.db.prepare(`SELECT * FROM beats WHERE group_id=? AND missing=0 ORDER BY mtime DESC`).all(r.group_id) as Row[]).map((v) => this.toBeat(v, tags.get(v.id)))
    return { ...this.toBeat(r, tags.get(id)), peaks: r.peaks ? JSON.parse(r.peaks) : [], versions }
  }
  allTags(vault: VaultKind = 'beat'): Record<TagKind, string[]> {
    const out: Record<TagKind, string[]> = { vibe: [], genre: [], artist: [] }
    for (const t of this.db.prepare(`SELECT t.kind, t.value, COUNT(*) c FROM tags t JOIN beats b ON b.id=t.beat_id WHERE b.kind=? GROUP BY t.kind, t.value ORDER BY c DESC`).all(vault) as Row[]) out[t.kind as TagKind].push(t.value)
    return out
  }
  pathOf(id: number): string | null {
    return (this.db.prepare(`SELECT path FROM beats WHERE id=?`).get(id) as Row | undefined)?.path ?? null
  }
  /** The file to play: the audio itself, or the captured loop for an FL project with no bounce. */
  playPathOf(id: number): string | null {
    const r = this.db.prepare(`SELECT path, ext, preview_path FROM beats WHERE id=?`).get(id) as Row | undefined
    if (!r) return null
    return r.ext === 'flp' ? r.preview_path ?? null : r.path
  }
  /** Where a project beat's loop lives (also creates the beat if the loop arrives before the project does). */
  previewTarget(flp: string): { id: number; old: string | null } | null {
    if (!existsSync(flp)) return null
    this.saveFromPlugin({ name: '', bpm: null, flp })
    const r = this.db.prepare(`SELECT id, preview_path FROM beats WHERE path=? AND ext='flp'`).get(flp) as Row | undefined
    return r ? { id: r.id, old: r.preview_path ?? null } : null
  }
  setPreview(id: number, path: string): void {
    this.db.prepare('UPDATE beats SET preview_path=? WHERE id=?').run(path, id)
    this.touch(id)
  }

  // ---- writes from UI ----
  updateBeat(id: number, p: BeatPatch): void {
    const set: string[] = []
    const val: unknown[] = []
    const add = (col: string, v: unknown) => { set.push(`${col}=?`); val.push(v) }
    if (p.title !== undefined) add('title', p.title.trim() || 'Untitled')
    if (p.status !== undefined) {
      const lock = this.db.prepare(`SELECT s.buyer FROM sales s JOIN beats b ON b.group_id=s.group_id WHERE b.id=? AND s.exclusive=1 LIMIT 1`).get(id) as { buyer: string } | undefined
      if (lock && p.status !== 'sold') throw new Error(`This beat was sold exclusively to ${lock.buyer}, so it stays "sold". Delete that sale first if it was a mistake.`)
      add('status', p.status)
    }
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

  upsertFile(path: string, size: number, mtime: number, root: string, vault: VaultKind = 'beat'): void {
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
    const moved = this.db.prepare(`SELECT id,analyzed_at FROM beats WHERE missing=1 AND kind=? AND size=? AND mtime=?`).get(vault, size, mtime) as Row | undefined
    if (moved) {
      this.db.prepare(`UPDATE beats SET path=?, filename=?, folder=?, missing=0 WHERE id=?`).run(path, basename(path), dirname(path), moved.id)
      this.touch(moved.id)
      if (moved.analyzed_at == null) this.enqueue(moved.id)
      return
    }

    const rel = relative(root, path)
    const top = rel.includes(sep) ? rel.split(sep)[0] : ''
    const hints = parseName(path, top, this.getSettings().ownHandles)
    // loops get their own groups, so a loop and a beat with the same name never merge into one set of versions
    const gk = (vault === 'loop' ? 'loop:' : '') + (hints.groupKey || path)
    const gid = this.groupFor(gk, hints.title)
    const ideas = /idea|scrap/i.test(top)
    const folderGenre = genreFromFolder(top)
    const proj = matchProject(hints.title, this.projects)
    const id = Number(
      this.db.prepare(
        `INSERT INTO beats(path,filename,title,folder,ext,size,mtime,bpm,bpm_source,bpm_confidence,key,key_source,status,credits,group_id,version_label,project_path,project_confidence,created_at,kind)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        path, basename(path), hints.title, dirname(path), extname(path).slice(1).toLowerCase(), size, mtime,
        hints.bpm, hints.bpm ? 'filename' : null, hints.bpm ? 'high' : null,
        hints.key, hints.key ? 'filename' : null,
        (ideas ? 'idea' : 'finished') satisfies Status, hints.credits.join(' '), gid, hints.versionLabel,
        proj?.path ?? null, proj?.score ?? null, Date.now(), vault
      ).lastInsertRowid
    )
    const ins = this.db.prepare(`INSERT OR IGNORE INTO tags(beat_id,kind,value) VALUES(?,?,?)`)
    hints.vibe.forEach((v) => ins.run(id, 'vibe', v))
    hints.genre.forEach((v) => ins.run(id, 'genre', v))
    if (folderGenre && !hints.genre.includes(folderGenre)) ins.run(id, 'genre', folderGenre)
    // a new version of an exclusively sold beat is sold too
    if (this.db.prepare('SELECT 1 FROM sales WHERE group_id=? AND exclusive=1').get(gid)) this.db.prepare(`UPDATE beats SET status='sold' WHERE id=?`).run(id)
    this.touch(id)
    this.enqueue(id)
  }

  /** FL projects as beats: every project in your project folders appears in the Vault, even before it has a bounce. */
  syncProjectBeats(files: { path: string; mtime: number; size: number }[], days: number): number {
    const now = Date.now()
    const present = new Set(files.map((f) => f.path))
    let added = 0
    const ownHandles = this.getSettings().ownHandles
    this.db.transaction(() => {
      for (const f of files) {
        const ex = this.db.prepare('SELECT id FROM beats WHERE path=?').get(f.path) as Row | undefined
        if (ex) { this.db.prepare('UPDATE beats SET mtime=?, size=?, missing=0 WHERE id=?').run(f.mtime, f.size, ex.id); continue }
        if (days > 0 && now - f.mtime > days * 86400000) continue
        this.insertProjectBeat(f.path, f.size, f.mtime, ownHandles)
        added++
      }
      for (const r of this.db.prepare(`SELECT id,path FROM beats WHERE ext='flp' AND missing=0`).all() as Row[]) {
        if (!present.has(r.path) && !existsSync(r.path)) this.db.prepare('UPDATE beats SET missing=1 WHERE id=?').run(r.id)
      }
    })()
    if (added) this.touchAll()
    return added
  }

  private insertProjectBeat(path: string, size: number, mtime: number, ownHandles: string[]): number {
    const hints = parseName(path, '', ownHandles)
    const gid = this.groupFor(hints.groupKey || path, hints.title)
    const id = Number(
      this.db.prepare(
        `INSERT INTO beats(path,filename,title,folder,ext,size,mtime,bpm,bpm_source,bpm_confidence,key,key_source,status,credits,group_id,version_label,project_path,project_confidence,analyzed_at,created_at)
         VALUES(?,?,?,?,'flp',?,?,?,?,?,?,?,'wip',?,?,?,?,1,?,?)`
      ).run(
        path, basename(path), hints.title, dirname(path), size, mtime,
        hints.bpm, hints.bpm ? 'filename' : null, hints.bpm ? 'high' : null, hints.key, hints.key ? 'filename' : null,
        hints.credits.join(' '), gid, hints.versionLabel, path, Date.now(), Date.now()
      ).lastInsertRowid
    )
    const ins = this.db.prepare('INSERT OR IGNORE INTO tags(beat_id,kind,value) VALUES(?,?,?)')
    hints.vibe.forEach((v) => ins.run(id, 'vibe', v))
    hints.genre.forEach((v) => ins.run(id, 'genre', v))
    return id
  }

  /** "Save to Studio HQ" from the FL plugin: the project becomes (or updates) a beat, no audio needed. */
  saveFromPlugin(d: { name: string; bpm: number | null; flp: string }): void {
    if (!d.flp || !existsSync(d.flp)) return
    let st
    try { st = statSync(d.flp) } catch { return }
    this.db.transaction(() => {
      let row = this.db.prepare('SELECT id, ext FROM beats WHERE path=?').get(d.flp) as Row | undefined
      if (!row) row = { id: this.insertProjectBeat(d.flp, st.size, st.mtimeMs, this.getSettings().ownHandles), ext: 'flp' }
      // a bounce already linked to this project gets the tempo too, if it has none
      const linked = this.db.prepare(`SELECT id FROM beats WHERE project_path=? AND ext!='flp' AND missing=0 AND bpm IS NULL`).all(d.flp) as Row[]
      for (const l of linked) if (d.bpm) this.db.prepare(`UPDATE beats SET bpm=?, bpm_source='user', bpm_confidence='high' WHERE id=?`).run(d.bpm, l.id)
      if (d.bpm) this.db.prepare(`UPDATE beats SET bpm=?, bpm_source='user', bpm_confidence='high' WHERE id=?`).run(d.bpm, row.id)
      const title = d.name.trim()
      if (title) this.db.prepare('UPDATE beats SET title=? WHERE id=? AND ext=?').run(title, row.id, 'flp')
      this.db.prepare('UPDATE beats SET missing=0 WHERE id=?').run(row.id)
    })()
    this.touchAll()
  }

  markMissing(path: string): void {
    const r = this.db.prepare(`SELECT id FROM beats WHERE path=?`).get(path) as Row | undefined
    if (!r) return
    this.db.prepare(`UPDATE beats SET missing=1 WHERE id=?`).run(r.id)
    this.touch(r.id)
  }
  markUnseenMissing(roots: string[], seen: Set<string>, vault: VaultKind = 'beat'): void {
    const rows = this.db.prepare(`SELECT id,path FROM beats WHERE missing=0 AND ext!='flp' AND kind=?`).all(vault) as Row[]
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
    if ((this.db.prepare('SELECT ext FROM beats WHERE id=?').get(id) as Row | undefined)?.ext === 'flp') return // nothing to analyse until a bounce exists
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
