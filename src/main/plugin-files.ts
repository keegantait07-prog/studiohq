// Find every file a plugin owns: its bundles, installer-receipt files (exact), and name matches in the usual support folders (likely / maybe).
// Matching is token based and conservative: generic names ("Delay", "Pro") never match without the vendor, and
// anything found in your own Documents or sample folders is capped at "maybe" so it is never pre-selected.
import { execFile } from 'child_process'
import { lstatSync, readdirSync } from 'fs'
import { basename, join, sep } from 'path'
import type { Confidence, PluginFile, PluginInfo } from '../shared/types'
import { dirSize } from './plugins'
import { isRemovable, pluginRoots } from './plugin-remove'

export interface PluginIdent { name: string; vendor: string; bundleIds: string[] }
export interface FindDeps { receipts?: (p: PluginIdent) => Promise<string[]>; systemRoots?: string[] }

const GENERIC = new Set(['pro', 'free', 'delay', 'reverb', 'comp', 'compressor', 'eq', 'synth', 'lite', 'one', 'plus', 'chorus', 'limiter', 'filter', 'drive', 'bass', 'drums'])
const RANK: Record<Confidence, number> = { exact: 3, likely: 2, maybe: 1 }

const tokens = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function hasSeq(hay: string[], needle: string[]): boolean {
  if (!needle.length) return false
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((t, j) => hay[i + j] === t)) return true
  return false
}

export function matchConfidence(p: PluginIdent, candidateName: string): Confidence | null {
  for (const id of p.bundleIds) {
    if (id && new RegExp(`${escapeRe(id)}($|[^A-Za-z0-9])`, 'i').test(candidateName)) return 'likely'
  }
  const ct = tokens(candidateName)
  const pt = tokens(p.name)
  const vt = tokens(p.vendor)
  const productHit = hasSeq(ct, pt)
  const vendorHit = vt.length > 0 && vt.every((t) => ct.some((c) => c === t || (c.length >= 4 && t.startsWith(c)) || (t.length >= 4 && c.startsWith(t))))
  const generic = pt.length > 0 && (pt.every((t) => GENERIC.has(t)) || pt.join('').length <= 3)
  if (generic) return productHit && vendorHit ? 'likely' : vendorHit ? 'maybe' : null
  return productHit ? 'likely' : vendorHit ? 'maybe' : null
}

/** `pkgutil --files` prints paths relative to the package's install location. */
export function parseReceiptFiles(output: string, installLocation: string): string[] {
  const out: string[] = []
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (!line || line === '.' || line.endsWith('/') || line.split('/').includes('..')) continue
    out.push(join(installLocation, line))
  }
  return out
}

/** Receipts list every folder on the way down too. Take a folder whole only if everything inside it is in the receipt; otherwise take its items one by one. */
export function collapseCovered(entries: string[]): string[] {
  const set = new Set(entries)
  const memo = new Map<string, boolean>()
  const covered = (p: string): boolean => {
    const hit = memo.get(p)
    if (hit !== undefined) return hit
    let ok = set.has(p)
    if (ok) {
      try {
        if (lstatSync(p).isDirectory()) ok = readdirSync(p).every((n) => covered(join(p, n)))
      } catch { ok = true } // already gone
    }
    memo.set(p, ok)
    return ok
  }
  const chosen: string[] = []
  for (const e of [...set].sort()) {
    if (chosen.some((c) => e.startsWith(c + sep))) continue
    try { lstatSync(e) } catch { continue }
    if (covered(e)) chosen.push(e)
  }
  return chosen
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 30000, maxBuffer: 64 * 1024 * 1024 }, (err, out) => resolve(err ? '' : String(out))))
}

async function realReceipts(p: PluginIdent): Promise<string[]> {
  const pkgs = (await run('pkgutil', ['--pkgs'])).split('\n').filter((id) => id && matchConfidence(p, id) === 'likely')
  const out: string[] = []
  for (const id of pkgs) {
    const info = await run('pkgutil', ['--pkg-info', id])
    const volume = /^volume:\s*(.*)$/m.exec(info)?.[1].trim() || '/'
    const location = /^location:\s*(.*)$/m.exec(info)?.[1].trim() ?? ''
    out.push(...parseReceiptFiles(await run('pkgutil', ['--files', id]), join(volume, location)))
  }
  return out
}

interface Root { dir: string; location: string; cap: Confidence | null }

