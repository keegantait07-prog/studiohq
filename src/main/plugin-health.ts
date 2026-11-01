// Why does a plugin crash FL Studio or show "not found"? Look at FL's crash reports, the plugin's architecture, signature and quarantine
// state, duplicate copies, and FL's own plugin list. Each finding says how sure we are and, where possible, offers a reversible fix.
import type Database from 'better-sqlite3'
import { execFile } from 'child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, sep } from 'path'
import type { HealthFinding, PluginBundle, PluginInfo } from '../shared/types'
import { listPlugins } from './plugins'

export type FindingDraft = Omit<HealthFinding, 'id'>
export type BundleDraft = Omit<FindingDraft, 'pluginId' | 'name'>
export interface CrashReport { app: string; crashedFrames: string[]; images: string[] }
export interface FlEntry { section: string; name: string; path: string; flag: string }
export interface HealthDeps { appsDir?: string; diagDirs?: string[]; flDbPath?: string; codesign?: boolean }

const isFl = (app: string) => /^(fl studio|fl64|osxfl)/i.test(app)

function run(cmd: string, args: string[], timeout = 20000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => resolve({ ok: !e, out: String(out), err: String(err) })))
}

// ---- crash reports ----

/** A macOS .ips report: one JSON header line, then a JSON body with threads and the images each frame points into. */
export function parseCrashReport(text: string): CrashReport | null {
  const nl = text.indexOf('\n')
  if (nl < 0) return null
  try {
    const body = JSON.parse(text.slice(nl + 1))
    if (typeof body.procName !== 'string' || !Array.isArray(body.usedImages) || !Array.isArray(body.threads)) return null
    const imgs: { path?: string; name?: string }[] = body.usedImages
    const at = (i: number) => imgs[i]?.path ?? imgs[i]?.name ?? ''
    const thread = body.threads.find((t: { triggered?: boolean }) => t.triggered) ?? body.threads[body.faultingThread ?? 0]
    const frames: { imageIndex?: number }[] = thread?.frames ?? []
    return { app: body.procName, crashedFrames: frames.map((f) => at(f.imageIndex ?? -1)).filter(Boolean), images: imgs.map((_, i) => at(i)).filter(Boolean) }
  } catch { return null }
}

const inside = (file: string, bundlePath: string) => file === bundlePath || file.startsWith(bundlePath + sep)

export function attributeCrash(report: CrashReport, plugins: PluginInfo[]): { pluginId: number; certainty: 'confirmed' | 'likely' }[] {
  if (!isFl(report.app)) return []
  const out: { pluginId: number; certainty: 'confirmed' | 'likely' }[] = []
  for (const p of plugins) {
    if (p.bundles.some((b) => report.crashedFrames.some((f) => inside(f, b.path)))) out.push({ pluginId: p.id, certainty: 'confirmed' })
    else if (p.bundles.some((b) => report.images.some((f) => inside(f, b.path)))) out.push({ pluginId: p.id, certainty: 'likely' })
  }
  return out
}

// ---- architecture and duplicates ----

/** flAccepted: files FL's own plugin list says it scanned fine. FL bridges Intel-only plugins, so those are not a problem. */
export function checkArch(plugin: PluginInfo, flArchs: string[], flAccepted: Set<string> = new Set()): FindingDraft | null {
  // Once FL's list is known it only records file paths for VST/VST3, so AU/AAX bundles can't be judged against it.
  const judgeable = (b: PluginBundle) => flAccepted.size === 0 || b.format === 'vst2' || b.format === 'vst3'
  const bad = plugin.bundles.find((b) => judgeable(b) && !flAccepted.has(b.path) && b.archs.length > 0 && !b.archs.some((a) => flArchs.includes(a)))
  if (!bad) return null
  return {
    pluginId: plugin.id, name: plugin.name, path: bad.path, kind: 'arch', severity: 'warn', certainty: 'likely', fix: 'disable',
    detail: `Built for ${bad.archs.join(' + ')} only, but FL runs as ${flArchs.join(' + ')}, and FL's plugin list doesn't show it as scanned OK. It may not load.`
  }
}

const vcmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

