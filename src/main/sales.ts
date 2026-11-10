import type Database from 'better-sqlite3'
import { applyImport, readImport, type ImportResult } from './beatstars-apply'
import type { ColumnMap, ImportRead, License, LogSaleInput, Sale, SalesData, SplitGroup, SplitRow } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const dateStr = (ms: number) => new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
const num = (v: unknown, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def)
const pct = (v: unknown) => Math.max(0, Math.min(100, Math.round(num(v) * 100) / 100))

export class Sales {
  constructor(private db: Database.Database) {}

  // ---- reads ----
  all(): SalesData {
    const sales = (this.db.prepare(
      `SELECT s.*, b.title beat_title FROM sales s JOIN beats b ON b.id=s.beat_id ORDER BY s.sold_at DESC, s.id DESC`
    ).all() as Row[]).map((r): Sale => ({
      id: r.id, beatId: r.beat_id, groupId: r.group_id, beatTitle: r.beat_title, buyer: r.buyer, buyerEmail: r.buyer_email, contactId: r.contact_id,
      licenseName: r.license_name, exclusive: !!r.exclusive, price: r.price, fee: r.fee, source: r.source, soldAt: r.sold_at, notes: r.notes
    }))
    const licenses = (this.db.prepare('SELECT * FROM license_types ORDER BY sort, id').all() as Row[]).map((r): License => ({ id: r.id, name: r.name, exclusive: !!r.exclusive, defaultPrice: r.default_price, files: r.files, perks: JSON.parse(r.perks) }))
    const groups = (this.db.prepare(
      `SELECT g.id groupId, g.split_sheet_at sheetAt,
         (SELECT id FROM beats WHERE group_id=g.id AND missing=0 ORDER BY mtime DESC LIMIT 1) beatId,
         (SELECT title FROM beats WHERE group_id=g.id AND missing=0 ORDER BY mtime DESC LIMIT 1) title,
         (SELECT COUNT(*) FROM beats WHERE group_id=g.id AND missing=0) count,
         ROUND(COALESCE((SELECT SUM(pub_pct) FROM beat_splits WHERE group_id=g.id),0),2) pubTotal,
         ROUND(COALESCE((SELECT SUM(master_pct) FROM beat_splits WHERE group_id=g.id),0),2) masterTotal,
         (SELECT COUNT(*) FROM beat_splits WHERE group_id=g.id) parties
       FROM groups g WHERE beatId IS NOT NULL ORDER BY title COLLATE NOCASE`
    ).all() as Row[]).map((r): SplitGroup => ({ groupId: r.groupId, beatId: r.beatId, title: r.title, count: r.count, parties: r.parties, pubTotal: r.pubTotal, masterTotal: r.masterTotal, sheetAt: r.sheetAt }))
    return { sales, licenses, groups }
  }

  /** The exclusive sale (if any) that locks this beat's group. */
  exclusiveFor(groupId: number): Row | undefined {
    return this.db.prepare('SELECT * FROM sales WHERE group_id=? AND exclusive=1 ORDER BY sold_at LIMIT 1').get(groupId) as Row | undefined
  }

