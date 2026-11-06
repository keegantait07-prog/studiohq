import type Database from 'better-sqlite3'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { fileSafeTitle, youtubeFileTitle } from '../shared/videoFiles'
import type { YtPublishResult } from '../shared/ytTypes'
import type { ContentData, Post, VideoExport, VideoFile } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export class Content {
  constructor(private db: Database.Database) {}

  all(): ContentData {
    // a scheduled upload has a link and goes live on its date, so it isn't overdue
    this.db.prepare(`UPDATE posts SET status='posted' WHERE status='planned' AND url!='' AND date<=?`).run(Date.now())
    const posts = (this.db.prepare('SELECT * FROM posts ORDER BY date DESC, id DESC').all() as Row[]).map((r): Post => ({
      id: r.id, beatId: r.beat_id, platform: r.platform, status: r.status, date: r.date, url: r.url, caption: r.caption
    }))
    const videos = (this.db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all() as Row[]).map((r): VideoExport => ({
      id: r.id, beatId: r.beat_id, format: r.format, path: r.path, createdAt: r.created_at
    }))
    return { posts, videos }
  }

  savePost(p: Partial<Post> & Pick<Post, 'beatId' | 'platform' | 'status' | 'date'>): number {
    if (p.id) {
      this.db.prepare('UPDATE posts SET beat_id=?, platform=?, status=?, date=?, url=?, caption=? WHERE id=?').run(p.beatId, p.platform, p.status, p.date, p.url ?? '', p.caption ?? '', p.id)
      return p.id
    }
    return Number(this.db.prepare('INSERT INTO posts(beat_id,platform,status,date,url,caption,created_at) VALUES(?,?,?,?,?,?,?)').run(p.beatId, p.platform, p.status, p.date, p.url ?? '', p.caption ?? '', Date.now()).lastInsertRowid)
  }
  deletePost(id: number): void {
    this.db.prepare('DELETE FROM posts WHERE id=?').run(id)
  }

  /** YouTube exports made before they were recorded: match "<title> - YouTube.mp4" files in the export folder to their beat. */
  private adoptYoutubeFiles(dir: string): void {
    let names: string[]
    try { names = readdirSync(dir) } catch { return }
    const known = new Set((this.db.prepare('SELECT path FROM videos').all() as Row[]).map((r) => r.path))
    const beats = this.db.prepare("SELECT id, title FROM beats WHERE missing=0 AND kind='beat'").all() as Row[]
    for (const n of names) {
      const t = youtubeFileTitle(n)
      const path = join(dir, n)
      if (!t || known.has(path)) continue
      const beat = beats.find((b) => fileSafeTitle(b.title) === t)
      if (beat) this.db.prepare('INSERT INTO videos(beat_id,format,path,created_at) VALUES(?,?,?,?)').run(beat.id, 'youtube', path, statSync(path).mtimeMs)
    }
  }

  /** Every recorded video with its size and whether the file is still there, newest first. */
  videoFiles(exportDir: string): VideoFile[] {
    this.adoptYoutubeFiles(exportDir)
    const rows = this.db.prepare('SELECT v.*, b.title AS beat_title FROM videos v LEFT JOIN beats b ON b.id=v.beat_id ORDER BY v.created_at DESC, v.id DESC').all() as Row[]
    const drafts = new Map((this.db.prepare('SELECT video_id, json FROM yt_drafts').all() as Row[]).map((d) => [d.video_id as number, (JSON.parse(d.json) as { uploaded: YtPublishResult | null }).uploaded]))
    return rows.map((r): VideoFile => {
      const exists = existsSync(r.path)
      return { id: r.id, beatId: r.beat_id, beatTitle: r.beat_title ?? 'Unknown beat', format: r.format, path: r.path, createdAt: r.created_at, size: exists ? statSync(r.path).size : 0, exists, ...(r.format === 'youtube' ? { youtube: { hasDraft: drafts.has(r.id), uploaded: drafts.get(r.id) ?? null } } : {}) }
    })
  }
  videoPath(id: number): string | null {
    return (this.db.prepare('SELECT path FROM videos WHERE id=?').get(id) as Row | undefined)?.path ?? null
  }
  forgetVideo(id: number): void {
    this.db.prepare('DELETE FROM videos WHERE id=?').run(id)
  }
}
