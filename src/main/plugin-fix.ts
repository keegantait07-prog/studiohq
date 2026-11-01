// Fixes for plugins that crash FL or show "not found". Every fix is previewed first and undoable: disabled plugins move to a
// managed folder and can be restored, FL's plugin list is backed up before it is edited, removals go to the Trash.
// Anything in root-owned folders (/Library/...) needs administrator rights; all of it, for however many plugins, is done in ONE
// batch behind a single macOS password prompt.
import type Database from 'better-sqlite3'
import { execFile, spawnSync } from 'child_process'
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { FixKind, HealthFinding, PluginFormat, RemoveResult } from '../shared/types'
import { listPlugins } from './plugins'
import { parseFlPluginDb } from './plugin-health'
import { runAdmin, type AdminCmd } from './plugin-admin'
import { isRemovable, needsAdmin as parentNeedsAdmin, removePluginFiles, uniqueTrashDests } from './plugin-remove'

export interface FixDeps {
  /** Move as you (no administrator rights). */
  move(src: string, dest: string): Promise<void>
  /** Run a command as you (no administrator rights). */
  exec(cmd: string, args: string[]): Promise<void>
  /** Run commands as administrator, all behind one password prompt. Resolves with the positions that failed; rejects if the prompt is cancelled. */
  runAdmin(cmds: AdminCmd[]): Promise<number[]>
  needsAdmin(path: string): boolean
  flRunning(): boolean
  removePaths(db: Database.Database, plugin: { id: number; name: string }, paths: string[], home: string): Promise<RemoveResult>
}

const FORMAT_DIR: Record<PluginFormat, string> = { vst2: 'VST', vst3: 'VST3', au: 'Components', aax: 'AAX' }
const FORMAT_BY_EXT: Record<string, PluginFormat> = { '.vst': 'vst2', '.vst3': 'vst3', '.component': 'au', '.aaxplugin': 'aax' }
const supportDir = (home: string) => join(home, 'Library/Application Support/Studio HQ')
const disabledDir = (home: string) => join(supportDir(home), 'Disabled Plugins')
export const defaultFlDb = (home: string) => join(home, 'Documents/Image-Line/FL Studio/Presets/Plugin database/Installed/.Plugins.ini')
const BOM = '﻿'
const CANCELLED = /cancel|-128/i

export function localMove(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  try { renameSync(src, dest) } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    cpSync(src, dest, { recursive: true, verbatimSymlinks: true })
    rmSync(src, { recursive: true, force: true })
  }
}

const writable = (p: string) => { try { accessSync(p, constants.W_OK); return true } catch { return false } }

export function realFixDeps(): FixDeps {
  return {
    move: async (src, dest) => localMove(src, dest),
    exec: (cmd, args) => new Promise<void>((resolve, reject) => execFile(cmd, args, { timeout: 120000 }, (err, _o, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve()))),
    runAdmin,
    needsAdmin: (p) => (existsSync(p) ? !writable(p) || parentNeedsAdmin(p) : parentNeedsAdmin(p)),
    flRunning: () => spawnSync('pgrep', ['-if', 'FL Studio.*\\.app/Contents/MacOS']).status === 0,
    removePaths: (db, plugin, paths, home) => removePluginFiles(db, plugin, paths, home, [])
  }
}

const log = (db: Database.Database, kind: string, name: string, original: string, next: string, note = '') =>
  Number(db.prepare('INSERT INTO plugin_actions (at, kind, plugin_name, original_path, new_path, note) VALUES (?, ?, ?, ?, ?, ?)').run(Date.now(), kind, name, original, next, note).lastInsertRowid)

const formatOf = (path: string): PluginFormat => FORMAT_BY_EXT[extname(path).toLowerCase()] ?? 'vst3'

/** Something that needs administrator rights, planned now and run later together with everything else that does. */
interface AdminOp { cmds: AdminCmd[]; done: () => void }

