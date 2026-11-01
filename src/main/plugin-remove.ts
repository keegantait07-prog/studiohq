// Removing plugin files. Safety rules: only paths strictly inside known plugin/library locations, never Apple's own files,
// symlinks that leave those locations are refused, and everything goes to the macOS Trash (recoverable).
import type Database from 'better-sqlite3'
import { accessSync, constants, existsSync, lstatSync, realpathSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'path'
import type { RemoveManyResult, RemoveResult } from '../shared/types'
import { dirSize } from './plugins'
import { runAdmin } from './plugin-admin'

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

// Apple's own apps and support folders are never ours to remove, even inside /Applications or /Library.
const APPLE_APP = /^(GarageBand|Logic Pro( X)?|MainStage( \d+)?|Final Cut Pro|Motion|Compressor|iMovie|Safari|Xcode|Keynote|Pages|Numbers)\.app$/i
const isApple = (segment: string) => /^com\.apple\./i.test(segment) || segment.toLowerCase() === 'apple' || APPLE_APP.test(segment)

export function isRemovable(path: string, home: string, extraRoots: string[] = []): boolean {
  if (!isAbsolute(path) || path.split(sep).includes('..')) return false
  const target = resolveLoose(path)
  if (target.split(sep).some(isApple)) return false
  const roots = [...pluginRoots(home), ...supportRoots(home), ...extraRoots]
  return roots.some((r) => {
    const rel = relative(real(r), target)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

export interface RemoveDeps {
  toTrash(path: string): Promise<void>
  /** Move every protected path to the Trash behind a single password prompt. Rejects if the prompt is cancelled. */
  adminTrashMany(paths: string[]): Promise<void>
  needsAdmin(path: string): boolean
  /** True once the path is no longer where it was. Defaults to checking the disk. */
  gone?(path: string): boolean
}

export interface RemoveItem { plugin: { id: number; name: string }; paths: string[] }

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

/** Trash names for a whole batch, so two items called "Massive.vst" never land on the same name. */
export function uniqueTrashDests(home: string, srcs: string[], exists: (p: string) => boolean = existsSync): string[] {
  const taken = new Set<string>()
  return srcs.map((src, i) => {
    const dest = trashDest(home, src, (p) => exists(p) || taken.has(p), Date.now() + i)
    taken.add(dest)
    return dest
  })
}

const stillThere = (p: string) => { try { lstatSync(p); return true } catch { return false } }

/** Remove files for any number of plugins. User-owned files are trashed one by one; everything that needs administrator rights is moved in ONE batch, so there is one password prompt. */
export async function removeBatchWith(db: Database.Database, deps: RemoveDeps, items: RemoveItem[], home: string, extraRoots: string[]): Promise<RemoveManyResult> {
  const out: RemoveManyResult = { plugins: 0, removed: 0, bytes: 0, skipped: [], failed: [], declined: false }
  const log = (name: string, path: string, note: string) =>
    db.prepare('INSERT INTO plugin_actions (at, kind, plugin_name, original_path, new_path, note) VALUES (?, ?, ?, ?, ?, ?)').run(Date.now(), 'remove', name, path, '', note)
  const queue: { name: string; path: string; size: number }[] = []
  for (const it of items) {
    out.plugins++
    for (const path of it.paths) {
      if (!isRemovable(path, home, extraRoots)) { out.skipped.push(path); continue }
      if (!stillThere(path)) continue // already gone, e.g. it was inside a folder trashed a moment ago
      const size = await dirSize(path)
      if (deps.needsAdmin(path)) { queue.push({ name: it.plugin.name, path, size }); continue }
      try { await deps.toTrash(path) } catch (e) { out.failed.push(`${path}: ${e instanceof Error ? e.message : String(e)}`); continue }
      out.removed++; out.bytes += size
      log(it.plugin.name, path, 'moved to the Trash')
    }
  }
  if (!queue.length) return out
  try {
    await deps.adminTrashMany(queue.map((q) => q.path))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel|-128/i.test(msg)) { out.declined = true; out.skipped.push(...queue.map((q) => q.path)) } // said no to the one prompt
    else out.failed.push(...queue.map((q) => `${q.path}: ${msg}`))
    return out
  }
  const gone = deps.gone ?? ((p: string) => !stillThere(p))
  for (const q of queue) {
    if (gone(q.path)) { out.removed++; out.bytes += q.size; log(q.name, q.path, 'removed with admin rights') }
    else out.failed.push(`${q.path}: still there after the password step`)
  }
  return out
}

const single = (r: RemoveManyResult): RemoveResult => ({ removed: r.removed, bytes: r.bytes, skipped: r.skipped, failed: r.failed, ...(r.declined ? { declined: true } : {}) })

export async function removeWith(db: Database.Database, deps: RemoveDeps, plugin: { id: number; name: string }, paths: string[], home: string, extraRoots: string[]): Promise<RemoveResult> {
  return single(await removeBatchWith(db, deps, [{ plugin, paths }], home, extraRoots))
}

export async function removePluginsMany(db: Database.Database, items: RemoveItem[], home: string, extraRoots: string[]): Promise<RemoveManyResult> {
  const { toTrash } = await import('./cleanup') // loaded here because it needs Electron
  const adminTrashMany = async (paths: string[]) => {
    const dests = uniqueTrashDests(home, paths)
    // Move into your Trash, then hand the items back to you so emptying the Trash never asks again.
    await runAdmin(paths.flatMap((p, i) => [
      { cmd: '/bin/mv', args: [p, dests[i]] },
      { cmd: '/usr/sbin/chown', args: ['-R', String(process.getuid?.() ?? 501), dests[i]] }
    ]))
  }
  return removeBatchWith(db, { toTrash, adminTrashMany, needsAdmin }, items, home, extraRoots)
}

export async function removePluginFiles(db: Database.Database, plugin: { id: number; name: string }, paths: string[], home: string, extraRoots: string[]): Promise<RemoveResult> {
  return single(await removePluginsMany(db, [{ plugin, paths }], home, extraRoots))
}
