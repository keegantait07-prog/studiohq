import type Database from 'better-sqlite3'
import { AWAITING, type Contact, type CrmData, type LogPitchInput, type Pitch, type PitchStatus, type Template } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86400000

/** Opt-out checks the CRM runs before any pitch or follow-up, whoever calls it (IPC, assistant). Set by Leads, which is built after Crm. */
export interface PitchGuard {
  /** Throws if this contact cannot be pitched (opted out) or does not exist. */
  contact(contactId: number): void
  /** Throws if the contact of this pitch cannot be pitched or the pitch does not exist. */
  pitch(pitchId: number): void
  /** True when any address in this free-text email opted out. */
  suppressed(email: string): boolean
}

export class Crm {
  private guard: PitchGuard | null = null
  setPitchGuard(g: PitchGuard): void {
    this.guard = g
  }
  private optedOut(contactId: number): boolean {
    const email = this.contactEmail(contactId)
    return !!email && !!this.guard?.suppressed(email)
  }

  constructor(
    private db: Database.Database,
    private defaultDays: () => number,
    private onBeatsTouched: () => void
  ) {}

  all(): CrmData {
    const contacts = (this.db.prepare('SELECT * FROM contacts WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE').all() as Row[]).map((r) => this.toContact(r))
    const beatsByPitch = new Map<number, Pitch['beats']>()
    for (const r of this.db.prepare(
      `SELECT pb.pitch_id, pb.beat_id, pb.response, b.group_id, b.title, b.bpm, b.key, b.status FROM pitch_beats pb JOIN beats b ON b.id=pb.beat_id ORDER BY b.title`
    ).all() as Row[]) {
      const list = beatsByPitch.get(r.pitch_id) ?? []
      list.push({ beatId: r.beat_id, groupId: r.group_id, title: r.title, bpm: r.bpm, key: r.key, status: r.status, response: r.response })
      beatsByPitch.set(r.pitch_id, list)
    }
    const pitches = (this.db.prepare('SELECT p.*, c.name contact_name FROM pitches p JOIN contacts c ON c.id=p.contact_id ORDER BY p.sent_at DESC').all() as Row[]).map((r) => ({
      id: r.id, contactId: r.contact_id, contactName: r.contact_name, packId: r.pack_id, subject: r.subject, channel: r.channel, link: r.link, sentAt: r.sent_at,
      status: r.status as PitchStatus, responseNote: r.response_note, respondedAt: r.responded_at, nextFollowupAt: r.next_followup_at,
      followupCount: r.followup_count, lastFollowupAt: r.last_followup_at, beats: beatsByPitch.get(r.id) ?? []
    }))
    const templates = this.db.prepare('SELECT * FROM templates ORDER BY id').all() as Template[]
    return { contacts, pitches, templates, defaultFollowupDays: this.defaultDays() }
  }

  private toContact(r: Row): Contact {
    let links = []
    try { links = JSON.parse(r.links) } catch { /* bad json -> no links */ }
    return { id: r.id, name: r.name, role: r.role, email: r.email, sound: r.sound, links, notes: r.notes, followupDays: r.followup_days, createdAt: r.created_at }
  }

  saveContact(c: Partial<Contact> & { name: string }): number {
    const vals = [c.name.trim(), c.role ?? 'artist', c.email ?? '', c.sound ?? '', JSON.stringify(c.links ?? []), c.notes ?? '', c.followupDays ?? null]
    if (c.id) {
      this.db.prepare('UPDATE contacts SET name=?, role=?, email=?, sound=?, links=?, notes=?, followup_days=? WHERE id=?').run(...vals, c.id)
      // a changed interval re-times anything still waiting
      this.retimeOpen(c.id)
      return c.id
    }
    return Number(this.db.prepare('INSERT INTO contacts(name,role,email,sound,links,notes,followup_days,created_at) VALUES(?,?,?,?,?,?,?,?)').run(...vals, Date.now()).lastInsertRowid)
  }
  /** Hides the person but keeps the record of what was sent to them, and stops their follow-ups. */
  deleteContact(id: number): void {
    this.db.prepare('UPDATE contacts SET archived_at=? WHERE id=?').run(Date.now(), id)
    this.db.prepare('UPDATE pitches SET next_followup_at=NULL WHERE contact_id=?').run(id)
  }

  /** Email of a contact, archived or not; undefined when the contact does not exist. */
  contactEmail(contactId: number): string | undefined {
    return (this.db.prepare('SELECT email FROM contacts WHERE id=?').get(contactId) as Row | undefined)?.email
  }
  /** Email of the contact a pitch was sent to; undefined when the pitch does not exist. */
  pitchContactEmail(pitchId: number): string | undefined {
    return (this.db.prepare('SELECT c.email FROM pitches p JOIN contacts c ON c.id=p.contact_id WHERE p.id=?').get(pitchId) as Row | undefined)?.email
  }

  private daysFor(contactId: number): number {
    const r = this.db.prepare('SELECT followup_days d FROM contacts WHERE id=?').get(contactId) as Row | undefined
    return r?.d ?? this.defaultDays()
  }
  private retimeOpen(contactId: number): void {
    if (this.optedOut(contactId)) return
    const days = this.daysFor(contactId)
    const open = this.db.prepare(`SELECT id, sent_at, last_followup_at FROM pitches WHERE contact_id=? AND status IN ('sent','listened')`).all(contactId) as Row[]
    const upd = this.db.prepare('UPDATE pitches SET next_followup_at=? WHERE id=?')
    for (const p of open) upd.run((p.last_followup_at ?? p.sent_at) + days * DAY, p.id)
  }

