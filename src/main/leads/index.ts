import type Database from 'better-sqlite3'
import { normalizeEmail, scoreLead, type Lead, type LeadCandidate, type LeadSource, type LeadStatus } from '../../shared/leads'
import type { Crm } from '../crm'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Stored when an email has no page it was found on, so every address still names where it came from. */
const ADDED_BY_YOU = 'added by you'

function parseList(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export class Leads {
  constructor(
    private db: Database.Database,
    private crm: Crm,
    private genres: () => string[],
    private now: () => number = Date.now
  ) {}

  private toLead(r: Row): Lead {
    return {
      id: r.id, source: r.source, sourceId: r.source_id, name: r.name, url: r.url, followers: r.followers, lastActiveAt: r.last_active_at,
      genre: r.genre, bio: r.bio, signals: parseList(r.signals), score: r.score, reasons: parseList(r.reasons), email: r.email,
      emailSourceUrl: r.email_source_url, status: r.status, contactId: r.contact_id, createdAt: r.created_at
    }
  }

  get(id: number): Lead | undefined {
    const r = this.db.prepare('SELECT * FROM leads WHERE id=?').get(id) as Row | undefined
    return r ? this.toLead(r) : undefined
  }

  list(f: { source?: LeadSource; minScore?: number; hasEmail?: boolean; status?: LeadStatus } = {}): Lead[] {
    const where: string[] = []
    const args: unknown[] = []
    if (f.source) { where.push('source=?'); args.push(f.source) }
    if (f.minScore !== undefined) { where.push('score>=?'); args.push(f.minScore) }
    if (f.hasEmail !== undefined) where.push(f.hasEmail ? "email!=''" : "email=''")
    if (f.status) { where.push('status=?'); args.push(f.status) }
    const sql = `SELECT * FROM leads${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY score DESC, id`
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toLead(r))
  }

  addCandidates(cs: LeadCandidate[]): { added: number; duplicates: number } {
    const now = this.now()
    const producerGenres = this.genres()
    const seen = this.db.prepare('SELECT 1 FROM leads WHERE source=? AND source_id=?')
    const emailTaken = this.db.prepare('SELECT 1 FROM leads WHERE email=?')
    const ins = this.db.prepare(
      `INSERT INTO leads(source,source_id,name,url,followers,last_active_at,genre,bio,signals,score,reasons,email,email_source_url,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?)`
    )
    let added = 0
    let duplicates = 0
    this.db.transaction(() => {
      for (const c of cs) {
        const email = normalizeEmail(c.email) ?? ''
        if (seen.get(c.source, c.sourceId) || (email && emailTaken.get(email))) {
          duplicates++
          continue
        }
        const { score, reasons } = scoreLead(c, { producerGenres, now })
        ins.run(
          c.source, c.sourceId, c.name, c.url, c.followers, c.lastActiveAt, c.genre, c.bio, JSON.stringify(c.signals), score, JSON.stringify(reasons),
          email, email ? c.emailSourceUrl.trim() || ADDED_BY_YOU : '', now
        )
        added++
      }
    })()
    return { added, duplicates }
  }

  setStatus(id: number, s: 'saved' | 'skipped'): void {
    this.db.prepare('UPDATE leads SET status=? WHERE id=?').run(s, id)
  }

  setEmail(id: number, email: string, sourceUrl: string): void {
    const e = normalizeEmail(email) ?? ''
    this.db.prepare('UPDATE leads SET email=?, email_source_url=? WHERE id=?').run(e, e ? sourceUrl.trim() || ADDED_BY_YOU : '', id)
  }

  /** Puts the lead in the CRM and returns the contact id, reusing a live contact that already has the same email. */
  promote(id: number): number {
    const r = this.db.prepare('SELECT * FROM leads WHERE id=?').get(id) as Row | undefined
    if (!r) throw new Error('That lead no longer exists.')
    const lead = this.toLead(r)
    let contactId: number | undefined
    if (lead.email) {
      const hit = this.db.prepare("SELECT id FROM contacts WHERE archived_at IS NULL AND lower(trim(email))=? ORDER BY id LIMIT 1").get(lead.email) as Row | undefined
      contactId = hit?.id
    }
    contactId ??= this.crm.saveContact({
      name: lead.name,
      role: 'artist',
      email: lead.email,
      sound: lead.genre,
      links: lead.url ? [{ label: lead.source, url: lead.url }] : []
    })
    this.db.prepare("UPDATE leads SET status='in_crm', contact_id=? WHERE id=?").run(contactId, id)
    return contactId
  }

  suppress(email: string, reason: string): void {
    const e = normalizeEmail(email)
    if (!e) return
    this.db.prepare('INSERT INTO suppressed(email,reason,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').run(e, reason, this.now())
  }

  isSuppressed(email: string): boolean {
    const e = normalizeEmail(email)
    return !!e && !!this.db.prepare('SELECT 1 FROM suppressed WHERE email=?').get(e)
  }

  suppressedList(): { email: string; reason: string; createdAt: number }[] {
    return (this.db.prepare('SELECT email, reason, created_at FROM suppressed ORDER BY created_at DESC, email').all() as Row[]).map((r) => ({
      email: r.email, reason: r.reason, createdAt: r.created_at
    }))
  }
}

/** Throws if the address opted out. The raw email goes to the store, which normalises it. */
export function assertNotSuppressed(leads: Pick<Leads, 'isSuppressed'>, email: string): void {
  if (email && leads.isSuppressed(email)) throw new Error(`${email} opted out and cannot be pitched.`)
}

/** Fail closed: an unknown contact throws; a contact with an email is checked whatever the channel. */
export function assertContactNotSuppressed(leads: Pick<Leads, 'isSuppressed'>, crm: Pick<Crm, 'contactEmail'>, contactId: number): void {
  const email = crm.contactEmail(contactId)
  if (email === undefined) throw new Error('Contact not found.')
  assertNotSuppressed(leads, email)
}

export function assertPitchNotSuppressed(leads: Pick<Leads, 'isSuppressed'>, crm: Pick<Crm, 'pitchContactEmail'>, pitchId: number): void {
  const email = crm.pitchContactEmail(pitchId)
  if (email === undefined) throw new Error('Pitch not found.')
  assertNotSuppressed(leads, email)
}
