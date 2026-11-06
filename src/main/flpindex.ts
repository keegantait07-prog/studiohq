import type Database from 'better-sqlite3'
import { promises as fs, existsSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, extname, join } from 'path'
import { parseFlp } from './flp'
import { isUnder } from './safe-path'
import { writeMidi } from './midi'
import type { Sounds } from './sounds'
import type { ProjectSection } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const MAX_FLP = 400e6

const safe = (s: string) => s.replace(/[\\/:*?"<>|\0]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled'
const lastName = (ref: string) => ref.split(/[\\/]/).pop() ?? ref

export class ProjectIndex {
  private running = false
  constructor(private db: Database.Database, private sounds: Sounds, private roots: () => string[], private midiDir: string, private done: () => void, private onProjects: (files: { path: string; mtime: number; size: number }[]) => void = () => {}) {}

  private macro(ref: string): string {
    const m = ref.match(/^%(\w+)%[\\/](.*)$/)
    if (!m) return ref
    const rest = m[2].replace(/\\/g, '/')
    const base: Record<string, string> = {
      FLStudioFactoryData: '/Applications/FL Studio 2026.app/Contents/Resources/FL',
      FLStudioUserData: join(homedir(), 'Documents/Image-Line/FL Studio'),
      FLStudioDownloadsData: join(homedir(), 'Documents/Image-Line/Downloads'),
      FLStudioData: '/Applications/FL Studio 2026.app/Contents/Resources/FL/Data'
    }
    return base[m[1]] ? join(base[m[1]], rest) : ref
  }

  private async findFlps(): Promise<{ files: string[]; unreadable: string[] }> {
    const out: string[] = []
    const unreadable: string[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      let es
      try { es = await fs.readdir(dir, { withFileTypes: true }) } catch { unreadable.push(dir); return }
      for (const e of es) {
        if (e.name.startsWith('.') || e.name === 'Backup' || e.name === '__MACOSX') continue
        const p = join(dir, e.name)
        if (e.isDirectory()) { if (depth < 8) await walk(p, depth + 1) } else if (extname(e.name).toLowerCase() === '.flp') out.push(p)
      }
    }
    for (const r of this.roots()) await walk(r, 0)
    return { files: [...new Set(out)], unreadable }
  }

  /** Returns true when MIDI files were added or removed, so the caller should rescan the library. */
  async index(): Promise<boolean> {
    if (this.running) return false
    this.running = true
    let midiChanged = false
    try {
      await fs.mkdir(this.midiDir, { recursive: true })
      const { files, unreadable } = await this.findFlps()
      const known = new Map((this.db.prepare('SELECT id,path,mtime,size FROM flp_projects').all() as Row[]).map((r) => [r.path as string, r]))
      const present = new Set(files)
      // a folder we couldn't read (an unplugged drive) says nothing about what's on it, so those projects stay
      for (const [p, r] of known) if (!present.has(p) && !isUnder(p, unreadable)) { this.removeProject(r.id); midiChanged = true }

      const byName = new Map<string, { id: number; path: string }[]>()
      for (const r of this.db.prepare(`SELECT id,path,name,ext FROM sounds WHERE missing=0 AND kind!='midi'`).all() as Row[]) {
        const k = `${r.name}.${r.ext}`.toLowerCase()
        ;(byName.get(k) ?? byName.set(k, []).get(k)!).push({ id: r.id, path: r.path })
      }
      const byPath = new Map((this.db.prepare(`SELECT id,path FROM sounds WHERE missing=0`).all() as Row[]).map((r) => [r.path as string, r.id as number]))

      // every project file we can see, for the Vault's "FL projects as beats"
      const seen: { path: string; mtime: number; size: number }[] = []
      for (const f of files) { try { const st = await fs.stat(f); seen.push({ path: f, mtime: st.mtimeMs, size: st.size }) } catch { /* vanished */ } }
      this.onProjects(seen)

      for (const f of files) {
        let st
        try { st = await fs.stat(f) } catch { continue }
        const k = known.get(f)
        if (k && k.size === st.size && Math.abs(k.mtime - st.mtimeMs) < 1) continue
        if (st.size > MAX_FLP) { this.store(f, st, null, 'Project file is too large to read', byName, byPath); continue }
        try {
          const parsed = parseFlp(await fs.readFile(f))
          this.store(f, st, parsed, null, byName, byPath)
          midiChanged = true
        } catch (e) { this.store(f, st, null, (e as Error).message, byName, byPath) }
        await new Promise((r) => setImmediate(r)) // keep the app responsive
      }
    } finally {
      this.running = false
      this.done()
    }
    return midiChanged
  }

  private removeProject(id: number): void {
    const dir = (this.db.prepare('SELECT name FROM flp_projects WHERE id=?').get(id) as Row | undefined)?.name
    this.db.prepare('DELETE FROM flp_projects WHERE id=?').run(id)
    if (dir) void fs.rm(join(this.midiDir, safe(dir) + `-${id}`), { recursive: true, force: true })
  }

  private store(path: string, st: { size: number; mtimeMs: number }, parsed: ReturnType<typeof parseFlp> | null, error: string | null, byName: Map<string, { id: number; path: string }[]>, byPath: Map<string, number>): void {
    const name = basename(path, '.flp')
    const ex = this.db.prepare('SELECT id FROM flp_projects WHERE path=?').get(path) as Row | undefined
    if (ex) this.removeProject(ex.id) // its MIDI folder is named after the old id
    const id = Number(this.db.prepare('INSERT INTO flp_projects(path,name,mtime,size,ppq,partial,error,parsed_at) VALUES(?,?,?,?,?,?,?,?)').run(path, name, st.mtimeMs, st.size, parsed?.ppq ?? null, parsed?.partial ? 1 : 0, error, Date.now()).lastInsertRowid)
    if (!parsed) return

    const insS = this.db.prepare('INSERT OR IGNORE INTO flp_samples(project_id,ref,name,channel,sound_id,how) VALUES(?,?,?,?,?,?)')
    this.db.transaction(() => {
      for (const s of parsed.samples) {
        const real = this.macro(s.ref)
        const fname = lastName(s.ref)
        let soundId: number | null = null
        let how: 'path' | 'name' | 'missing' = 'missing'
        const direct = byPath.get(real)
        if (direct) { soundId = direct; how = 'path' }
        else if (!/^%/.test(real) && real.startsWith('/') && existsSync(real)) { soundId = this.sounds.ensure(real); if (soundId) how = 'path' }
        if (!soundId) {
          const cands = byName.get(fname.toLowerCase())
          if (cands?.length) { soundId = [...cands].sort((a, b) => a.path.length - b.path.length)[0].id; how = 'name' }
        }
        insS.run(id, s.ref, fname, s.channel, soundId, how)
      }
    })()

    // one .mid per pattern, one track per instrument that plays in it
    const dir = join(this.midiDir, `${safe(name)}-${id}`)
    const linked = this.db.prepare('SELECT bpm FROM beats WHERE project_path=? AND bpm IS NOT NULL LIMIT 1').get(path) as Row | undefined
    const bpm = linked?.bpm ?? parsed.tempo ?? 120
    const insM = this.db.prepare('INSERT INTO flp_midis(project_id,pattern,name,notes,path) VALUES(?,?,?,?,?)')
    if (parsed.patterns.length) void fs.mkdir(dir, { recursive: true })
    const writes: Promise<void>[] = []
    for (const p of parsed.patterns) {
      const label = p.name.trim() || `Pattern ${p.id}`
      const file = join(dir, `${String(p.id).padStart(2, '0')} ${safe(label)}.mid`)
      const byRack = new Map<number, typeof p.notes>()
      for (const n of p.notes) (byRack.get(n.rack) ?? byRack.set(n.rack, []).get(n.rack)!).push(n)
      const tracks = [...byRack.entries()].sort((a, b) => a[0] - b[0]).map(([rack, notes]) => ({ name: parsed.channels.get(rack) ?? `Channel ${rack + 1}`, notes }))
      writes.push(fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(file, writeMidi(parsed.ppq, bpm, tracks))))
      insM.run(id, p.id, label, p.notes.length, file)
    }
    void Promise.all(writes)
  }

  /** After a library rescan has indexed the .mid files, point each MIDI row at its sound id. */
  linkMidi(): void {
    const byPath = new Map((this.db.prepare(`SELECT id,path FROM sounds WHERE kind='midi' AND missing=0`).all() as Row[]).map((r) => [r.path as string, r.id as number]))
    const upd = this.db.prepare('UPDATE flp_midis SET sound_id=? WHERE id=?')
    this.db.transaction(() => { for (const r of this.db.prepare('SELECT id,path FROM flp_midis').all() as Row[]) upd.run(byPath.get(r.path) ?? null, r.id) })()
  }

  list(): ProjectSection[] {
    const samples = new Map<number, Row[]>()
    for (const r of this.db.prepare('SELECT project_id,ref,name,channel,sound_id,how FROM flp_samples').all() as Row[]) (samples.get(r.project_id) ?? samples.set(r.project_id, []).get(r.project_id)!).push(r)
    const midis = new Map<number, Row[]>()
    for (const r of this.db.prepare('SELECT project_id,sound_id,name,notes FROM flp_midis ORDER BY pattern').all() as Row[]) (midis.get(r.project_id) ?? midis.set(r.project_id, []).get(r.project_id)!).push(r)
    const beats = new Map((this.db.prepare('SELECT project_path, title FROM beats WHERE project_path IS NOT NULL AND missing=0').all() as Row[]).map((r) => [r.project_path as string, r.title as string]))
    return (this.db.prepare('SELECT * FROM flp_projects ORDER BY mtime DESC').all() as Row[]).map((p): ProjectSection => {
      const ss = samples.get(p.id) ?? [], ms = midis.get(p.id) ?? []
      return {
        id: p.id, name: p.name, path: p.path, mtime: p.mtime, partial: !!p.partial, error: p.error, beatTitle: beats.get(p.path) ?? null,
        samples: ss.filter((s) => s.sound_id).map((s) => s.sound_id as number),
        midis: ms.filter((m) => m.sound_id).map((m) => m.sound_id as number),
        missing: ss.filter((s) => !s.sound_id).map((s) => ({ name: s.name, channel: s.channel, ref: s.ref })),
        byName: ss.filter((s) => s.how === 'name').length
      }
    }).filter((p) => p.samples.length || p.midis.length || p.missing.length)
  }
}

void dirname
