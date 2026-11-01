// Inventory of installed audio plugins (VST2, VST3, AU, AAX): find the bundles, read their Info.plist, merge formats of the same plugin.
import type Database from 'better-sqlite3'
import { execFile } from 'child_process'
import { readdirSync, type Dirent } from 'fs'
import { lstat, readdir } from 'fs/promises'
import { basename, extname, join } from 'path'
import type { PluginBundle, PluginFormat, PluginInfo } from '../shared/types'
import { pluginRoots } from './plugin-remove'

type Named = PluginBundle & { name: string; vendor: string }

const FORMATS: Record<string, PluginFormat> = { '.vst': 'vst2', '.vst3': 'vst3', '.component': 'au', '.aaxplugin': 'aax' }

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(String(out))))
  })
}

/** Total bytes under a path. Symlinks are counted as links, never followed. Async, so a huge vendor folder never freezes the app. */
export async function dirSize(path: string): Promise<number> {
  let st
  try { st = await lstat(path) } catch { return 0 }
  if (!st.isDirectory()) return st.size
  let names: string[]
  try { names = await readdir(path) } catch { return 0 }
  let total = 0
  for (const n of names) total += await dirSize(join(path, n))
  return total
}

/** Plugin bundles under a root, including those in vendor folders (u-he/Diva.vst) up to three folders down. Links are never followed. */
function findBundles(dir: string, depth = 0): string[] {
  let entries: Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  const out: string[] = []
  for (const e of entries) {
    const p = join(dir, e.name)
    if (FORMATS[extname(e.name).toLowerCase()]) out.push(p)
    else if (e.isDirectory() && depth < 3) out.push(...findBundles(p, depth + 1))
  }
  return out
}

export function parseBundleMeta(plist: Record<string, unknown>, path: string): { name: string; vendor: string; bundleId: string; version: string } | null {
  const str = (k: string) => (typeof plist[k] === 'string' ? (plist[k] as string) : '')
  const bundleId = str('CFBundleIdentifier')
  const name = str('CFBundleName') || str('CFBundleDisplayName') || (bundleId ? basename(path, extname(path)) : '')
  if (!name) return null
  const parts = bundleId.split('.')
  const vendor = parts.length >= 3 ? parts[1] : ''
  return { name, vendor, bundleId, version: str('CFBundleShortVersionString') || str('CFBundleVersion') }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function groupBundles(bundles: Named[]): { key: string; name: string; vendor: string; bundles: PluginBundle[] }[] {
  const map = new Map<string, { key: string; name: string; vendor: string; bundles: PluginBundle[] }>()
  for (const { name, vendor, ...b } of bundles) {
    const key = `${norm(vendor)}|${norm(name)}`
    const g = map.get(key) ?? { key, name, vendor, bundles: [] }
    g.bundles.push(b)
    map.set(key, g)
  }
  return [...map.values()]
}

async function readBundle(path: string): Promise<Named | null> {
  const format = FORMATS[extname(path).toLowerCase()]
  if (!format) return null
  try {
    const json = await run('plutil', ['-convert', 'json', '-o', '-', join(path, 'Contents', 'Info.plist')])
    const plist = JSON.parse(json) as Record<string, unknown>
    const meta = parseBundleMeta(plist, path)
    if (!meta) return null
    let archs: string[] = []
    const exe = typeof plist.CFBundleExecutable === 'string' ? plist.CFBundleExecutable : ''
    if (exe) { try { archs = (await run('lipo', ['-archs', join(path, 'Contents', 'MacOS', exe)])).trim().split(/\s+/).filter(Boolean) } catch { /* not a Mach-O */ } }
    return { path, format, size: await dirSize(path), archs, bundleId: meta.bundleId, version: meta.version, name: meta.name, vendor: meta.vendor }
  } catch { return null } // unreadable or corrupt bundle: skip it, keep scanning
}

export async function scanPlugins(db: Database.Database, home: string, roots: string[] = pluginRoots(home)): Promise<PluginInfo[]> {
  const found: Named[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    for (const path of findBundles(root)) {
      if (seen.has(path)) continue
      seen.add(path)
      const b = await readBundle(path)
      if (b) found.push(b)
    }
  }
  const groups = groupBundles(found)
  const now = Date.now()
  db.transaction(() => {
    const keys = new Set(groups.map((g) => g.key))
    for (const r of db.prepare('SELECT id, key FROM plugins').all() as { id: number; key: string }[]) {
      if (!keys.has(r.key)) db.prepare('DELETE FROM plugins WHERE id = ?').run(r.id)
    }
    for (const g of groups) {
      const total = g.bundles.reduce((s, b) => s + b.size, 0)
      db.prepare(`INSERT INTO plugins (key, name, vendor, total_size, scanned_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET name = excluded.name, vendor = excluded.vendor, total_size = excluded.total_size, scanned_at = excluded.scanned_at`)
        .run(g.key, g.name, g.vendor, total, now)
      const id = (db.prepare('SELECT id FROM plugins WHERE key = ?').get(g.key) as { id: number }).id
      db.prepare('DELETE FROM plugin_bundles WHERE plugin_id = ?').run(id)
      for (const b of g.bundles) {
        db.prepare('DELETE FROM plugin_bundles WHERE path = ?').run(b.path)
        db.prepare('INSERT INTO plugin_bundles (plugin_id, path, format, size, archs, bundle_id, version) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, b.path, b.format, b.size, b.archs.join(' '), b.bundleId, b.version)
      }
    }
  })()
  return listPlugins(db)
}

export function listPlugins(db: Database.Database): PluginInfo[] {
  const bundles = db.prepare('SELECT * FROM plugin_bundles').all() as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
  const sev = new Map<number, string>()
  for (const f of db.prepare('SELECT plugin_id, severity FROM plugin_findings').all() as { plugin_id: number; severity: string }[]) {
    if (sev.get(f.plugin_id) !== 'bad') sev.set(f.plugin_id, f.severity)
  }
  return (db.prepare('SELECT * FROM plugins ORDER BY total_size DESC').all() as Record<string, any>[]).map((p) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: p.id, name: p.name, vendor: p.vendor, totalSize: p.total_size,
    health: (sev.get(p.id) as PluginInfo['health']) ?? 'ok',
    bundles: bundles.filter((b) => b.plugin_id === p.id).map((b) => ({
      path: b.path, format: b.format, size: b.size, archs: b.archs ? String(b.archs).split(' ') : [], bundleId: b.bundle_id, version: b.version
    }))
  }))
}