/** Run planned operations in one admin call. Returns which of them failed; throws if the password prompt is cancelled. */
async function runOps(deps: FixDeps, ops: AdminOp[]): Promise<boolean[]> {
  if (!ops.length) return []
  const failedAt = await deps.runAdmin(ops.flatMap((o) => o.cmds))
  let offset = 0
  return ops.map((o) => {
    const bad = failedAt.some((k) => k >= offset && k < offset + o.cmds.length)
    offset += o.cmds.length
    if (!bad) o.done()
    return bad
  })
}

// ---- disable / restore ----

/** Moves what it can as you right away and returns what needs administrator rights, so callers can do all of that in one go. */
async function planDisable(db: Database.Database, deps: FixDeps, plugin: { name: string; bundles: { path: string; format: PluginFormat }[] }, home: string): Promise<AdminOp[]> {
  const ops: AdminOp[] = []
  const taken = new Set<string>()
  for (const b of plugin.bundles) {
    const dir = join(disabledDir(home), FORMAT_DIR[b.format])
    mkdirSync(dir, { recursive: true }) // as you, so a later disable or restore never hits a root-owned folder
    let dest = join(dir, basename(b.path))
    if (existsSync(dest) || taken.has(dest)) dest = join(dir, `${basename(b.path, extname(b.path))} ${Date.now()}-${taken.size}${extname(b.path)}`)
    taken.add(dest)
    const note = 'moved to Studio HQ Disabled Plugins'
    if (deps.needsAdmin(b.path)) ops.push({ cmds: [{ cmd: '/bin/mv', args: [b.path, dest] }], done: () => { log(db, 'disable', plugin.name, b.path, dest, note) } })
    else { await deps.move(b.path, dest); log(db, 'disable', plugin.name, b.path, dest, note) }
  }
  return ops
}

export async function disablePlugin(db: Database.Database, deps: FixDeps, plugin: { name: string; bundles: { path: string; format: PluginFormat }[] }, home: string): Promise<void> {
  const failed = (await runOps(deps, await planDisable(db, deps, plugin, home))).filter(Boolean).length
  if (failed) throw new Error(`${plugin.name}: could not be moved with administrator rights`)
}

export function listDisabled(db: Database.Database): { actionId: number; name: string; originalPath: string; at: number }[] {
  return (db.prepare("SELECT id, plugin_name, original_path, at FROM plugin_actions WHERE kind = 'disable' ORDER BY at DESC, id DESC").all() as Record<string, any>[]) // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((r) => ({ actionId: r.id, name: r.plugin_name, originalPath: r.original_path, at: r.at }))
}

