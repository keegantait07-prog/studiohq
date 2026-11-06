// The public SMALLS beat site: a catalog page built from beats you send to it, published to its own Netlify site.
import type Database from 'better-sqlite3'
import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import pageTemplate from './catalog-page.html?raw'
import { CATALOG_SEED } from './catalog-seed'
import { call, deployDir } from './netlify'
import type { SiteEntry, SitePatch, SiteStatus } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ffmpeg = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked')
const PREVIEW = 45
const NEW_DAYS = 45
const DEFAULT_STORE = 'https://www.beatstars.com/smallsmadethis'
const GENRES: Record<string, string> = { trap: 'Trap', jersey: 'Jersey Club', 'jersey club': 'Jersey Club', afro: 'Afro', ambient: 'Ambient', ambience: 'Ambient', dnb: 'Drum & Bass', 'drum & bass': 'Drum & Bass', latin: 'Latin', opium: 'Opium', experimental: 'Experimental', hyperpop: 'Hyperpop', "2000's": '2000s', '2000s': '2000s', drill: 'Drill', rnb: 'R&B', 'r&b': 'R&B' }
const FLAT: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }

export function siteTitle(t: string): string {
  let s = t.replace(/\[\s*\]/g, '').replace(/\(.*?\)/g, '').replace(/@\S+/g, '').trim()
  s = s.replace(/\s+\d{2,3}$/, '').replace(/\s+[A-G][#b]?m$/, '').replace(/^\d+\s+/, '').replace(/\s{2,}/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : t
}
function shortKey(k: string | null): string {
  const m = (k ?? '').trim().match(/^([A-G][b#]?)\s*(major|minor|maj|min|m)?/i)
  if (!m) return k || 'C'
  const n = FLAT[m[1]] ?? m[1]
  return n + (m[2] && /^(minor|min|m)$/i.test(m[2]) ? 'm' : '')
}
const monthLabel = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

function run(args: string[], capture = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args)
    const out: Buffer[] = []; let err = ''
    p.stdout.on('data', (c) => capture && out.push(c))
    p.stderr.on('data', (c) => (err += c))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split('\n').pop() || 'ffmpeg failed'))))
  })
}

export class Catalog {
  readonly dir = join(app.getPath('userData'), 'beat-site')
  private cache = join(app.getPath('userData'), 'beat-site-cache')
  private busy: Promise<unknown> = Promise.resolve()

  constructor(private db: Database.Database, private token: () => string | null, private storeUrl: () => string, private ownHandles: () => string[]) {
    db.exec(`CREATE TABLE IF NOT EXISTS site_beats (
      beat_id INTEGER PRIMARY KEY REFERENCES beats(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      genre TEXT NOT NULL DEFAULT '',
      co TEXT NOT NULL DEFAULT '[]',
      link TEXT NOT NULL DEFAULT '',
      position REAL NOT NULL,
      added_at INTEGER NOT NULL DEFAULT 0,
      peaks TEXT,
      preview_key TEXT
    )`)
    mkdirSync(join(this.dir, 'audio'), { recursive: true })
    mkdirSync(this.cache, { recursive: true })
    this.seed()
  }

