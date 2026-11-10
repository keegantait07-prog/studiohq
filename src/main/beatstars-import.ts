// Reads a BeatStars sales export and plans what to import. Pure: no Electron, no database writes.
import { siteTitle } from './catalog-title'
import type { ColumnMap, ImportField, ImportRow, License } from '../shared/types'

const FIELDS: ImportField[] = ['orderId', 'date', 'title', 'license', 'buyer', 'email', 'gross', 'fee', 'net']
const REQUIRED: ImportField[] = ['orderId', 'date', 'title', 'gross']

/** Header names we recognise, compared after lowercasing and dropping everything but letters and digits. Extend with real exports. */
const KNOWN_HEADERS: Record<ImportField, string[]> = {
  orderId: ['orderid', 'ordernumber', 'order', 'transactionid', 'invoice'],
  date: ['date', 'orderdate', 'purchasedate', 'createdat', 'soldat'],
  title: ['title', 'tracktitle', 'trackname', 'track', 'beat', 'item', 'itemname', 'productname'],
  license: ['license', 'licensetype', 'licensename'],
  buyer: ['buyer', 'buyername', 'customer', 'customername', 'name'],
  email: ['email', 'buyeremail', 'customeremail'],
  gross: ['gross', 'amount', 'price', 'total', 'grossamount', 'saleprice'],
  fee: ['fee', 'fees', 'servicefee', 'platformfee', 'commission'],
  net: ['net', 'netamount', 'earnings', 'payout']
}
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/** CSV with quotes, a BOM, CRLF, and a comma, semicolon or tab delimiter (whichever the first line uses most). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '')
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let q = false
  for (const ch of t) {
    if (ch === '"') q = !q
    else if (!q && ch === '\n') break
    else if (!q && ch in counts) counts[ch]++
  }
  const delim = (Object.keys(counts) as string[]).reduce((a, b) => (counts[b] > counts[a] ? b : a), ',')
  const rows: string[][] = []
  let row: string[] = [], cell = ''
  q = false
  const endRow = () => { row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = [] }
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n') endRow()
    else if (ch === '\r') { /* CRLF: the \n ends the row */ }
    else cell += ch
  }
  if (cell !== '' || row.length) endRow()
  return rows
}

export function detectColumns(headers: string[], saved?: ColumnMap): { columns: ColumnMap; missing: ImportField[] } {
  const columns: ColumnMap = {}
  const used = new Set<number>()
  for (const f of FIELDS) {
    const s = saved?.[f]
    if (s != null && Number.isInteger(s) && s >= 0 && s < headers.length && !used.has(s)) { columns[f] = s; used.add(s) }
  }
  const names = headers.map(norm)
  for (const f of FIELDS) {
    if (columns[f] != null) continue
    const i = names.findIndex((n, idx) => !used.has(idx) && KNOWN_HEADERS[f].includes(n))
    if (i >= 0) { columns[f] = i; used.add(i) }
  }
  return { columns, missing: REQUIRED.filter((f) => columns[f] == null) }
}

/** "$1,299.00", "29.99 USD", "(15.00)" and "-15" → a number; anything else → null. */
export function parseMoney(s: string): number | null {
  const neg = /\(.*\)/.test(s)
  const clean = s.replace(/[^0-9.\-]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null
  const n = parseFloat(clean)
  return neg ? -Math.abs(n) : n
}

/** ISO (date, or date and time with optional Z/offset) and US M/D/YYYY with optional time and AM/PM. A date alone means local noon. */
export function parseDate(s: string): number | null {
  const t = s.trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime()
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/)
  if (m) {
    if (m[7]) { const v = Date.parse(t.replace(' ', 'T')); return Number.isFinite(v) ? v : null }
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime()
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/)
  if (m) {
    let h = m[4] ? +m[4] : 12
    const mi = m[5] ? +m[5] : 0
    if (m[7]) h = (h % 12) + (/p/i.test(m[7]) ? 12 : 0)
    const d = new Date(+m[3], +m[1] - 1, +m[2], h, mi, +(m[6] ?? 0))
    return d.getMonth() === +m[1] - 1 ? d.getTime() : null
  }
  return null
}