export function findDuplicates(plugins: PluginInfo[]): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const p of plugins) {
    const byFormat = new Map<string, PluginBundle[]>()
    for (const b of p.bundles) byFormat.set(b.format, [...(byFormat.get(b.format) ?? []), b])
    for (const [format, list] of byFormat) {
      if (list.length < 2) continue
      // Point at the older version; on a tie, the copy in the user's own Library.
      const worst = [...list].sort((a, b) => vcmp(a.version, b.version) || Number(b.path.startsWith('/Library')) - Number(a.path.startsWith('/Library')))[0]
      out.push({
        pluginId: p.id, name: p.name, path: worst.path, kind: 'duplicate', severity: 'warn', certainty: 'confirmed', fix: 'disable',
        detail: `${list.length} copies of the ${format.toUpperCase()} version are installed (${list.map((b) => `${b.path} v${b.version || '?'}`).join('; ')}). FL may load the wrong one.`
      })
    }
  }
  return out
}

// ---- bundle health ----

export function classifyCodesign(stderr: string): BundleDraft | null {
  const msg = stderr.trim()
  if (!msg || /detritus/i.test(msg)) return null // stray Finder metadata: not a reason for a plugin to fail loading
  if (/not signed at all/i.test(msg)) return { path: '', kind: 'signature', severity: 'warn', certainty: 'likely', fix: 'resign', detail: 'Not code-signed. Apple Silicon can refuse to load unsigned plugins; re-signing locally usually fixes it.' }
  return { path: '', kind: 'signature', severity: 'bad', certainty: 'likely', fix: 'resign', detail: `Signature is invalid or the plugin was modified after signing (${msg.split('\n')[0].replace(/^.*?: /, '')}). macOS may kill FL when it loads.` }
}

/** Only arm64 code needs a valid signature to load; Intel code runs under Rosetta without one. */
export async function checkBundle(b: PluginBundle, opts: { codesign?: boolean } = {}): Promise<BundleDraft[]> {
  const out: BundleDraft[] = []
  const broken = (detail: string) => out.push({ path: b.path, kind: 'broken-bundle', severity: 'bad', certainty: 'confirmed', fix: 'remove-bundle', detail })
  try {
    if (lstatSync(b.path).isSymbolicLink()) statSync(b.path)
  } catch { broken('The plugin is a link to something that no longer exists.'); return out }

  const plist = await run('plutil', ['-convert', 'json', '-o', '-', join(b.path, 'Contents', 'Info.plist')])
  if (!plist.ok) broken('Info.plist is missing or unreadable, so hosts cannot load it.')
  else {
    try {
      const exe = JSON.parse(plist.out).CFBundleExecutable
      if (typeof exe === 'string' && !existsSync(join(b.path, 'Contents', 'MacOS', exe))) broken(`The plugin's executable "${exe}" is missing.`)
    } catch { broken('Info.plist could not be read.') }
  }
  if ((await run('xattr', ['-p', 'com.apple.quarantine', b.path])).ok) {
    out.push({ path: b.path, kind: 'quarantine', severity: 'warn', certainty: 'likely', fix: 'unquarantine', detail: 'macOS still has this plugin quarantined (downloaded and never approved), which can make hosts fail to load it.' })
  }
  if (opts.codesign !== false && b.archs.includes('arm64') && !out.some((f) => f.kind === 'broken-bundle')) {
    const v = await run('codesign', ['--verify', '--deep', '--strict', b.path], 60000)
    if (!v.ok) { const c = classifyCodesign(v.err); if (c) out.push({ ...c, path: b.path }) }
  }
  return out
}

// ---- FL's own plugin list ----

/** FL keeps its plugin list in "Plugin database/Installed/.Plugins.ini": one [section] per plugin, with the file path and a scan flag for VST/VST3.
 *  Flag 1 = scanned fine. Flag 2 is undocumented. On one real machine it appeared on 11 plugins including both that were missing their executable,
 *  so it is reported as an unusual result worth a look, never as a verdict. */
