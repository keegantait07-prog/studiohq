import type Database from 'better-sqlite3'
import { app, safeStorage } from 'electron'
import { randomBytes } from 'crypto'
import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import { renderPage } from './pitch-page'
import { deployDir } from './netlify'
import type { NetlifyStatus, PackRequest, PackResult } from '../shared/types'

export interface BuildOpts { kind?: 'pitch' | 'feedback' }

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ffmpeg = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked')

export class Packs {
  readonly siteDir = join(app.getPath('userData'), 'pitch-site')
  private cacheDir = join(app.getPath('userData'), 'pitch-cache')

  constructor(private db: Database.Database, private producer: () => string) {
    mkdirSync(this.siteDir, { recursive: true })
    mkdirSync(this.cacheDir, { recursive: true })
    writeFileSync(join(this.siteDir, 'index.html'), '<!doctype html><meta name="robots" content="noindex"><title></title>')
    writeFileSync(join(this.siteDir, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: no-referrer\n')
  }

  // ---- token (encrypted with the macOS Keychain via Electron safeStorage) ----
  private kv(key: string): string | null {
    return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined)?.value ?? null
  }
  private setKv(key: string, v: string | null): void {
    if (v == null) this.db.prepare('DELETE FROM settings WHERE key=?').run(key)
    else this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, v)
  }
  status(): NetlifyStatus {
    return { hasToken: !!(process.env.SHQ_TEST_NETLIFY_TOKEN ?? this.kv('netlify_token')), siteUrl: this.kv('netlify_site_url'), encryptionOk: safeStorage.isEncryptionAvailable() }
  }
  setToken(token: string | null): void {
    if (!token?.trim()) return this.setKv('netlify_token', null)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available, so the token was not saved.')
    this.setKv('netlify_token', safeStorage.encryptString(token.trim()).toString('base64'))
  }
  private token(): string | null {
    if (process.env.SHQ_TEST_NETLIFY_TOKEN) return process.env.SHQ_TEST_NETLIFY_TOKEN // test hook only
    const v = this.kv('netlify_token')
    return v ? safeStorage.decryptString(Buffer.from(v, 'base64')) : null
  }

  // ---- building ----
  private previewMp3(beat: Row): Promise<string> {
    const out = join(this.cacheDir, `${beat.id}-${Math.floor(beat.mtime)}.mp3`)
    if (existsSync(out)) return Promise.resolve(out)
    return new Promise((resolve, reject) => {
      const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', beat.path, '-vn', '-map_metadata', '-1', '-ac', '2', '-b:a', '128k', out])
      let err = ''
      p.stderr.on('data', (c) => (err += c))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`Could not make a preview of "${beat.title}": ${err.trim()}`))))
    })
  }

  token_(): string | null { return this.token() }
  siteId(): string | null { return this.kv('netlify_site_id') }

  async build(req: PackRequest, opts: BuildOpts = {}): Promise<PackResult> {
    if (!req.beatIds.length) throw new Error('Pick at least one beat.')
    const beats = req.beatIds.map((id) => this.db.prepare('SELECT * FROM beats WHERE id=?').get(id) as Row).filter(Boolean)
    if ((opts.kind ?? 'pitch') === 'pitch') {
      const sold = beats.find((b) => this.db.prepare('SELECT 1 FROM sales WHERE group_id=? AND exclusive=1').get(b.group_id))
      if (sold) throw new Error(`"${sold.title}" was sold exclusively, so it can't go in a pitch.`)
    }
    const slug = randomBytes(8).toString('base64url')
    const dir = join(this.siteDir, 'p', slug)
    mkdirSync(dir, { recursive: true })
    try {
      const tracks = []
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i]
        const mp3 = await this.previewMp3(b)
        const file = `${String(i + 1).padStart(2, '0')}.mp3`
        copyFileSync(mp3, join(dir, file))
        tracks.push({ title: b.title, file, bpm: b.bpm, key: b.key, duration: b.duration, peaks: b.peaks ? JSON.parse(b.peaks) : [] })
      }
      writeFileSync(join(dir, 'index.html'), renderPage({ title: req.title, intro: req.intro, producer: this.producer() || 'Producer', tracks, feedback: opts.kind === 'feedback' ? { slug } : undefined }))
    } catch (e) {
      rmSync(dir, { recursive: true, force: true })
      throw e
    }

    const packId = Number(this.db.prepare('INSERT INTO packs(slug,title,intro,contact_id,created_at,kind) VALUES(?,?,?,?,?,?)').run(slug, req.title, req.intro, req.contactId, Date.now(), opts.kind ?? 'pitch').lastInsertRowid)
    const ins = this.db.prepare('INSERT INTO pack_beats(pack_id,beat_id,position) VALUES(?,?,?)')
    beats.forEach((b, i) => ins.run(packId, b.id, i))

    let url: string | null = null
    let deployError: string | null = null
    if (req.deploy) {
      try { url = await this.deploy(packId) } catch (e) { deployError = (e as Error).message }
    }
    return { packId, slug, url, deployError }
  }

  /** Publishes the whole pitch-site folder, so every existing pack stays online. */
  async deploy(packId: number): Promise<string> {
    const token = this.token()
    if (!token) throw new Error('No Netlify token yet. Add one in Settings to publish pages.')
    const pack = this.db.prepare('SELECT slug FROM packs WHERE id=?').get(packId) as Row
    const r = await deployDir(this.siteDir, token, this.kv('netlify_site_id'))
    this.setKv('netlify_site_id', r.siteId)
    this.setKv('netlify_site_url', r.baseUrl)
    const url = `${r.baseUrl}/p/${pack.slug}/`
    this.db.prepare('UPDATE packs SET url=?, deployed_at=? WHERE id=?').run(url, Date.now(), packId)
    return url
  }

  localIndex(packId: number): string | null {
    const p = this.db.prepare('SELECT slug FROM packs WHERE id=?').get(packId) as Row | undefined
    return p ? join(this.siteDir, 'p', p.slug, 'index.html') : null
  }
}
