import type Database from 'better-sqlite3'
import { shell } from 'electron'
import { createHash } from 'crypto'
import { createReadStream, promises as fs, statSync } from 'fs'
import { basename, dirname, extname, join, sep } from 'path'
import { parseFile } from 'music-metadata'
import { parseName } from './filename'
import { SOUND_KINDS, type DupGroup, type ProjectSection, type SoundKind, type SoundList, type SoundRow, type SoundStatus } from '../shared/types'
import { isUnder } from './safe-path'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const AUDIO = new Set(['.wav', '.aif', '.aiff', '.mp3', '.flac', '.ogg', '.m4a', '.mid', '.midi'])
const isMidi = (ext: string) => ext === 'mid' || ext === 'midi'

const RULES: [SoundKind, RegExp][] = [
  ['loop', /\bloops?\b/],
  ['808', /\b808s?\b|\b909 ?bass\b/],
  ['kick', /\bkicks?\b|\bkik\b|\bbd\b|\bbass ?drum\b/],
  ['snare', /\bsnares?\b|\bsnr\b|\brimshot\b/],
  ['clap', /\bclaps?\b|\bclp\b|\bsnaps?\b/],
  ['hat', /\bhi ?hats?\b|\bhh\b|\bhats?\b|\bcymbals?\b|\bcrash\b|\bride\b|\bopen ?hat\b|\bclosed ?hat\b|\boh\b|\bch\b|\bopens?\b|\bclosed\b/],
  ['perc', /\bperc(ussions?)?\b|\btoms?\b|\bshakers?\b|\brims?\b|\bcongas?\b|\bbongos?\b|\btamb(ourine)?\b|\bcowbell\b|\bclave\b|\bfills?\b/],
  ['vocal', /\bvocals?\b|\bvox\b|\bchants?\b|\bacapella\b|\badlibs?\b|\bshouts?\b|\bvoice\b/],
  ['fx', /\bsfx\b|\bfx\b|\brisers?\b|\bimpacts?\b|\bsweeps?\b|\bnoise\b|\bdownlifters?\b|\buplifters?\b|\btransitions?\b|\bfoley\b|\breverse\b/],
  ['bass', /\bbass\b|\bsub\b|\breese\b/],
  ['melody', /\bmelod(y|ies|ic)\b|\bsynths?\b|\bplucks?\b|\bchords?\b|\bguitars?\b|\bpianos?\b|\bkeys\b|\bpads?\b|\bleads?\b|\barps?\b|\bstrings?\b|\bbells?\b|\bflutes?\b|\bsamples?\b|\bstabs?\b|\bpiano\b|\borgan\b/]
]

export function classify(path: string, root: string): SoundKind {
  const rel = path.startsWith(root) ? path.slice(root.length) : path
  const segs = rel.split(sep).filter(Boolean)
  const file = (segs.pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase().replace(/[_\-.()[\]]+/g, ' ')
  const folders = segs.map((s) => s.toLowerCase().replace(/[_\-.()[\]]+/g, ' '))
  // the file name wins; then the closest folder
  for (const text of [file, ...folders.reverse()]) for (const [kind, re] of RULES) if (re.test(text)) return kind
  return 'other'
}

/** sample rate / frames from a WAV header without decoding it */
async function wavDuration(path: string): Promise<number | null> {
  const fh = await fs.open(path, 'r')
  try {
    const buf = Buffer.alloc(65536)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    if (bytesRead < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
    let pos = 12, rate = 0, align = 0
    while (pos + 8 <= bytesRead) {
      const id = buf.toString('ascii', pos, pos + 4)
      const size = buf.readUInt32LE(pos + 4)
      if (id === 'fmt ') { rate = buf.readUInt32LE(pos + 12); align = buf.readUInt16LE(pos + 20) }
      else if (id === 'data') return rate && align ? size / align / rate : null
      pos += 8 + size + (size % 2)
    }
    return null
  } finally {
    await fh.close()
  }
}

async function readDuration(path: string): Promise<number | null> {
  try {
    if (extname(path).toLowerCase() === '.wav') { const d = await wavDuration(path); if (d != null) return d }
    const m = await parseFile(path, { duration: true, skipCovers: true })
    return m.format.duration ?? null
  } catch { return null }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>, tick: () => void): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x) } catch { /* one bad file must not stop the scan */ } tick() } }))
}

export class Sounds {
  private running = false
  private unreadable: string[] = []
  constructor(private db: Database.Database, private roots: () => string[], private opts: () => { midiRoot: string; packsMidi: boolean }, private emit: (s: SoundStatus) => void, private changed: () => void) {}