export function parseFlPluginDb(text: string): FlEntry[] {
  const out: FlEntry[] = []
  let section = ''
  let name = ''
  let files: Record<string, string> = {}
  let flags: Record<string, string> = {}
  const flush = () => { for (const [i, path] of Object.entries(files)) out.push({ section, name: name || section.split('/').pop() || section, path, flag: flags[i] ?? '' }); files = {}; flags = {} }
  for (const raw of text.replace(/^\ufeff/, '').split(/\r?\n/)) {
    const line = raw.trim()
    const sec = /^\[(.+)\]$/.exec(line)
    if (sec) { flush(); section = sec[1]; name = ''; continue }
    const kv = /^([^=]+)=(.*)$/.exec(line)
    if (!kv) continue
    const file = /^ps_file_filename_(\d+)$/.exec(kv[1])
    const flag = /^ps_file_scanflags_(\d+)$/.exec(kv[1])
    if (kv[1] === 'ps_name') name = kv[2]
    else if (file && kv[2].startsWith('/')) files[file[1]] = kv[2]
    else if (flag) flags[flag[1]] = kv[2]
  }
  flush()
  return out
}

/** Files FL's plugin list says it scanned fine. */
export const flAcceptedPaths = (entries: FlEntry[]): Set<string> => new Set(entries.filter((e) => e.flag === '1').map((e) => e.path))

export function compareFlDatabase(entries: FlEntry[], plugins: PluginInfo[], exists: (p: string) => boolean = existsSync): FindingDraft[] {
  const out: FindingDraft[] = []
  // FL lists each plugin file once per kind (effect, generator), so report each file once.
  const byPath = new Map<string, FlEntry[]>()
  for (const e of entries) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e])
  for (const [path, list] of byPath) {
    const owner = plugins.find((p) => p.bundles.some((b) => b.path === path))
    const name = owner?.name ?? list[0].name
    if (!exists(path)) {
      if (path.startsWith('/Volumes/') && !exists(join('/Volumes', path.split('/')[2]))) continue // that drive is not connected right now
      out.push({
        pluginId: null, name, path, kind: 'stale-fl-db', severity: 'warn', certainty: 'confirmed', fix: 'clear-fl-entry',
        detail: `FL's plugin list still has "${name}", but ${path} no longer exists. That is what produces a "plugin not found" error.`
      })
    } else if (list.some((e) => e.flag === '2')) {
      out.push({
        pluginId: owner?.id ?? null, name, path, kind: 'fl-error', severity: 'warn', certainty: 'likely', fix: 'clear-fl-entry',
        detail: `FL recorded an unusual scan result for "${name}" in its plugin list (flag 2). We have seen it on plugins that failed to scan, but FL doesn't document it. Resetting FL's entry makes FL re-scan the plugin; if the problem comes back, disable the plugin.`
      })
    }
  }
  const known = new Set(entries.map((e) => e.path))
  for (const p of plugins) {
    const b = p.bundles.find((x) => (x.format === 'vst2' || x.format === 'vst3') && !known.has(x.path))
    if (!b) continue
    out.push({
      pluginId: p.id, name: p.name, path: b.path, kind: 'stale-fl-db', severity: 'warn', certainty: 'likely', fix: null,
      detail: `Installed, but not in FL's plugin list. In FL: Options > Manage plugins > Find installed plugins, then refresh.`
    })
  }
  return out
}

// ---- everything together ----

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}

async function flArchitectures(appsDir: string): Promise<string[] | null> {
  let app: string | undefined
  try { app = readdirSync(appsDir).filter((n) => /^FL Studio.*\.app$/.test(n)).sort().pop() } catch { return null }
  if (!app) return null
  const macos = join(appsDir, app, 'Contents', 'MacOS')
  let exe: string | undefined
  try { exe = readdirSync(macos)[0] } catch { return null }
  if (!exe) return null
  const r = await run('lipo', ['-archs', join(macos, exe)])
  const archs = r.out.trim().split(/\s+/).filter(Boolean)
  if (!archs.length) return null
  // A universal FL runs natively on this Mac unless it was set to open with Rosetta.
  return process.arch === 'arm64' && archs.includes('arm64') ? ['arm64'] : archs.includes('x86_64') && process.arch !== 'arm64' ? ['x86_64'] : archs
}

