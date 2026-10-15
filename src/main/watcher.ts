import chokidar, { type FSWatcher } from 'chokidar'
import { extname, sep } from 'path'
import { existsSync } from 'fs'
import type { Store } from './store'

const AUDIO = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aif', '.aiff', '.ogg'])

export class Watcher {
  private fw: FSWatcher | null = null
  constructor(private store: Store) {}

  async restart(): Promise<void> {
    await this.fw?.close()
    this.fw = null
    const s = this.store.getSettings()
    const roots = s.watchFolders.filter((f) => existsSync(f))
    this.store.refreshProjects()
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
    const onFile = (p: string, st?: { size: number; mtimeMs: number }) => {
      if (!st || !AUDIO.has(extname(p).toLowerCase())) return
      seen.add(p)
      try { this.store.upsertFile(p, st.size, st.mtimeMs, rootOf(p)) } catch (e) { console.error('import failed', p, e) }
    }
    this.fw.on('add', onFile).on('change', onFile)
    this.fw.on('unlink', (p) => this.store.markMissing(p))
    this.fw.on('ready', () => {
      this.store.markUnseenMissing(roots, seen)
      this.store.relinkProjects()
    })
  }

  async close(): Promise<void> {
    await this.fw?.close()
  }
}
