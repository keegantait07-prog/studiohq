import type Database from 'better-sqlite3'
import { call } from './netlify'
import type { FeedbackComment, FeedbackData, FeedbackLink } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const FORM = 'studio-hq-feedback'

export class Feedback {
  constructor(private db: Database.Database, private token: () => string | null, private siteId: () => string | null) {}

  all(): FeedbackData {
    const links = (this.db.prepare(`SELECT id,slug,title,url,created_at,deployed_at FROM packs WHERE kind='feedback' ORDER BY created_at DESC`).all() as Row[]).map((p): FeedbackLink => ({
      id: p.id, slug: p.slug, title: p.title, url: p.url, createdAt: p.created_at, deployedAt: p.deployed_at,
      beats: (this.db.prepare(`SELECT b.id beatId, b.title, b.duration FROM pack_beats pb JOIN beats b ON b.id=pb.beat_id WHERE pb.pack_id=? ORDER BY pb.position`).all(p.id) as Row[]).map((b) => ({ beatId: b.beatId, title: b.title, duration: b.duration }))
    }))
    const byLink = new Map(links.map((l) => [l.slug, l]))
    const comments = (this.db.prepare('SELECT * FROM feedback_comments ORDER BY created_at DESC').all() as Row[]).filter((c) => byLink.has(c.slug)).map((c): FeedbackComment => ({
      id: c.id, slug: c.slug, beatId: byLink.get(c.slug)?.beats[c.beat_index]?.beatId ?? null, beatIndex: c.beat_index, name: c.name, time: c.time, text: c.text,
      createdAt: c.created_at, seen: !!c.seen, resolved: !!c.resolved
    }))
    return { links, comments }
  }

  hasPublished(): boolean {
    return !!this.db.prepare(`SELECT 1 FROM packs WHERE kind='feedback' AND url IS NOT NULL LIMIT 1`).get()
  }

  /** Pulls new comments from the site's Netlify Form. Safe to call repeatedly. */
  async sync(): Promise<{ added: number; error: string | null }> {
    const token = this.token(), site = this.siteId()
    if (!token || !site) return { added: 0, error: 'Add your Netlify token in Settings and publish a feedback link first.' }
    try {
      const forms = await (await call(token, `/sites/${site}/forms`)).json() as { id: string; name: string }[]
      const form = forms.find((f) => f.name === FORM)
      if (!form) return { added: 0, error: null } // Netlify only creates the form after the first deploy that contains it, and lists it once a comment arrives
      const ins = this.db.prepare('INSERT OR IGNORE INTO feedback_comments(id,slug,beat_index,name,time,text,created_at) VALUES(?,?,?,?,?,?,?)')
      let added = 0
      for (let page = 1; page <= 20; page++) {
        const subs = await (await call(token, `/forms/${form.id}/submissions?per_page=100&page=${page}`)).json() as Row[]
        this.db.transaction(() => {
          for (const s of subs) {
            const d = (s.data ?? {}) as Record<string, string>
            const text = String(d.comment ?? s.body ?? '').trim()
            if (!text || !d.link) continue
            const r = ins.run(String(s.id), String(d.link), Math.max(0, parseInt(d.beat ?? '0', 10) || 0), String(d.name ?? s.name ?? '').slice(0, 80), Math.max(0, parseFloat(d.time ?? '0') || 0), text.slice(0, 2000), Date.parse(s.created_at) || Date.now())
            added += r.changes
          }
        })()
        if (subs.length < 100) break
      }
      return { added, error: null }
    } catch (e) {
      return { added: 0, error: (e as Error).message }
    }
  }

  update(id: string, p: { seen?: boolean; resolved?: boolean }): void {
    if (p.seen !== undefined) this.db.prepare('UPDATE feedback_comments SET seen=? WHERE id=?').run(p.seen ? 1 : 0, id)
    if (p.resolved !== undefined) this.db.prepare('UPDATE feedback_comments SET resolved=? WHERE id=?').run(p.resolved ? 1 : 0, id)
  }
  markAllSeen(): void {
    this.db.prepare('UPDATE feedback_comments SET seen=1').run()
  }
}
