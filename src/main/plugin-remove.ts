// Removing plugin files. Safety rules: only paths strictly inside known plugin/library locations, never Apple's own files,
// symlinks that leave those locations are refused, and everything goes to the macOS Trash (recoverable).
import type Database from 'better-sqlite3'
import { execFile } from 'child_process'
import { accessSync, constants, existsSync, realpathSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'path'
import type { RemoveResult } from '../shared/types'
import { dirSize } from './plugins'

/** Where plugin bundles live (VST2, VST3, AU, AAX), for the user and the whole system. */
export function pluginRoots(home: string): string[] {
  const out: string[] = []
  for (const base of ['/Library/Audio/Plug-Ins', join(home, 'Library/Audio/Plug-Ins')]) {
    for (const d of ['VST', 'VST3', 'Components']) out.push(join(base, d))
  }
  out.push('/Library/Application Support/Avid/Audio/Plug-Ins', join(home, 'Library/Application Support/Avid/Audio/Plug-Ins'))
  return out
}

/** Folders where plugins keep presets, caches and licenses. Anything inside is a candidate; the folders themselves are not. */
function supportRoots(home: string): string[] {
  const lib = join(home, 'Library')
  return [
    join(lib, 'Application Support'), join(lib, 'Preferences'), join(lib, 'Caches'), join(lib, 'Logs'), join(lib, 'Saved Application State'),
    '/Library/Application Support', '/Library/Preferences', '/Users/Shared', '/Applications'
  ]
}

function real(p: string): string {
  try { return realpathSync(p) } catch { return p }
}

/** realpath of the nearest existing ancestor plus the not-yet-existing remainder, so symlinks anywhere on the way are resolved. */
function resolveLoose(p: string): string {
  let rest = ''
  let cur = p
  for (;;) {
    try { return join(realpathSync(cur), rest) } catch {
      const up = dirname(cur)
      if (up === cur) return p
      rest = join(basename(cur), rest)
      cur = up
    }
  }
}

export function isRemovable(path: string, home: string, extraRoots: string[] = []): boolean {
  if (!isAbsolute(path) || path.split(sep).includes('..')) return false
  const target = resolveLoose(path)
  if (basename(target).startsWith('com.apple.')) return false
  const roots = [...pluginRoots(home), ...supportRoots(home), ...extraRoots]
  return roots.some((r) => {
    const rel = relative(real(r), target)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

export interface RemoveDeps {
  toTrash(path: string): Promise<void>
  adminTrash(path: string): Promise<void>
  needsAdmin(path: string): boolean
}

/** Moving to the Trash needs write access to the folder the item sits in. */
export function needsAdmin(path: string): boolean {
  try { accessSync(dirname(path), constants.W_OK); return false } catch { return true }
}

export function trashDest(home: string, src: string, exists: (p: string) => boolean = existsSync, stamp: number = Date.now()): string {
  const ext = extname(src)
  const stem = basename(src, ext)
  const first = join(home, '.Trash', basename(src))
  return exists(first) ? join(home, '.Trash', `${stem} ${stamp}${ext}`) : first
}

/** Paths go in as separate osascript arguments, so no quoting of names is needed or attempted. */
export function adminTrashArgs(src: string, dest: string): string[] {
  return [
    '-e', 'on run argv',
    '-e', 'do shell script "/bin/mv " & quoted form of (item 1 of argv) & " " & quoted form of (item 2 of argv) with administrator privileges',
    '-e', 'end run',
    src, dest
  ]
}

function adminTrash(home: string, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('osascript', adminTrashArgs(path, trashDest(home, path)), { timeout: 120000 }, (err, _o, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve()))
  })
}

export async function removeWith(
  db: Database.Database, deps: RemoveDeps, plugin: { id: number; name: string }, paths: string[], home: string, extraRoots: string[]
): Promise<RemoveResult> {
  const res: RemoveResult = { removed: 0, bytes: 0, skipped: [], failed: [] }
  for (const path of paths) {
    if (!isRemovable(path, home, extraRoots)) { res.skipped.push(path); continue }
    const admin = deps.needsAdmin(path)
    const size = dirSize(path)
    try {
      await (admin ? deps.adminTrash(path) : deps.toTrash(path))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (admin) res.skipped.push(path) // the admin prompt was declined or failed
      else res.failed.push(`${path}: ${msg}`)
      continue
    }
    res.removed++
    res.bytes += size
    db.prepare('INSERT INTO plugin_actions (at, kind, plugin_name, original_path, new_path, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Date.now(), 'remove', plugin.name, path, '', admin ? 'removed with admin rights' : 'moved to the Trash')
  }
  return res
}

export async function removePluginFiles(
  db: Database.Database, plugin: { id: number; name: string }, paths: string[], home: string, extraRoots: string[]
): Promise<RemoveResult> {
  const { toTrash } = await import('./cleanup') // loaded here because it needs Electron
  return removeWith(db, { toTrash, adminTrash: (p) => adminTrash(home, p), needsAdmin }, plugin, paths, home, extraRoots)
}
