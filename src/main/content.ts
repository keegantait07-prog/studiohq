import type Database from 'better-sqlite3'
import type { ContentData, Post, VideoExport } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export class Content {
  constructor(private db: Database.Database) {}

  all(): ContentData {
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
}