  logPitch(i: LogPitchInput): number {
    this.guard?.contact(i.contactId)
    const now = Date.now()
    const sold = i.beatIds.length ? this.db.prepare(`SELECT title FROM beats WHERE status='sold' AND id IN (${i.beatIds.map(() => '?').join(',')})`).all(...i.beatIds) as { title: string }[] : []
    if (sold.length) throw new Error(`Already sold: ${sold.map((b) => b.title).join(', ')}. Remove ${sold.length > 1 ? 'them' : 'it'} from the pitch.`)
    const tx = this.db.transaction(() => {
      const id = Number(
        this.db.prepare('INSERT INTO pitches(contact_id,pack_id,subject,channel,link,sent_at,next_followup_at) VALUES(?,?,?,?,?,?,?)')
          .run(i.contactId, i.packId, i.subject, i.channel, i.link, now, now + this.daysFor(i.contactId) * DAY).lastInsertRowid
      )
      const ins = this.db.prepare('INSERT OR IGNORE INTO pitch_beats(pitch_id,beat_id) VALUES(?,?)')
      for (const b of i.beatIds) ins.run(id, b)
      if (i.beatIds.length) {
        this.db.prepare(`UPDATE beats SET status='sent' WHERE status IN ('idea','wip','finished') AND id IN (${i.beatIds.map(() => '?').join(',')})`).run(...i.beatIds)
      }
      return id
    })
    const id = tx()
    this.onBeatsTouched()
    return id
  }

  updatePitch(id: number, p: { status?: PitchStatus; responseNote?: string; snoozeDays?: number }): void {
    const cur = this.db.prepare('SELECT * FROM pitches WHERE id=?').get(id) as Row | undefined
    if (!cur) return
    const now = Date.now()
    if (p.responseNote !== undefined) this.db.prepare('UPDATE pitches SET response_note=? WHERE id=?').run(p.responseNote, id)
    if (p.status) {
      if (AWAITING.includes(p.status)) {
        const base = cur.last_followup_at ?? cur.sent_at
        const next = this.optedOut(cur.contact_id) ? null : Math.max(now + DAY, base + this.daysFor(cur.contact_id) * DAY)
        this.db.prepare('UPDATE pitches SET status=?, responded_at=NULL, next_followup_at=? WHERE id=?').run(p.status, cur.status === p.status ? cur.next_followup_at : next, id)
      } else {
        this.db.prepare('UPDATE pitches SET status=?, responded_at=COALESCE(responded_at, ?), next_followup_at=NULL WHERE id=?').run(p.status, now, id)
      }
    }
    if (p.snoozeDays && !this.optedOut(cur.contact_id) && AWAITING.includes((p.status ?? cur.status) as PitchStatus)) {
      this.db.prepare('UPDATE pitches SET next_followup_at=? WHERE id=?').run(now + p.snoozeDays * DAY, id)
    }
  }

  logFollowup(id: number): void {
    this.guard?.pitch(id)
    const cur = this.db.prepare('SELECT contact_id FROM pitches WHERE id=?').get(id) as Row | undefined
    if (!cur) return
    const now = Date.now()
    this.db.prepare('UPDATE pitches SET followup_count=followup_count+1, last_followup_at=?, next_followup_at=? WHERE id=?')
      .run(now, now + this.daysFor(cur.contact_id) * DAY, id)
  }
  setPitchBeatResponse(pitchId: number, beatId: number, r: '' | 'liked' | 'passed'): void {
    this.db.prepare('UPDATE pitch_beats SET response=? WHERE pitch_id=? AND beat_id=?').run(r, pitchId, beatId)
  }
  deletePitch(id: number): void {
    this.db.prepare('DELETE FROM pitches WHERE id=?').run(id)
  }

  saveTemplate(t: Partial<Template> & Pick<Template, 'name' | 'kind' | 'subject' | 'body'>): number {
    if (t.id) {
      this.db.prepare('UPDATE templates SET name=?, kind=?, subject=?, body=? WHERE id=?').run(t.name, t.kind, t.subject, t.body, t.id)
      return t.id
    }
    return Number(this.db.prepare('INSERT INTO templates(name,kind,subject,body) VALUES(?,?,?,?)').run(t.name, t.kind, t.subject, t.body).lastInsertRowid)
  }
  deleteTemplate(id: number): void {
    this.db.prepare('DELETE FROM templates WHERE id=?').run(id)
  }

  /** Pitches still waiting whose follow-up date has arrived. */
  due(): { pitchId: number; contact: string }[] {
    const rows = this.db.prepare(
      `SELECT p.id pitchId, c.name contact, c.email email FROM pitches p JOIN contacts c ON c.id=p.contact_id
       WHERE p.status IN ('sent','listened') AND p.next_followup_at IS NOT NULL AND p.next_followup_at <= ? ORDER BY p.next_followup_at`
    ).all(Date.now()) as { pitchId: number; contact: string; email: string }[]
    return rows.filter((r) => !(r.email && this.guard?.suppressed(r.email))).map(({ pitchId, contact }) => ({ pitchId, contact }))
  }
}
