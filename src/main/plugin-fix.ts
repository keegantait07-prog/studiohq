// Fixes for plugins that crash FL or show "not found". Every fix is previewed first and undoable: disabled plugins move to a
// managed folder and can be restored, FL's plugin list is backed up before it is edited, removals go to the Trash.
// Anything in root-owned folders (/Library/...) goes through the macOS admin prompt.
import type Database from 'better-sqlite3'
import { execFile, spawnSync } from 'child_process'
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { FixKind, HealthFinding, PluginFormat, RemoveResult } from '../shared/types'
import { listPlugins } from './plugins'
import { needsAdmin as parentNeedsAdmin, removePluginFiles } from './plugin-remove'

export interface FixDeps {
  move(src: string, dest: string, admin: boolean): Promise<void>
  exec(cmd: string, args: string[], admin: boolean): Promise<void>
  needsAdmin(path: string): boolean
  flRunning(): boolean
  removePaths(db: Database.Database, plugin: { id: number; name: string }, paths: string[], home: string): Promise<RemoveResult>
}

const FORMAT_DIR: Record<PluginFormat, string> = { vst2: 'VST', vst3: 'VST3', au: 'Components', aax: 'AAX' }
const FORMAT_BY_EXT: Record<string, PluginFormat> = { '.vst': 'vst2', '.vst3': 'vst3', '.component': 'au', '.aaxplugin': 'aax' }
const supportDir = (home: string) => join(home, 'Library/Application Support/Studio HQ')
const disabledDir = (home: string) => join(supportDir(home), 'Disabled Plugins')
export const defaultFlDb = (home: string) => join(home, 'Documents/Image-Line/FL Studio/Presets/Plugin database/Installed/.Plugins.ini')

export function localMove(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  try { renameSync(src, dest) } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    cpSync(src, dest, { recursive: true, verbatimSymlinks: true })
    rmSync(src, { recursive: true, force: true })
  }
}

/** osascript runs the command with the paths as separate arguments, so no shell quoting of file names is attempted. */
export function adminExecArgs(cmd: string, args: string[]): string[] {
  return [
    '-e', 'on run argv',
    '-e', 'set c to quoted form of (item 1 of argv)',
    '-e', 'repeat with i from 2 to count of argv',
    '-e', 'set c to c & " " & quoted form of (item i of argv)',
    '-e', 'end repeat',
    '-e', 'do shell script c with administrator privileges',
    '-e', 'end run',
    cmd, ...args
  ]
}

const ABS: Record<string, string> = { xattr: '/usr/bin/xattr', codesign: '/usr/bin/codesign', mkdir: '/bin/mkdir' }

function execReal(cmd: string, args: string[], admin: boolean): Promise<void> {
  const [file, argv] = admin ? ['osascript', adminExecArgs(ABS[cmd] ?? cmd, args)] : [cmd, args]
  return new Promise((resolve, reject) => execFile(file, argv, { timeout: 120000 }, (err, _o, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve())))
}

const writable = (p: string) => { try { accessSync(p, constants.W_OK); return true } catch { return false } }

export function realFixDeps(): FixDeps {
  return {
    move: async (src, dest, admin) => {
      if (!admin) return localMove(src, dest)
      await execReal('mkdir', ['-p', dirname(dest)], true)
      await execReal('/bin/mv', [src, dest], true)
    },
    exec: execReal,
    needsAdmin: (p) => (existsSync(p) ? !writable(p) || parentNeedsAdmin(p) : parentNeedsAdmin(p)),
    flRunning: () => spawnSync('pgrep', ['-if', 'FL Studio.*\\.app/Contents/MacOS']).status === 0,
    removePaths: (db, plugin, paths, home) => removePluginFiles(db, plugin, paths, home, [])
  }
}

const log = (db: Database.Database, kind: string, name: string, original: string, next: string, note = '') =>
  Number(db.prepare('INSERT INTO plugin_actions (at, kind, plugin_name, original_path, new_path, note) VALUES (?, ?, ?, ?, ?, ?)').run(Date.now(), kind, name, original, next, note).lastInsertRowid)

const formatOf = (path: string): PluginFormat => FORMAT_BY_EXT[extname(path).toLowerCase()] ?? 'vst3'

// ---- disable / restore ----

export async function disablePlugin(
  db: Database.Database, deps: FixDeps, plugin: { name: string; bundles: { path: string; format: PluginFormat }[] }, home: string
): Promise<void> {
  for (const b of plugin.bundles) {
    const dir = join(disabledDir(home), FORMAT_DIR[b.format])
    let dest = join(dir, basename(b.path))
    if (existsSync(dest)) dest = join(dir, `${basename(b.path, extname(b.path))} ${Date.now()}${extname(b.path)}`)
    await deps.move(b.path, dest, deps.needsAdmin(b.path))
    log(db, 'disable', plugin.name, b.path, dest, 'moved to Studio HQ Disabled Plugins')
  }
}