  private kv(key: string): string | null { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined)?.value ?? null }
  private setKv(key: string, v: string): void { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, v) }

  private seed(): void {
    if (this.kv('site_seeded')) return
    const ins = this.db.prepare('INSERT OR IGNORE INTO site_beats(beat_id,title,genre,co,link,position,added_at) VALUES(?,?,?,?,?,?,?)')
    const has = this.db.prepare('SELECT 1 FROM beats WHERE id=?')
    this.db.transaction(() => { for (const s of CATALOG_SEED) if (has.get(s.id)) ins.run(s.id, s.title, s.genre, JSON.stringify(s.co), s.link, s.position, s.addedAt) })()
    this.setKv('site_seeded', '1')
  }

  status(): SiteStatus {
    const entries = (this.db.prepare('SELECT * FROM site_beats ORDER BY position').all() as Row[]).map((r): SiteEntry => ({ beatId: r.beat_id, title: r.title, genre: r.genre, co: JSON.parse(r.co), link: r.link, addedAt: r.added_at }))
    return { url: this.kv('site_url'), hasToken: !!this.token(), entries, pending: this.kv('site_dirty') === '1' }
  }

  private defaults(beatId: number): { title: string; genre: string; co: string[] } {
    const b = this.db.prepare('SELECT * FROM beats WHERE id=?').get(beatId) as Row | undefined
    if (!b) throw new Error('That beat no longer exists.')
    if (b.ext === 'flp') throw new Error('Export a bounce of this beat first. The site needs audio.')
    const tags = (this.db.prepare("SELECT value FROM tags WHERE beat_id=? AND kind='genre'").all(beatId) as Row[]).map((t) => String(t.value).toLowerCase())
    const own = this.ownHandles().map((h) => h.toLowerCase())
    const co = String(b.credits || '').split(/\s+/).map((c) => c.replace(/^@/, '')).filter((c) => c && !own.includes(c.toLowerCase()) && c.toLowerCase() !== 'small')
    return { title: siteTitle(b.title), genre: tags.map((t) => GENRES[t]).find(Boolean) ?? '', co }
  }

  /** Puts a beat on the site (newest at the top) and publishes. */
  add(beatId: number, onStep?: (s: string) => void): Promise<string> {
    if (!this.db.prepare('SELECT 1 FROM site_beats WHERE beat_id=?').get(beatId)) {
      const d = this.defaults(beatId)
      const min = (this.db.prepare('SELECT MIN(position) m FROM site_beats').get() as Row).m ?? 0
      this.db.prepare('INSERT INTO site_beats(beat_id,title,genre,co,link,position,added_at) VALUES(?,?,?,?,?,?,?)').run(beatId, d.title, d.genre, JSON.stringify(d.co), '', min - 1, Date.now())
    }
    return this.publish(onStep)
  }
  update(beatId: number, p: SitePatch): void {
    const sets: string[] = []; const vals: unknown[] = []
    if (p.title != null) { sets.push('title=?'); vals.push(p.title.trim() || siteTitle(String((this.db.prepare('SELECT title FROM beats WHERE id=?').get(beatId) as Row)?.title ?? ''))) }
    if (p.genre != null) { sets.push('genre=?'); vals.push(p.genre.trim()) }
    if (p.link != null) { sets.push('link=?'); vals.push(p.link.trim()) }
    if (p.co != null) { sets.push('co=?'); vals.push(JSON.stringify(p.co)) }
    if (!sets.length) return
    this.db.prepare(`UPDATE site_beats SET ${sets.join(',')} WHERE beat_id=?`).run(...vals, beatId)
    this.setKv('site_dirty', '1')
  }
  remove(beatId: number, onStep?: (s: string) => void): Promise<string> {
    this.db.prepare('DELETE FROM site_beats WHERE beat_id=?').run(beatId)
    return this.publish(onStep)
  }

  /** Makes a 45-second preview from the loudest stretch of the beat and the 80-point trace the page draws. */
  private async preview(b: Row): Promise<{ file: string; peaks: number[] }> {
    const file = join(this.cache, `${b.id}-${Math.floor(b.mtime)}.mp3`)
    if (!existsSync(file)) {
      const env: number[] = b.peaks ? JSON.parse(b.peaks) : []
      const dur: number = b.duration ?? 0
      let start = 0
      if (env.length && dur > PREVIEW) {
        const win = Math.max(1, Math.floor((env.length * PREVIEW) / dur))
        let s = env.slice(0, win).reduce((a, c) => a + c, 0), best = s
        for (let i = 1; i + win <= env.length; i++) { s += env[i + win - 1] - env[i - 1]; if (s > best) { best = s; start = (i * dur) / env.length } }
      }
      const len = Math.min(PREVIEW, dur || PREVIEW)
      await run(['-v', 'error', '-y', '-ss', start.toFixed(2), '-t', String(len), '-i', b.path, '-vn', '-map_metadata', '-1',
        '-af', `afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, len - 1.5)}:d=1.5`, '-ac', '2', '-b:a', '128k', file])
    }
    const raw = await run(['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], true)
    const n = Math.floor(raw.length / 2), N = 80, size = Math.max(1, Math.floor(n / N)), pk: number[] = []
    for (let i = 0; i < N; i++) { let m = 0; for (let j = i * size; j < Math.min(n, (i + 1) * size); j++) { const v = Math.abs(raw.readInt16LE(j * 2)); if (v > m) m = v } pk.push(m) }
    const top = Math.max(...pk) || 1
    return { file, peaks: pk.map((v) => Math.round((v / top) * 100) / 100) }
  }

  /** Rebuilds the whole site folder and deploys it. Runs one at a time. */
  publish(onStep?: (s: string) => void): Promise<string> {
    const job = this.busy.then(() => this.doPublish(onStep))
    this.busy = job.catch(() => undefined)
    return job
  }
  private async doPublish(onStep?: (s: string) => void): Promise<string> {
    const token = this.token()
    if (!token) throw new Error('Add your Netlify token in Settings first, so Studio HQ can publish the site.')
    const rows = this.db.prepare('SELECT s.*, b.path, b.mtime, b.duration, b.bpm, b.key, b.peaks AS env, b.missing FROM site_beats s JOIN beats b ON b.id=s.beat_id WHERE NOT EXISTS (SELECT 1 FROM sales x WHERE x.group_id=b.group_id AND x.exclusive=1) ORDER BY s.position').all() as Row[] // an exclusively sold beat comes off the site
    const now = Date.now(), beats: Row[] = [], keep = new Set<string>()
    let i = 0
    for (const r of rows) {
      if (r.missing) continue
      onStep?.(`Preparing ${++i}/${rows.length}: ${r.title}`)
      const { file, peaks } = await this.preview({ id: r.beat_id, path: r.path, mtime: r.mtime, duration: r.duration, peaks: r.env })
      const name = `${r.beat_id}.mp3`; keep.add(name)
      copyFileSync(file, join(this.dir, 'audio', name))
      const isNew = r.added_at && now - r.added_at < NEW_DAYS * 864e5
      const b: Row = { id: r.beat_id, no: beats.length + 1, title: r.title, genre: r.genre, drop: isNew ? monthLabel(r.added_at) : '', bpm: Math.round(r.bpm || 120), key: shortKey(r.key), co: JSON.parse(r.co), peaks }
      if (r.link) b.link = r.link
      beats.push(b)
    }
    for (const f of readdirSync(join(this.dir, 'audio'))) if (!keep.has(f)) rmSync(join(this.dir, 'audio', f), { force: true })
    const data = JSON.stringify({ store: this.storeUrl() || DEFAULT_STORE, beats }).replace(/</g, '\\u003c')
    writeFileSync(join(this.dir, 'index.html'), pageTemplate.split('__DATA__').join(data))
    let siteId = this.kv('site_id')
    if (!siteId) {
      onStep?.('Creating your beat site on Netlify')
      let site: Row | null = null
      for (const name of ['smalls-beats', 'smallsmadethis', 'smalls-beat-catalogue']) {
        try { site = await (await call(token, '/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json(); break } catch { /* name taken, try the next */ }
      }
      if (!site) site = await (await call(token, '/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
      siteId = String(site!.id)
      this.setKv('site_id', siteId)
    }
    const r = await deployDir(this.dir, token, siteId, onStep)
    this.setKv('site_url', r.baseUrl)
    this.setKv('site_dirty', '0')
    return r.baseUrl
  }
}