  async scan(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const roots = this.roots()
      this.emit({ phase: 'scanning', done: 0, total: 0 })
      const found: { path: string; root: string; size: number; mtime: number }[] = []
      this.unreadable = []
      for (const root of roots) await this.walk(root, root, found)
      const seen = new Set<string>()
      const byPath = new Map((this.db.prepare('SELECT id,path,size,mtime,missing FROM sounds').all() as Row[]).map((r) => [r.path as string, r]))
      const ins = this.db.prepare('INSERT INTO sounds(path,dir,name,ext,size,mtime,kind,bpm,key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      const upd = this.db.prepare('UPDATE sounds SET size=?, mtime=?, duration=NULL, hash=NULL, missing=0 WHERE id=?')
      const revive = this.db.prepare('UPDATE sounds SET missing=0 WHERE id=?')
      this.db.transaction(() => {
        for (const f of found) {
          seen.add(f.path)
          const ex = byPath.get(f.path)
          if (ex) {
            if (ex.size !== f.size || Math.abs(ex.mtime - f.mtime) > 1) upd.run(f.size, f.mtime, ex.id)
            else if (ex.missing) revive.run(ex.id)
            continue
          }
          const name = basename(f.path, extname(f.path))
          const h = parseName(f.path, '', [])
          const ext = extname(f.path).slice(1).toLowerCase()
          ins.run(f.path, dirname(f.path), name, ext, f.size, f.mtime, isMidi(ext) ? 'midi' : classify(f.path, f.root), h.bpm, h.key, Date.now())
        }
        const gone = this.db.prepare('UPDATE sounds SET missing=1 WHERE id=?')
        for (const [p, r] of byPath) if (!seen.has(p) && !r.missing && roots.some((root) => p.startsWith(root + sep)) && !isUnder(p, this.unreadable)) gone.run(r.id) // an unplugged drive isn't a deleted one
      })()
      this.changed()

      this.db.prepare("UPDATE sounds SET duration=0 WHERE kind='midi' AND duration IS NULL").run()
      const todo = this.db.prepare('SELECT id,path,kind FROM sounds WHERE missing=0 AND duration IS NULL').all() as Row[]
      let done = 0
      const setDur = this.db.prepare('UPDATE sounds SET duration=?, kind=? WHERE id=?')
      await pool(todo, 8, async (r) => {
        const d = await readDuration(r.path)
        const kind: SoundKind = r.kind === 'other' && d != null && d > 3 ? 'loop' : r.kind
        setDur.run(d ?? 0, kind, r.id)
      }, () => { if (++done % 250 === 0) this.emit({ phase: 'reading', done, total: todo.length }) })
    } finally {
      this.running = false
      this.emit({ phase: 'idle', done: 0, total: 0 })
      this.changed()
    }
  }