  // ---- sales ----
  log(i: LogSaleInput): number {
    const beat = this.db.prepare('SELECT id, title, group_id FROM beats WHERE id=?').get(i.beatId) as Row | undefined
    if (!beat) throw new Error('Choose a beat first.')
    if (!i.buyer.trim()) throw new Error('Enter who bought it.')
    const price = num(i.price, NaN), fee = num(i.fee)
    if (!(price >= 0)) throw new Error('Enter a valid price.')
    if (fee < 0 || fee > price) throw new Error('The fee must be between 0 and the price.')
    if (!Number.isFinite(i.soldAt)) throw new Error('Enter a valid date.')

    const lock = this.exclusiveFor(beat.group_id)
    if (lock && (i.exclusive || lock.sold_at <= i.soldAt)) {
      throw new Error(`"${beat.title}" was sold exclusively to ${lock.buyer} on ${dateStr(lock.sold_at)}, so it can't be sold again. (If this is an older sale, set its date before the exclusive.)`)
    }
    const tx = this.db.transaction(() => {
      const id = Number(
        this.db.prepare(
          `INSERT INTO sales(beat_id,group_id,buyer,buyer_email,contact_id,license_id,license_name,exclusive,price,fee,source,sold_at,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(i.beatId, beat.group_id, i.buyer.trim(), i.buyerEmail.trim(), i.contactId, i.licenseId, i.licenseName.trim() || (i.exclusive ? 'Exclusive' : 'Lease'), i.exclusive ? 1 : 0, price, fee, i.source, i.soldAt, i.notes, Date.now()).lastInsertRowid
      )
      if (i.exclusive) this.db.prepare(`UPDATE beats SET status='sold' WHERE group_id=?`).run(beat.group_id)
      return id
    })
    return tx()
  }

  update(id: number, p: Partial<Pick<Sale, 'buyer' | 'buyerEmail' | 'price' | 'fee' | 'source' | 'soldAt' | 'notes'>>): void {
    const cur = this.db.prepare('SELECT * FROM sales WHERE id=?').get(id) as Row | undefined
    if (!cur) return
    const price = p.price ?? cur.price, fee = p.fee ?? cur.fee
    if (!(price >= 0) || fee < 0 || fee > price) throw new Error('The fee must be between 0 and the price.')
    if (p.buyer !== undefined && !p.buyer.trim()) throw new Error('Enter who bought it.')
    const soldAt = p.soldAt ?? cur.sold_at
    if (cur.exclusive) {
      const later = this.db.prepare('SELECT buyer FROM sales WHERE group_id=? AND exclusive=0 AND sold_at>=? LIMIT 1').get(cur.group_id, soldAt) as Row | undefined
      if (later) throw new Error(`There is a lease to ${later.buyer} on or after that date, so the exclusive can't move before it.`)
    } else {
      const lock = this.exclusiveFor(cur.group_id)
      if (lock && lock.sold_at <= soldAt) throw new Error(`This beat was sold exclusively to ${lock.buyer} on ${dateStr(lock.sold_at)}, so a lease can't be dated on or after that.`)
    }
    this.db.prepare('UPDATE sales SET buyer=?, buyer_email=?, price=?, fee=?, source=?, sold_at=?, notes=? WHERE id=?').run(
      (p.buyer ?? cur.buyer).trim(), p.buyerEmail ?? cur.buyer_email, price, fee, p.source ?? cur.source, soldAt, p.notes ?? cur.notes, id
    )
  }

  delete(id: number): void {
    const cur = this.db.prepare('SELECT group_id, exclusive FROM sales WHERE id=?').get(id) as Row | undefined
    if (!cur) return
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM sales WHERE id=?').run(id)
      if (cur.exclusive && !this.exclusiveFor(cur.group_id)) this.db.prepare(`UPDATE beats SET status='finished' WHERE group_id=? AND status='sold'`).run(cur.group_id)
    })()
  }

  // ---- BeatStars import ----
  importRead(path: string, columns?: ColumnMap, choices?: Record<number, number | null>): ImportRead { return readImport(this.db, path, columns, choices) }
  importApply(path: string, columns: ColumnMap, choices: Record<number, number | null>): ImportResult { return applyImport(this.db, path, columns, choices) }

  // ---- licenses ----
  /** Creates or updates a license type. `files` and `perks` are left as they are when not given. */
  saveLicense(l: Partial<License> & { name: string; exclusive: boolean }): number {
    const price = l.defaultPrice == null ? null : num(l.defaultPrice, 0)
    const perks = l.perks ? JSON.stringify(l.perks.map((p) => String(p).trim()).filter(Boolean).slice(0, 8)) : null
    const files = l.files == null ? null : l.files.trim()
    if (l.id) {
      this.db.prepare('UPDATE license_types SET name=?, exclusive=?, default_price=?, files=COALESCE(?,files), perks=COALESCE(?,perks) WHERE id=?').run(l.name.trim(), l.exclusive ? 1 : 0, price, files, perks, l.id)
      return l.id
    }
    const sort = (this.db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM license_types').get() as Row).n
    return Number(this.db.prepare('INSERT INTO license_types(name,exclusive,default_price,sort,files,perks) VALUES(?,?,?,?,?,?)').run(l.name.trim(), l.exclusive ? 1 : 0, price, sort, files ?? '', perks ?? '[]').lastInsertRowid)
  }
  deleteLicense(id: number): void {
    this.db.prepare('DELETE FROM license_types WHERE id=?').run(id)
  }

  // ---- splits ----
  getSplits(groupId: number): SplitRow[] {
    return (this.db.prepare('SELECT * FROM beat_splits WHERE group_id=? ORDER BY sort, id').all(groupId) as Row[]).map((r) => ({
      name: r.name, role: r.role, email: r.email, pro: r.pro, ipi: r.ipi, pubPct: r.pub_pct, masterPct: r.master_pct
    }))
  }
  saveSplits(groupId: number, rows: SplitRow[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM beat_splits WHERE group_id=?').run(groupId)
      const ins = this.db.prepare('INSERT INTO beat_splits(group_id,name,role,email,pro,ipi,pub_pct,master_pct,sort) VALUES(?,?,?,?,?,?,?,?,?)')
      rows.filter((r) => r.name.trim()).forEach((r, i) => ins.run(groupId, r.name.trim(), r.role, r.email.trim(), r.pro.trim(), r.ipi.trim(), pct(r.pubPct), pct(r.masterPct), i))
      this.db.prepare('UPDATE groups SET split_sheet_at=NULL WHERE id=?').run(groupId) // splits changed, so any earlier sheet is out of date
    })()
  }
  markSheet(groupId: number): void {
    this.db.prepare('UPDATE groups SET split_sheet_at=? WHERE id=?').run(Date.now(), groupId)
  }
  /** Known collaborators, for autocomplete: latest details per name. */
  knownCollaborators(): SplitRow[] {
    return (this.db.prepare('SELECT * FROM beat_splits ORDER BY id DESC').all() as Row[]).filter((r, i, a) => a.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) === i).map((r) => ({
      name: r.name, role: r.role, email: r.email, pro: r.pro, ipi: r.ipi, pubPct: 0, masterPct: 0
    }))
  }

  // ---- export ----
  csv(): string {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const rows = this.all().sales.map((s) => [
      new Date(s.soldAt).toISOString().slice(0, 10), s.beatTitle, s.buyer, s.buyerEmail, s.licenseName, s.exclusive ? 'yes' : 'no',
      s.price.toFixed(2), s.fee.toFixed(2), (s.price - s.fee).toFixed(2), s.source, s.notes
    ])
    return [['Date', 'Beat', 'Buyer', 'Email', 'License', 'Exclusive', 'Price', 'Fee', 'Net', 'Source', 'Notes'], ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n'
  }
}