export interface BeatRef { id: number; groupId: number; title: string; siteTitle: string | null; mtime: number }

export interface PlanInput {
  table: string[][]
  columns: ColumnMap
  beats: BeatRef[]
  licenses: License[]
  existingIds: Set<string>
  /** line → beat id to use, or null to skip that row */
  choices?: Record<number, number | null>
  /** group id → when it was sold exclusively */
  exclusiveLocks: Map<number, number>
}

/** The beat a title belongs to: exact site title, then exact Vault title, then both normalised. One group only; its newest file. */
function matchBeat(title: string, beats: BeatRef[]): BeatRef | null {
  const want = title.trim().toLowerCase()
  const rules: ((b: BeatRef) => boolean)[] = [
    (b) => (b.siteTitle ?? '').toLowerCase() === want,
    (b) => b.title.trim().toLowerCase() === want,
    (b) => siteTitle(b.title).toLowerCase() === siteTitle(title).toLowerCase()
  ]
  for (const rule of rules) {
    const hits = beats.filter(rule)
    if (!hits.length) continue
    if (new Set(hits.map((b) => b.groupId)).size > 1) return null
    return hits.reduce((a, b) => (b.mtime > a.mtime ? b : a))
  }
  return null
}

export function planImport(i: PlanInput): ImportRow[] {
  const [, ...data] = i.table
  const col = (r: string[], f: ImportField) => (i.columns[f] == null ? '' : (r[i.columns[f] as number] ?? '').trim())
  const perOrder = new Map<string, number>()
  for (const r of data) { const id = col(r, 'orderId'); perOrder.set(id, (perOrder.get(id) ?? 0) + 1) }
  const seen = new Map<string, number>()
  const exclusiveInFile = new Set<number>()
  const byId = new Map(i.beats.map((b) => [b.id, b]))

  return data.map((r, idx): ImportRow => {
    const line = idx + 2
    const order = col(r, 'orderId')
    const n = (seen.get(order) ?? 0) + 1
    seen.set(order, n)
    const externalId = (perOrder.get(order) ?? 0) > 1 ? `${order}:${n}` : order
    const title = col(r, 'title')
    const licName = col(r, 'license') || 'Lease'
    const tier = i.licenses.find((l) => l.name.toLowerCase() === licName.toLowerCase())
    const exclusive = tier ? tier.exclusive : /exclusive/i.test(licName)
    const soldAt = parseDate(col(r, 'date'))
    const gross = parseMoney(col(r, 'gross'))
    const feeCol = col(r, 'fee') === '' ? null : parseMoney(col(r, 'fee'))
    const netCol = col(r, 'net') === '' ? null : parseMoney(col(r, 'net'))
    const price = gross ?? 0
    const fee = feeCol != null && feeCol >= 0 ? Math.min(feeCol, price) : netCol != null ? Math.min(Math.max(price - netCol, 0), price) : 0
    const row: ImportRow = {
      line, externalId, title, license: licName, buyer: col(r, 'buyer') || 'BeatStars customer', email: col(r, 'email'),
      price, fee, soldAt, beatId: null, licenseId: tier?.id ?? null, exclusive, status: 'new', reason: ''
    }
    const stop = (status: ImportRow['status'], reason: string) => { row.status = status; row.reason = reason; return row }

    if (soldAt == null) return stop('skipped', "Couldn't read the date")
    if (gross == null) return stop('skipped', "Couldn't read the amount")
    if (gross <= 0) return stop('skipped', 'Refund or zero amount')
    if (i.existingIds.has(externalId)) return stop('duplicate', 'Already imported')
    const choice = i.choices?.[line]
    if (choice === null) return stop('skipped', 'Skipped by you')
    const beat = choice !== undefined ? byId.get(choice) ?? null : matchBeat(title, i.beats)
    if (!beat) return stop('unmatched', 'No single beat has this title')
    row.beatId = beat.id
    const lock = i.exclusiveLocks.get(beat.groupId)
    if ((lock != null && (exclusive || lock <= soldAt)) || (exclusive && exclusiveInFile.has(beat.groupId))) return stop('skipped', 'Already sold exclusively')
    if (exclusive) exclusiveInFile.add(beat.groupId)
    return row
  })
}
