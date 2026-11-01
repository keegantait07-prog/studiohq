// Sift through FL Studio projects and move the ones you no longer want to the Trash.
// Safety rules: only .flp files inside your own project folders, never templates, always to the macOS Trash (recoverable).
import type Database from 'better-sqlite3'
import { shell } from 'electron'
import { execFile } from 'child_process'
import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { CleanupItem, CleanupResult } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** The system Trash. If macOS refuses the app directly, ask Finder to do it (it prompts once for permission to control Finder). */
export async function toTrash(path: string): Promise<void> {
  try { await shell.trashItem(path); return } catch (first) {
    await new Promise<void>((resolve, reject) => {
      execFile('osascript', ['-e', `tell application "Finder" to delete (POSIX file ${JSON.stringify(path)} as alias)`], { timeout: 60000 }, (err, _out, stderr) => {
        if (!err && !existsSync(path)) return resolve()
        const why = /-1743|not allowed|authori[sz]ation/i.test(stderr) ? 'macOS blocked it. Allow Studio HQ to control Finder in System Settings > Privacy & Security > Automation, then try again' : (stderr.trim() || (first instanceof Error ? first.message : 'could not move to the Trash'))
        reject(new Error(why))
      })
    })
  }
}

const stem = (p: string) => basename(p).replace(/\.flp$/i, '')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const mine = (path: string, roots: string[]) => /\.flp$/i.test(path) && !/\/Templates\//i.test(path) && !/\/Backup\//.test(path) && roots.some((r) => path.startsWith(r.replace(/\/$/, '') + '/'))

/** FL keeps rolling backups in <projects>/Backup as "<name> (autosaved on ...)" and "<name> (overwritten on ...)". */
function backupFiles(roots: string[], name: string): { path: string; size: number }[] {
  const re = new RegExp(`^${escapeRe(name)} \\((autosaved|overwritten) on `, 'i')
  const out: { path: string; size: number }[] = []
  for (const r of roots) {
    const dir = join(r, 'Backup')
    let names: string[]
    try { names = readdirSync(dir) } catch { continue }
    for (const f of names) {
      if (!/\.flp$/i.test(f) || !re.test(f)) continue
      try { out.push({ path: join(dir, f), size: statSync(join(dir, f)).size }) } catch { /* gone */ }
    }
  }
  return out
}

export function cleanupList(db: Database.Database, roots: string[]): CleanupItem[] {
  const projects = (db.prepare('SELECT id,path,name,mtime,size FROM flp_projects').all() as Row[]).filter((p) => mine(p.path, roots) && existsSync(p.path))
  const count = (sql: string) => new Map((db.prepare(sql).all() as Row[]).map((r) => [r.k as number, r.n as number]))
  const samples = count('SELECT project_id k, COUNT(*) n FROM flp_samples GROUP BY project_id')
  const midis = count('SELECT project_id k, COUNT(*) n FROM flp_midis GROUP BY project_id')
  const bounceRows = db.prepare(`SELECT project_path p, id FROM beats WHERE ext!='flp' AND missing=0 AND project_path IS NOT NULL ORDER BY mtime DESC`).all() as Row[]
  const bounces = new Map<string, number[]>()
  for (const r of bounceRows) (bounces.get(r.p) ?? bounces.set(r.p, []).get(r.p)!).push(r.id)
  const beats = new Map((db.prepare(`SELECT id,path,group_id,title,status,bpm,key,thumb,preview_path FROM beats WHERE ext='flp' AND missing=0`).all() as Row[]).map((b) => [b.path as string, b]))
  const names = new Map<string, { n: number; bytes: number }>()
  for (const r of roots) {
    let list: string[]
    try { list = readdirSync(join(r, 'Backup')) } catch { continue }
    for (const f of list) {
      const m = /^(.*) \((?:autosaved|overwritten) on [^)]*\)\.flp$/i.exec(f)
      if (!m) continue
      const cur = names.get(m[1].toLowerCase()) ?? { n: 0, bytes: 0 }
      cur.n++
      try { cur.bytes += statSync(join(r, 'Backup', f)).size } catch { /* gone */ }
      names.set(m[1].toLowerCase(), cur)
    }
  }
  return projects.map((p): CleanupItem => {
    const b = beats.get(p.path), bn = bounces.get(p.path) ?? []
    const bk = names.get(stem(p.path).toLowerCase())
    return {
      id: p.id, name: p.name, path: p.path, mtime: p.mtime, size: p.size, samples: samples.get(p.id) ?? 0, midis: midis.get(p.id) ?? 0,
      bounces: bn.length, beatId: b?.id ?? null, groupId: b?.group_id ?? null, title: b?.title ?? null, status: b?.status ?? null, bpm: b?.bpm ?? null,
      key: b?.key ?? null, thumb: b?.thumb ? JSON.parse(b.thumb) : [], hasPreview: !!b?.preview_path, playId: bn[0] ?? (b?.preview_path ? b.id : null),
      backups: bk?.n ?? 0, backupBytes: bk?.bytes ?? 0
    }
  })
}

export async function trashProjects(db: Database.Database, roots: string[], midiDirOf: (path: string) => string[], ids: number[], withBackups: boolean): Promise<CleanupResult> {
  const res: CleanupResult = { trashed: 0, bytes: 0, backups: 0, failed: [] }
  for (const id of ids) {
    const p = db.prepare('SELECT id,path,size FROM flp_projects WHERE id=?').get(id) as Row | undefined
    if (!p) continue
    if (!mine(p.path, roots)) { res.failed.push(`${basename(p.path)}: outside your project folders, not touched`); continue }
    try {
      if (existsSync(p.path)) { await toTrash(p.path); res.bytes += p.size }
    } catch (e) { res.failed.push(`${basename(p.path)}: ${e instanceof Error ? e.message : 'could not move to the Trash'}`); continue }
    res.trashed++
    if (withBackups) {
      for (const b of backupFiles(roots, stem(p.path))) {
        try { await toTrash(b.path); res.backups++; res.bytes += b.size } catch { /* leave it */ }
      }
    }
    // forget it: exported MIDI copies, the index entry, and the vault beat (a bounce keeps living without its project link)
    for (const f of midiDirOf(p.path)) {
      try { unlinkSync(f) } catch { /* already gone */ }
      try { rmdirSync(dirname(f)) } catch { /* not empty, or gone */ } // the per-project folder, once it is empty
    }
    db.prepare('DELETE FROM flp_projects WHERE id=?').run(id)
    db.prepare(`UPDATE beats SET project_path=NULL, project_confidence=NULL WHERE project_path=? AND ext!='flp'`).run(p.path)
    const beat = db.prepare(`SELECT id FROM beats WHERE ext='flp' AND path=?`).get(p.path) as Row | undefined
    if (beat) {
      try { db.prepare('DELETE FROM beats WHERE id=?').run(beat.id) } catch { db.prepare('UPDATE beats SET missing=1 WHERE id=?').run(beat.id) } // a sale points at it: keep the record, hide it
    }
  }
  return res
}