function searchRoots(home: string, extraRoots: string[], systemRoots: string[]): Root[] {
  const lib = join(home, 'Library')
  return [
    { dir: join(lib, 'Application Support'), location: 'Application Support', cap: null },
    { dir: join(lib, 'Preferences'), location: 'Preferences', cap: null },
    { dir: join(lib, 'Caches'), location: 'Caches', cap: null },
    { dir: join(lib, 'Logs'), location: 'Logs', cap: null },
    { dir: join(lib, 'Saved Application State'), location: 'Saved state', cap: null },
    ...systemRoots.map((dir) => ({ dir, location: dir === '/Applications' ? 'Applications' : 'System support', cap: null as Confidence | null })),
    { dir: join(home, 'Documents'), location: 'Documents', cap: 'maybe' as Confidence },
    ...extraRoots.map((dir) => ({ dir, location: 'Sample libraries', cap: 'maybe' as Confidence }))
  ]
}

const list = (dir: string): string[] => { try { return readdirSync(dir) } catch { return [] } }
const isDir = (p: string): boolean => { try { return lstatSync(p).isDirectory() } catch { return false } }

export async function findPluginFiles(plugin: PluginInfo, home: string, extraRoots: string[], deps: FindDeps = {}): Promise<PluginFile[]> {
  const ident: PluginIdent = { name: plugin.name, vendor: plugin.vendor, bundleIds: [...new Set(plugin.bundles.map((b) => b.bundleId).filter(Boolean))] }
  const systemRoots = deps.systemRoots ?? ['/Library/Application Support', '/Library/Preferences', '/Users/Shared', '/Applications']
  const found = new Map<string, { confidence: Confidence; location: string }>()
  const add = (path: string, confidence: Confidence, location: string, cap: Confidence | null = null) => {
    const c = cap && RANK[confidence] > RANK[cap] ? cap : confidence
    const prev = found.get(path)
    if (!prev || RANK[c] > RANK[prev.confidence]) found.set(path, { confidence: c, location })
  }

  const own = plugin.bundles.map((b) => b.path)
  for (const p of own) add(p, 'exact', 'Plugin folders')

  const roots = pluginRoots(home)
  const mine = (p: string) => own.some((o) => p === o || p.startsWith(o + sep))
  const theirs = (p: string) => !mine(p) && roots.some((r) => p.startsWith(r + sep))
  const receipts = await (deps.receipts ?? realReceipts)(ident)
  // An installer also drops content shared with the vendor's other products (e.g. "Shared Content"). Only items that mention this
  // plugin count as its own; the rest are listed, unchecked.
  for (const p of collapseCovered(receipts.filter((r) => !theirs(r) && !mine(r)))) {
    const own = p.split(sep).some((seg) => matchConfidence(ident, seg) === 'likely')
    add(p, own ? 'exact' : 'maybe', own ? 'Installer receipt' : 'Installer receipt (may be shared)')
  }

  for (const root of searchRoots(home, extraRoots, systemRoots)) {
    for (const name of list(root.dir)) {
      const path = join(root.dir, name)
      if (mine(path) || theirs(path)) continue
      const c = matchConfidence(ident, name)
      if (c === 'likely') add(path, 'likely', root.location, root.cap)
      else if (c === 'maybe' && isDir(path)) {
        // A vendor folder: take the product folder inside it, not the whole vendor folder that also holds other products.
        const inside = isDir(path) ? list(path).filter((n) => matchConfidence(ident, n) === 'likely') : []
        if (inside.length) for (const n of inside) add(join(path, n), 'likely', root.location, root.cap)
        else add(path, 'maybe', root.location, root.cap)
      }
    }
  }

  const allowed = [join(home, 'Documents'), ...extraRoots]
  const sorted = [...found.entries()].filter(([p]) => isRemovable(p, home, allowed)).sort((a, b) => a[0].length - b[0].length)
  const kept: [string, { confidence: Confidence; location: string }][] = []
  for (const e of sorted) {
    const parent = kept.find(([k]) => e[0].startsWith(k + sep))
    if (parent && !(e[1].confidence === 'exact' && parent[1].confidence !== 'exact')) continue
    kept.push(e)
  }
  return kept
    .map(([path, v]) => ({ path, size: dirSize(path), confidence: v.confidence, location: v.location }) as PluginFile)
    .sort((a, b) => b.size - a.size || basename(a.path).localeCompare(basename(b.path)))
}
