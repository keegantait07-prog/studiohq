import chokidar, { type FSWatcher } from 'chokidar'
import { extname, sep } from 'path'
import { existsSync } from 'fs'
import type { Store } from './store'
import type { VaultKind } from '../shared/types'

const AUDIO = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aif', '.aiff', '.ogg'])

/** Watches one vault's folders: beats from `watchFolders`, loops from `loopFolders`. */
export class Watcher {
  private fw: FSWatcher | null = null
  constructor(private store: Store, private kind: VaultKind = 'beat') {}

  async restart(): Promise<void> {
    await this.fw?.close()
    this.fw = null
    const s = this.store.getSettings()
    const roots = (this.kind === 'loop' ? s.loopFolders : s.watchFolders).filter((f) => existsSync(f))
    if (this.kind === 'beat') this.store.refreshProjects()
    if (!roots.length) return
    const seen = new Set<string>()
    const rootOf = (p: string) => roots.find((r) => p.startsWith(r + sep)) ?? roots[0]

    this.fw = chokidar.watch(roots, {
      alwaysStat: true,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 },
      ignored: (p, stats) => {
        const segs = p.split(sep)
        if (segs.some((x) => x.startsWith('.') && x.length > 1)) return true
        if (segs.includes('Backup') || segs.includes('__MACOSX')) return true
        if (!s.includeIdeas && segs.some((x) => /idea|scrap/i.test(x) && !roots.includes(p))) return true
        return !!stats?.isFile() && !AUDIO.has(extname(p).toLowerCase())
      }
    })
    const save = (p: string, st: { size: number; mtimeMs: number }) => {
      try { this.store.upsertFile(p, st.size, st.mtimeMs, rootOf(p), this.kind) } catch (e) { console.error('import failed', p, e) }
    }
    // The first scan is held until the whole tree is known. A file renamed while the app was closed can only be
    // matched to its old row once that row is marked missing, or its tags and status would stay behind.
    let scanned = false
    const firstScan: [string, { size: number; mtimeMs: number }][] = []
    const onFile = (p: string, st?: { size: number; mtimeMs: number }) => {
      if (!st || !AUDIO.has(extname(p).toLowerCase())) return
      seen.add(p)
      if (scanned) save(p, st)
      else firstScan.push([p, st])
    }
    this.fw.on('add', onFile).on('change', onFile)
    this.fw.on('unlink', (p) => this.store.markMissing(p))
    this.fw.on('ready', () => {
      scanned = true
      this.store.markUnseenMissing(roots, seen, this.kind)
      for (const [p, st] of firstScan) save(p, st)
      firstScan.length = 0
      this.store.relinkProjects()
    })
  }

  async close(): Promise<void> {
    await this.fw?.close()
  }
}
