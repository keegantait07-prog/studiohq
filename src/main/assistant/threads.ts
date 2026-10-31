import type Database from 'better-sqlite3'
import type { ThreadDetail, ThreadMessage, ThreadSummary } from '../../shared/types'

const TITLE_LEN = 40

/** Chat threads with the assistant, stored as one JSON message list per row. */
export class Threads {
  constructor(private db: Database.Database) {}

  list(): ThreadSummary[] {
    const rows = this.db.prepare('SELECT id, title, updated_at FROM assistant_threads ORDER BY updated_at DESC, id DESC').all() as { id: number; title: string; updated_at: number }[]
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }))
  }

  get(id: number): ThreadDetail | null {
    const r = this.db.prepare('SELECT id, title, messages, updated_at FROM assistant_threads WHERE id=?').get(id) as { id: number; title: string; messages: string; updated_at: number } | undefined
    if (!r) return null
    return { id: r.id, title: r.title, updatedAt: r.updated_at, messages: JSON.parse(r.messages) as ThreadMessage[] }
  }

  create(): number {
    const now = Date.now()
    return Number(this.db.prepare('INSERT INTO assistant_threads(created_at, updated_at) VALUES(?, ?)').run(now, now).lastInsertRowid)
  }

  append(id: number, m: ThreadMessage): void {
    this.update(id, (msgs) => { msgs.push(m) })
  }

  /** Rewrites the message list in place (e.g. to mark a tool call as failed). */
  update(id: number, fn: (messages: ThreadMessage[]) => void): void {
    const r = this.db.prepare('SELECT title, messages FROM assistant_threads WHERE id=?').get(id) as { title: string; messages: string } | undefined
    if (!r) return
    const msgs = JSON.parse(r.messages) as ThreadMessage[]
    const hadUser = msgs.some((x) => x.role === 'user')
    fn(msgs)
    let title = r.title
    if (!hadUser) {
      const first = msgs.find((x) => x.role === 'user')
      if (first && first.role === 'user') title = Array.from(first.text.trim()).slice(0, TITLE_LEN).join('') || title
    }
    this.db.prepare('UPDATE assistant_threads SET messages=?, title=?, updated_at=? WHERE id=?').run(JSON.stringify(msgs), title, Date.now(), id)
  }

  sessionId(id: number): string | null {
    const r = this.db.prepare('SELECT cli_session_id FROM assistant_threads WHERE id=?').get(id) as { cli_session_id: string | null } | undefined
    return r?.cli_session_id ?? null
  }

  setSessionId(id: number, s: string | null): void {
    this.db.prepare('UPDATE assistant_threads SET cli_session_id=? WHERE id=?').run(s, id)
  }

  setTitle(id: number, t: string): void {
    this.db.prepare('UPDATE assistant_threads SET title=? WHERE id=?').run(t, id)
  }
}