export async function restoreDisabled(db: Database.Database, deps: FixDeps, actionIds: number[]): Promise<{ restored: number; failed: string[] }> {
  const out = { restored: 0, failed: [] as string[] }
  const markRestored = (id: number) => db.prepare("UPDATE plugin_actions SET kind = 'restore' WHERE id = ?").run(id)
  const queued: { id: number; original: string; op: AdminOp }[] = []
  for (const id of actionIds) {
    const r = db.prepare("SELECT * FROM plugin_actions WHERE id = ? AND kind = 'disable'").get(id) as Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!r) { out.failed.push(`#${id}: not a disabled plugin`); continue }
    if (existsSync(r.original_path)) { out.failed.push(`${r.original_path}: something is already installed there`); continue }
    if (!existsSync(r.new_path)) { out.failed.push(`${r.plugin_name}: the disabled copy is no longer in the Disabled Plugins folder`); continue }
    if (deps.needsAdmin(r.original_path)) { queued.push({ id, original: r.original_path, op: { cmds: [{ cmd: '/bin/mv', args: [r.new_path, r.original_path] }], done: () => { markRestored(id); out.restored++ } } }); continue }
    try { await deps.move(r.new_path, r.original_path); markRestored(id); out.restored++ } catch (e) { out.failed.push(`${r.original_path}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  if (queued.length) {
    try {
      const bad = await runOps(deps, queued.map((q) => q.op))
      bad.forEach((b, i) => { if (b) out.failed.push(`${queued[i].original}: could not be restored`) })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      out.failed.push(CANCELLED.test(msg) ? 'The password prompt was cancelled, so nothing in /Library was restored.' : msg)
    }
  }
  return out
}

// ---- FL's plugin list ----

export function removeIniSection(text: string, section: string): string {
  const bom = text.startsWith(BOM)
  const lines = text.replace(/^﻿/, '').split(/(?<=\n)/)
  const start = lines.findIndex((l) => l.trim() === `[${section}]`)
  if (start < 0) throw new Error(`"${section}" is not in FL's plugin list`)
  let end = start + 1
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++
  const body = [...lines.slice(0, start), ...lines.slice(end)].join('')
  return (bom ? BOM : '') + body
}

// ---- dispatch ----

export function previewFix(f: HealthFinding): string {
  const at = f.path || 'all of its files'
  switch (f.fix) {
    case 'disable': return `Move ${at} to Studio HQ's Disabled Plugins folder so FL stops loading it. You can restore it from the Disabled list at any time.`
    case 'unquarantine': return `Remove the macOS quarantine flag from ${at}. This tells macOS you trust the plugin; only do it for plugins you installed yourself.`
    case 'resign': return `Re-sign ${at} on this Mac with an ad-hoc signature so Apple Silicon will load it. This changes the plugin's files; reinstalling the plugin undoes it.`
    case 'remove-bundle': return `Move the broken plugin ${at} to the Trash. It cannot load as it is.`
    case 'clear-fl-entry': return `Back up FL's plugin list, then remove its entries for "${f.name}". Close FL Studio first; FL re-scans the plugin the next time it looks for plugins.`
    default: return 'No automatic fix is available. See the details for what to do.'
  }
}

/** Does what it can as you straight away and returns the part that needs administrator rights. Throws if the fix cannot be done. */
async function planOne(db: Database.Database, deps: FixDeps, f: HealthFinding, home: string, takenTrash: Set<string>): Promise<AdminOp[]> {
  const fix: FixKind | null = f.fix
  switch (fix) {
    case 'disable': {
      let bundles = f.path ? [{ path: f.path, format: formatOf(f.path) }] : (listPlugins(db).find((p) => p.id === f.pluginId)?.bundles ?? []).map((b) => ({ path: b.path, format: b.format }))
      bundles = bundles.filter((b) => existsSync(b.path))
      if (!bundles.length) throw new Error('Nothing to disable: the plugin files are already gone. Rescan and try again.')
      return planDisable(db, deps, { name: f.name, bundles }, home)
    }
    case 'unquarantine':
      if (deps.needsAdmin(f.path)) return [{ cmds: [{ cmd: '/usr/bin/xattr', args: ['-dr', 'com.apple.quarantine', f.path] }], done: () => { log(db, 'unquarantine', f.name, f.path, '') } }]
      await deps.exec('xattr', ['-dr', 'com.apple.quarantine', f.path])
      log(db, 'unquarantine', f.name, f.path, '')
      return []
    case 'resign':
      if (deps.needsAdmin(f.path)) return [{ cmds: [{ cmd: '/usr/bin/codesign', args: ['--force', '--deep', '--sign', '-', f.path] }], done: () => { log(db, 'resign', f.name, f.path, '', 'ad-hoc signature applied') } }]
      await deps.exec('codesign', ['--force', '--deep', '--sign', '-', f.path])
      log(db, 'resign', f.name, f.path, '', 'ad-hoc signature applied')
      return []
    case 'remove-bundle': {
      if (!isRemovable(f.path, home)) throw new Error(`Refused or failed: ${f.path} is not somewhere plugins are removed from`)
      if (!deps.needsAdmin(f.path)) {
        const r = await deps.removePaths(db, { id: f.pluginId ?? 0, name: f.name }, [f.path], home)
        if (r.removed === 0) throw new Error(`Refused or failed: ${[...r.skipped, ...r.failed].join('; ') || f.path}`)
        return []
      }
      const dest = uniqueTrashDests(home, [f.path], (p) => existsSync(p) || takenTrash.has(p))[0]
      takenTrash.add(dest)
      // into your Trash, then handed back to you so emptying the Trash never asks for a password
      return [{ cmds: [{ cmd: '/bin/mv', args: [f.path, dest] }, { cmd: '/usr/sbin/chown', args: ['-R', String(process.getuid?.() ?? 501), dest] }], done: () => { log(db, 'remove', f.name, f.path, '', 'removed with admin rights') } }]
    }
    default:
      throw new Error('This finding has no automatic fix.')
  }
}

export async function applyFix(db: Database.Database, deps: FixDeps, f: HealthFinding, home: string, flDbPath: string = defaultFlDb(home)): Promise<void> {
  const r = await applyFixes(db, deps, [f], home, flDbPath)
  if (r.failed.length) throw new Error(r.failed[0])
}

/** One backup and one write for any number of FL entries. A finding names either one FL section or a plugin file; a file can be listed in several sections (effects, generators). */
async function clearFlEntries(db: Database.Database, deps: FixDeps, fs: HealthFinding[], home: string, flDbPath: string): Promise<void> {
  if (deps.flRunning()) throw new Error('Close FL Studio first: it rewrites its plugin list when it quits and would undo this.')
  const text = readFileSync(flDbPath, 'utf8')
  const entries = parseFlPluginDb(text)
  const sections = new Set<string>()
  for (const f of fs) {
    if (f.path.startsWith('/')) entries.filter((e) => e.path === f.path).forEach((e) => sections.add(e.section))
    else sections.add(f.path)
  }
  if (!sections.size) throw new Error(`FL's plugin list has no entry for ${fs.map((f) => f.name).join(', ')}`)
  const next = [...sections].reduce((t, s) => removeIniSection(t, s), text)
  const backups = join(supportDir(home), 'FL Backups')
  mkdirSync(backups, { recursive: true })
  // Never overwrite an earlier backup, even one made in the same millisecond.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let backup = join(backups, `Plugins.ini ${stamp}.bak`)
  for (let i = 2; existsSync(backup); i++) backup = join(backups, `Plugins.ini ${stamp} (${i}).bak`)
  writeFileSync(backup, text)
  const tmp = `${flDbPath}.studiohq-tmp`
  try { writeFileSync(tmp, next); renameSync(tmp, flDbPath) } catch (e) { rmSync(tmp, { force: true }); throw e }
  log(db, 'clear-fl-entry', fs.length === 1 ? fs[0].name : `${fs.length} plugins`, flDbPath, backup, `removed ${[...sections].map((s) => `[${s}]`).join(' ')}`)
}

/** Apply many fixes. A failure is reported by name and does not stop the rest. Everything that needs administrator rights is done in one batch, so there is at most one password prompt. */
export async function applyFixes(db: Database.Database, deps: FixDeps, fs: HealthFinding[], home: string, flDbPath: string = defaultFlDb(home)): Promise<{ applied: number; failed: string[] }> {
  const out = { applied: 0, failed: [] as string[] }
  const fl = fs.filter((f) => f.fix === 'clear-fl-entry')
  if (fl.length) {
    try { await clearFlEntries(db, deps, fl, home, flDbPath); out.applied += fl.length } catch (e) { out.failed.push(`FL's plugin list: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const queued: { f: HealthFinding; op: AdminOp }[] = []
  const takenTrash = new Set<string>()
  for (const f of fs.filter((x) => x.fix !== 'clear-fl-entry')) {
    try {
      const ops = await planOne(db, deps, f, home, takenTrash)
      if (!ops.length) out.applied++
      else ops.forEach((op) => queued.push({ f, op }))
    } catch (e) { out.failed.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  if (!queued.length) return out
  let bad: boolean[]
  try { bad = await runOps(deps, queued.map((q) => q.op)) } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    out.failed.push(CANCELLED.test(msg) ? 'The password prompt was cancelled, so nothing that needs administrator rights was changed.' : `Administrator step failed: ${msg}`)
    return out
  }
  const verdict = new Map<HealthFinding, boolean>()
  queued.forEach((q, i) => verdict.set(q.f, (verdict.get(q.f) ?? true) && !bad[i]))
  for (const [f, ok] of verdict) { if (ok) out.applied++; else out.failed.push(`${f.name}: could not be changed with administrator rights`) }
  return out
}
