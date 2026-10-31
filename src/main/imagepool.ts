// The producer's folder of video images: scanning, hashing, 16:9 framing and the thumbnail.
import type Database from 'better-sqlite3'
import { nativeImage } from 'electron'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { cropTo169, dHash, isDuplicate, pickNext, unusedCount, type PoolFile } from '../shared/imagePool'

const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const MIN_W = 640, MIN_H = 360
const THUMB_MAX_BYTES = 2 * 1024 * 1024

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export class ImagePool {
  private hashes = new Map<string, { mtime: number; hash: string | null }>()

  constructor(private db: Database.Database, private folder: () => string) {}

  private hashOf(path: string, mtime: number): string | null {
    const c = this.hashes.get(path)
    if (c && c.mtime === mtime) return c.hash
    let hash: string | null = null
    const img = nativeImage.createFromPath(path)
    const { width, height } = img.getSize()
    if (!img.isEmpty() && width >= MIN_W && height >= MIN_H) {
      const bgra = img.resize({ width: 9, height: 8, quality: 'good' }).toBitmap()
      const gray = new Uint8Array(72)
      for (let i = 0; i < 72; i++) gray[i] = Math.round(0.114 * bgra[i * 4] + 0.587 * bgra[i * 4 + 1] + 0.299 * bgra[i * 4 + 2])
      hash = dHash(gray)
    }
    this.hashes.set(path, { mtime, hash })
    return hash
  }

  private used(): string[] {
    return (this.db.prepare('SELECT hash FROM yt_images WHERE used_at IS NOT NULL').all() as Row[]).map((r) => r.hash)
  }

  private files(): PoolFile[] {
    const dir = this.folder()
    if (!dir) return []
    let names: string[]
    try { names = readdirSync(dir) } catch { return [] }
    const out: PoolFile[] = []
    for (const n of names) {
      if (n.startsWith('.') || !EXTS.has(extname(n).toLowerCase())) continue
      const path = join(dir, n)
      try {
        const st = statSync(path)
        if (!st.isFile() || st.size === 0) continue
        const hash = this.hashOf(path, st.mtimeMs)
        if (hash) out.push({ path, mtime: st.mtimeMs, hash })
      } catch { /* unreadable file: skip it */ }
    }
    return out
  }

  /** The next unused picture and how many remain. Junk, tiny or unreadable files are ignored. */
  scan(): { next: { path: string; hash: string } | null; unused: number; total: number } {
    const files = this.files()
    const used = this.used()
    return { next: pickNext(files, used), unused: unusedCount(files, used), total: files.length }
  }

  /** Writes the 16:9 video frame (1920x1080) and the thumbnail (1280x720, at most 2 MB). */
  prepare(path: string, outDir: string): { framePath: string; thumbPath: string } {
    const src = nativeImage.createFromPath(path)
    if (src.isEmpty()) throw new Error('That image could not be read.')
    const { width, height } = src.getSize()
    const full = src.crop(cropTo169(width, height))
    mkdirSync(outDir, { recursive: true })
    const stem = `yt-${Date.now()}`
    const framePath = join(outDir, `${stem}-frame.jpg`)
    const thumbPath = join(outDir, `${stem}-thumb.jpg`)
    writeFileSync(framePath, full.resize({ width: 1920, height: 1080, quality: 'best' }).toJPEG(95))
    const thumb = full.resize({ width: 1280, height: 720, quality: 'best' })
    let jpeg = thumb.toJPEG(92)
    for (let q = 85; jpeg.length > THUMB_MAX_BYTES && q >= 40; q -= 10) jpeg = thumb.toJPEG(q)
    writeFileSync(thumbPath, jpeg)
    return { framePath, thumbPath }
  }

  /** True when this picture, or a copy of it, has already been used for an upload. */
  isUsed(hash: string): boolean { return isDuplicate(hash, this.used()) }

  markUsed(hash: string, path: string, beatId: number): void {
    this.db.prepare('INSERT INTO yt_images(hash,path,beat_id,used_at) VALUES(?,?,?,?) ON CONFLICT(hash) DO UPDATE SET path=excluded.path, beat_id=excluded.beat_id, used_at=excluded.used_at').run(hash, path, beatId, Date.now())
  }
}
