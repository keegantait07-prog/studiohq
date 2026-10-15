import type Database from 'better-sqlite3'
import { execFile } from 'child_process'
import type { StudioSession } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const MIN = 60000

export class Sessions {
  private flMisses = 0
  constructor(private db: Database.Database) {}

  all(): StudioSession[] {
    return (this.db.prepare('SELECT * FROM studio_sessions ORDER BY started_at DESC LIMIT 2000').all() as Row[]).map((r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at, auto: !!r.auto }))
  }
  private open(): Row | undefined {
    return this.db.prepare('SELECT * FROM studio_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').get() as Row | undefined
  }
  start(auto = false): void {
    if (!this.open()) this.db.prepare('INSERT INTO studio_sessions(started_at,auto) VALUES(?,?)').run(Date.now(), auto ? 1 : 0)
  }
  stop(): void {
    const o = this.open()
    if (!o) return
    const now = Date.now()
    // anything under a minute is a mis-click, not a session
    if (now - o.started_at < MIN) this.db.prepare('DELETE FROM studio_sessions WHERE id=?').run(o.id)
    else this.db.prepare('UPDATE studio_sessions SET ended_at=? WHERE id=?').run(now, o.id)
  }

  private flRunning(): Promise<boolean> {
    return new Promise((res) => execFile('pgrep', ['-f', 'Contents/MacOS/OsxFL'], (err) => res(!err)))
  }
  /** Optional: time sessions automatically while FL Studio is open. Returns true if anything changed. */
  async autoTrack(): Promise<boolean> {
    const running = await this.flRunning()
    const o = this.open()
    if (running) {
      this.flMisses = 0
      if (!o) { this.start(true); return true }
      return false
    }
    if (o && o.auto && ++this.flMisses >= 2) { this.flMisses = 0; this.stop(); return true }
    return false
  }
}