export function listDisabled(db: Database.Database): { actionId: number; name: string; originalPath: string; at: number }[] {
  return (db.prepare("SELECT id, plugin_name, original_path, at FROM plugin_actions WHERE kind = 'disable' ORDER BY at DESC, id DESC").all() as Record<string, any>[]) // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((r) => ({ actionId: r.id, name: r.plugin_name, originalPath: r.original_path, at: r.at }))
}

export async function restoreDisabled(db: Database.Database, deps: FixDeps, actionIds: number[]): Promise<{ restored: number; failed: string[] }> {
  const out = { restored: 0, failed: [] as string[] }
  for (const id of actionIds) {
    const r = db.prepare("SELECT * FROM plugin_actions WHERE id = ? AND kind = 'disable'").get(id) as Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!r) { out.failed.push(`#${id}: not a disabled plugin`); continue }
    if (existsSync(r.original_path)) { out.failed.push(`${r.original_path}: something is already installed there`); continue }
    if (!existsSync(r.new_path)) { out.failed.push(`${r.plugin_name}: the disabled copy is no longer in the Disabled Plugins folder`); continue }
    try {
      await deps.move(r.new_path, r.original_path, deps.needsAdmin(r.original_path))
      db.prepare("UPDATE plugin_actions SET kind = 'restore' WHERE id = ?").run(id)
      out.restored++
    } catch (e) { out.failed.push(`${r.original_path}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  return out
}

// ---- FL's plugin list ----

export function removeIniSection(text: string, section: string): string {
  const bom = text.startsWith('﻿')
  const lines = text.replace(/^﻿/, '').split(/(?<=\n)/)
  const start = lines.findIndex((l) => l.trim() === `[${section}]`)
  if (start < 0) throw new Error(`"${section}" is not in FL's plugin list`)
  let end = start + 1
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++
  const body = [...lines.slice(0, start), ...lines.slice(end)].join('')
  return (bom ? '﻿' : '') + body
}

// ---- dispatch ----

export function previewFix(f: HealthFinding): string {
  const at = f.path || 'all of its files'
  switch (f.fix) {
    case 'disable': return `Move ${at} to Studio HQ's Disabled Plugins folder so FL stops loading it. You can restore it from the Disabled list at any time.`
    case 'unquarantine': return `Remove the macOS quarantine flag from ${at}. This tells macOS you trust the plugin; only do it for plugins you installed yourself.`
    case 'resign': return `Re-sign ${at} on this Mac with an ad-hoc signature so Apple Silicon will load it. This changes the plugin's files; reinstalling the plugin undoes it.`
    case 'remove-bundle': return `Move the broken plugin ${at} to the Trash. It cannot load as it is.`
    case 'clear-fl-entry': return `Back up FL's plugin list, then remove the entry "${f.path}" from it. Close FL Studio first; FL rebuilds the entry the next time it scans.`
    default: return 'No automatic fix is available. See the details for what to do.'
  }
}

export async function applyFix(db: Database.Database, deps: FixDeps, f: HealthFinding, home: string, flDbPath: string = defaultFlDb(home)): Promise<void> {
  const fix: FixKind | null = f.fix
  switch (fix) {
    case 'disable': {
      let bundles = f.path ? [{ path: f.path, format: formatOf(f.path) }] : (listPlugins(db).find((p) => p.id === f.pluginId)?.bundles ?? []).map((b) => ({ path: b.path, format: b.format }))
      bundles = bundles.filter((b) => existsSync(b.path))
      if (!bundles.length) throw new Error('Nothing to disable: the plugin files are already gone. Rescan and try again.')
      return disablePlugin(db, deps, { name: f.name, bundles }, home)
    }
    case 'unquarantine':
      await deps.exec('xattr', ['-dr', 'com.apple.quarantine', f.path], deps.needsAdmin(f.path))
      log(db, 'unquarantine', f.name, f.path, '')
      return
    case 'resign':
      await deps.exec('codesign', ['--force', '--deep', '--sign', '-', f.path], deps.needsAdmin(f.path))
      log(db, 'resign', f.name, f.path, '', 'ad-hoc signature applied')
      return
    case 'remove-bundle': {
      const r = await deps.removePaths(db, { id: f.pluginId ?? 0, name: f.name }, [f.path], home)
      if (r.removed === 0) throw new Error(`Refused or failed: ${[...r.skipped, ...r.failed].join('; ') || f.path}`)
      return
    }
    case 'clear-fl-entry': {
      if (deps.flRunning()) throw new Error('Close FL Studio first: it rewrites its plugin list when it quits and would undo this.')
      const text = readFileSync(flDbPath, 'utf8')
      const next = removeIniSection(text, f.path)
      const backups = join(supportDir(home), 'FL Backups')
      mkdirSync(backups, { recursive: true })
      const backup = join(backups, `Plugins.ini ${new Date().toISOString().replace(/[:.]/g, '-')}.bak`)
      writeFileSync(backup, text)
      const tmp = `${flDbPath}.studiohq-tmp`
      try { writeFileSync(tmp, next); renameSync(tmp, flDbPath) } catch (e) { rmSync(tmp, { force: true }); throw e }
      log(db, 'clear-fl-entry', f.name, flDbPath, backup, `removed [${f.path}]`)
      return
    }
    default:
      throw new Error('This finding has no automatic fix.')
  }
}