export async function runHealthChecks(db: Database.Database, home: string, deps: HealthDeps = {}): Promise<HealthFinding[]> {
  const plugins = listPlugins(db)
  const drafts: FindingDraft[] = []

  const flDb = deps.flDbPath ?? join(home, 'Documents/Image-Line/FL Studio/Presets/Plugin database/Installed/.Plugins.ini')
  let flEntries: FlEntry[] | null = null
  if (existsSync(flDb)) { try { flEntries = parseFlPluginDb(readFileSync(flDb, 'utf8')) } catch { /* unreadable: skip */ } }
  const accepted = flEntries ? flAcceptedPaths(flEntries) : new Set<string>()

  const flArchs = await flArchitectures(deps.appsDir ?? '/Applications')
  if (flArchs) for (const p of plugins) { const f = checkArch(p, flArchs, accepted); if (f) drafts.push(f) }

  const diagDirs = deps.diagDirs ?? [join(home, 'Library/Logs/DiagnosticReports'), join(home, 'Library/Logs/DiagnosticReports/Retired')]
  const reports: { file: string; mtime: number }[] = []
  for (const dir of diagDirs) {
    let names: string[] = []
    try { names = readdirSync(dir) } catch { continue }
    for (const n of names) if (/^fl.*\.ips$/i.test(n)) { try { reports.push({ file: join(dir, n), mtime: statSync(join(dir, n)).mtimeMs }) } catch { /* gone */ } }
  }
  // One finding per plugin, however many crash reports mention it.
  const seen = new Map<number, { confirmed: number; likely: number; latest: number }>()
  const recent = reports.sort((a, b) => b.mtime - a.mtime).slice(0, 20)
  for (const { file, mtime } of recent) {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { continue }
    const report = parseCrashReport(text)
    if (!report) continue
    for (const a of attributeCrash(report, plugins)) {
      const s = seen.get(a.pluginId) ?? { confirmed: 0, likely: 0, latest: 0 }
      s[a.certainty === 'confirmed' ? 'confirmed' : 'likely']++
      s.latest = Math.max(s.latest, mtime)
      seen.set(a.pluginId, s)
    }
  }
  for (const [id, s] of seen) {
    const p = plugins.find((x) => x.id === id)!
    const when = new Date(s.latest).toLocaleString()
    const n = (k: number) => `${k} FL Studio crash report${k === 1 ? '' : 's'}`
    drafts.push(s.confirmed > 0
      ? { pluginId: id, name: p.name, path: '', kind: 'crash', severity: 'bad', certainty: 'confirmed', fix: 'disable', detail: `FL Studio crashed while running this plugin (${n(s.confirmed)}; latest ${when}).` }
      : { pluginId: id, name: p.name, path: '', kind: 'crash', severity: 'warn', certainty: 'likely', fix: 'disable', detail: `This plugin was loaded in ${n(s.likely)} (latest ${when}). FL loads many plugins at once, so it may not be the cause.` })
  }

  drafts.push(...findDuplicates(plugins))

  const bundles = plugins.flatMap((p) => p.bundles.map((b) => ({ p, b })))
  // Signature checks are slow and only matter for plugins FL has not already scanned fine.
  const checked = await pool(bundles, 6, ({ b }) => checkBundle(b, { codesign: deps.codesign !== false && !accepted.has(b.path) }))
  checked.forEach((list, i) => { for (const d of list) drafts.push({ ...d, pluginId: bundles[i].p.id, name: bundles[i].p.name }) })

  if (flEntries) drafts.push(...compareFlDatabase(flEntries, plugins))

  return db.transaction(() => {
    db.prepare('DELETE FROM plugin_findings').run()
    const ins = db.prepare('INSERT INTO plugin_findings (plugin_id, name, path, kind, severity, detail, certainty, fix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    return drafts.map((d) => ({ ...d, id: Number(ins.run(d.pluginId, d.name, d.path, d.kind, d.severity, d.detail, d.certainty, d.fix).lastInsertRowid) }))
  })()
}

const toFinding = (r: Record<string, any>): HealthFinding => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: r.id, pluginId: r.plugin_id, name: r.name, path: r.path, kind: r.kind, severity: r.severity, detail: r.detail, certainty: r.certainty, fix: r.fix
})

export function listFindings(db: Database.Database): HealthFinding[] {
  return (db.prepare('SELECT * FROM plugin_findings ORDER BY id').all() as Record<string, any>[]).map(toFinding) // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function getFinding(db: Database.Database, id: number): HealthFinding | null {
  const r = db.prepare('SELECT * FROM plugin_findings WHERE id = ?').get(id) as Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any
  return r ? toFinding(r) : null
}