  private async walk(dir: string, root: string, out: { path: string; root: string; size: number; mtime: number }[]): Promise<void> {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { this.unreadable.push(dir); return }
    const files: string[] = []
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) await this.walk(p, root, out)
      else if (e.isFile() && AUDIO.has(extname(e.name).toLowerCase())) {
        // MIDI packs can be tens of thousands of files: only index them when asked, plus the MIDI Studio HQ makes from your projects
        const o = this.opts()
        if (isMidi(extname(e.name).slice(1).toLowerCase()) && !o.packsMidi && root !== o.midiRoot) continue
        files.push(p)
      }
    }
    await Promise.all(files.map(async (p) => { try { const st = await fs.stat(p); out.push({ path: p, root, size: st.size, mtime: st.mtimeMs }) } catch { /* vanished */ } }))
  }

  /** Adds one file that lives outside the scanned folders (for example a sample a project points at). */
  ensure(path: string): number | null {
    const ex = this.db.prepare('SELECT id FROM sounds WHERE path=?').get(path) as Row | undefined
    if (ex) return ex.id
    const ext = extname(path).slice(1).toLowerCase()
    if (!AUDIO.has('.' + ext) || isMidi(ext)) return null
    try {
      const st = statSync(path)
      const h = parseName(path, '', [])
      return Number(this.db.prepare('INSERT INTO sounds(path,dir,name,ext,size,mtime,kind,bpm,key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(path, dirname(path), basename(path, extname(path)), ext, st.size, st.mtimeMs, classify(path, dirname(path)), h.bpm, h.key, Date.now()).lastInsertRowid)
    } catch { return null }
  }

  list(projects: ProjectSection[] = []): SoundList {
    const tags = new Map<number, string[]>()
    for (const t of this.db.prepare('SELECT sound_id, value FROM sound_tags ORDER BY rowid').all() as Row[]) (tags.get(t.sound_id) ?? tags.set(t.sound_id, []).get(t.sound_id)!).push(t.value)
    const notes = new Map((this.db.prepare('SELECT sound_id, notes FROM flp_midis WHERE sound_id IS NOT NULL').all() as Row[]).map((r) => [r.sound_id as number, r.notes as number]))
    const dirs: string[] = []
    const idx = new Map<string, number>()
    const items = (this.db.prepare('SELECT id,name,dir,ext,duration,kind,favorite,bpm,key,size FROM sounds WHERE missing=0 ORDER BY name COLLATE NOCASE').all() as Row[]).map((r): SoundRow => {
      let d = idx.get(r.dir)
      if (d === undefined) { d = dirs.length; dirs.push(r.dir); idx.set(r.dir, d) }
      return { id: r.id, n: r.name, d, e: r.ext, u: r.duration, k: (SOUND_KINDS as readonly string[]).includes(r.kind) ? r.kind : 'other', f: !!r.favorite, b: r.bpm, y: r.key, t: tags.get(r.id) ?? [], s: r.size, m: notes.get(r.id) ?? null }
    })
    return { dirs, items, projects, roots: this.roots() }
  }

  pathOf(id: number): string | null { return (this.db.prepare('SELECT path FROM sounds WHERE id=?').get(id) as Row | undefined)?.path ?? null }

  tag(ids: number[], add: string[], remove: string[]): void {
    const ins = this.db.prepare('INSERT OR IGNORE INTO sound_tags(sound_id,value) VALUES(?,?)')
    const del = this.db.prepare('DELETE FROM sound_tags WHERE sound_id=? AND value=?')
    this.db.transaction(() => {
      for (const id of ids) {
        for (const t of add.map((x) => x.trim().toLowerCase()).filter(Boolean)) ins.run(id, t)
        for (const t of remove) del.run(id, t)
      }
    })()
  }
  fav(ids: number[], fav: boolean): void {
    const u = this.db.prepare('UPDATE sounds SET favorite=? WHERE id=?')
    this.db.transaction(() => ids.forEach((id) => u.run(fav ? 1 : 0, id)))()
  }

  async duplicates(): Promise<DupGroup[]> {
    const rows = this.db.prepare(
      `SELECT id,path,size,mtime,favorite,hash,hash_size,hash_mtime FROM sounds WHERE missing=0 AND size IN (SELECT size FROM sounds WHERE missing=0 AND size>0 GROUP BY size HAVING COUNT(*)>1)`
    ).all() as Row[]
    const need = rows.filter((r) => !(r.hash && r.hash_size === r.size && Math.abs(r.hash_mtime - r.mtime) < 1))
    const setHash = this.db.prepare('UPDATE sounds SET hash=?, hash_size=?, hash_mtime=? WHERE id=?')
    let done = 0
    this.emit({ phase: 'hashing', done: 0, total: need.length })
    await pool(need, 4, async (r) => {
      const h = await new Promise<string>((res, rej) => {
        const hash = createHash('sha1')
        createReadStream(r.path).on('data', (c) => hash.update(c)).on('error', rej).on('end', () => res(hash.digest('hex')))
      })
      setHash.run(h, r.size, r.mtime, r.id)
      r.hash = h
    }, () => { if (++done % 50 === 0) this.emit({ phase: 'hashing', done, total: need.length }) })
    this.emit({ phase: 'idle', done: 0, total: 0 })
    const groups = new Map<string, DupGroup>()
    for (const r of rows) {
      if (!r.hash) continue
      const g: DupGroup = groups.get(r.hash) ?? { hash: r.hash, size: r.size, files: [] }
      g.files.push({ id: r.id, path: r.path, mtime: r.mtime, fav: !!r.favorite })
      groups.set(r.hash, g)
    }
    return [...groups.values()].filter((g) => g.files.length > 1).map((g) => ({ ...g, files: g.files.sort((a, b) => a.path.length - b.path.length || a.mtime - b.mtime) })).sort((a, b) => b.size * b.files.length - a.size * a.files.length)
  }

  /** Moves to the macOS Trash, so it can be put back. */
  async trash(ids: number[]): Promise<number> {
    let n = 0
    const gone = this.db.prepare('UPDATE sounds SET missing=1 WHERE id=?')
    for (const id of ids) {
      const p = this.pathOf(id)
      if (!p) continue
      try { await shell.trashItem(p); gone.run(id); n++ } catch { /* already gone or not allowed */ }
    }
    this.changed()
    return n
  }
}
