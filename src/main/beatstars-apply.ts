// Connects the BeatStars importer to the database: reads a file into a plan, and writes the plan's new rows.
import { readFileSync, statSync } from 'fs'
import type Database from 'better-sqlite3'
import { detectColumns, parseCsv, planImport, type BeatRef } from './beatstars-import'
import type { ColumnMap, ImportField, ImportRead, ImportRow, License } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const MAX_BYTES = 20 * 1024 * 1024
const BAD_FILE = "That file isn't a sales export Studio HQ can read (it needs to be a .csv with a header row)."

function loadTable(path: string): string[][] {
  let table: string[][]
  try {
    if (!/\.csv$/i.test(path)) throw new Error('not csv')
    const st = statSync(path)
    if (!st.isFile() || st.size > MAX_BYTES) throw new Error('not a usable file')
    table = parseCsv(readFileSync(path, 'utf8'))
  } catch { throw new Error(BAD_FILE) }
  if (table.length < 2) throw new Error(BAD_FILE)
  return table
}

const getSetting = (db: Database.Database, key: string): string | null => (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined)?.value ?? null

function context(db: Database.Database) {
  // site_beats belongs to Catalog and may not exist yet on a database Catalog has never opened
  const hasSite = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_beats'").get()
  const siteTitles = new Map(hasSite ? (db.prepare('SELECT beat_id, title FROM site_beats').all() as Row[]).map((r): [number, string] => [r.beat_id, r.title]) : [])
  const beats = (db.prepare('SELECT id, group_id, title, mtime FROM beats WHERE missing=0').all() as Row[]).map((r): BeatRef => ({ id: r.id, groupId: r.group_id, title: r.title, siteTitle: siteTitles.get(r.id) ?? null, mtime: r.mtime }))
  const licenses = (db.prepare('SELECT * FROM license_types ORDER BY sort, id').all() as Row[]).map((r): License => ({ id: r.id, name: r.name, exclusive: !!r.exclusive, defaultPrice: r.default_price, files: r.files, perks: JSON.parse(r.perks) }))
  const existingIds = new Set((db.prepare("SELECT external_id FROM sales WHERE source='beatstars' AND external_id IS NOT NULL").all() as Row[]).map((r) => r.external_id as string))
  const exclusiveLocks = new Map((db.prepare('SELECT group_id, MIN(sold_at) t FROM sales WHERE exclusive=1 GROUP BY group_id').all() as Row[]).map((r) => [r.group_id as number, r.t as number]))
  return { beats, licenses, existingIds, exclusiveLocks }
}

/** The remembered mapping is stored by header NAME, so a re-export with its columns in another order still maps correctly. */
function savedColumns(db: Database.Database, headers: string[]): ColumnMap | undefined {
  try {
    const names = JSON.parse(getSetting(db, 'beatstars_columns') ?? 'null') as Partial<Record<ImportField, string>> | null
    if (!names) return undefined
    const map: ColumnMap = {}
    for (const [f, h] of Object.entries(names) as [ImportField, string][]) { const i = headers.indexOf(h); if (i >= 0) map[f] = i }
    return map
  } catch { return undefined }
}
const namesOf = (columns: ColumnMap, headers: string[]) => Object.fromEntries(Object.entries(columns).map(([f, i]) => [f, headers[i as number]]))

/** Reads a sales export and says what importing it would do. Writes nothing. */
export function readImport(db: Database.Database, path: string, columns?: ColumnMap, choices?: Record<number, number | null>): ImportRead {
  const table = loadTable(path)
  const headers = table[0]
  const det = detectColumns(headers, columns ?? savedColumns(db, headers))
  const rows = det.missing.length ? [] : planImport({ table, columns: det.columns, choices, ...context(db) })
  return { headers, columns: det.columns, missing: det.missing, rows }
}

export interface ImportResult { imported: number; duplicates: number; skipped: number; unmatched: number }

/** Re-reads and re-plans the file, then writes every new row in one transaction. Rows that are not new are only counted. */
export function applyImport(db: Database.Database, path: string, columns: ColumnMap, choices: Record<number, number | null>): ImportResult {
  const table = loadTable(path)
  const det = detectColumns(table[0], columns)
  if (det.missing.length) throw new Error('Some columns are not matched yet, so nothing was imported.')
  const rows: ImportRow[] = planImport({ table, columns: det.columns, choices, ...context(db) })
  const groupOf = db.prepare('SELECT group_id FROM beats WHERE id=?')
  const ins = db.prepare(
    `INSERT INTO sales(beat_id,group_id,buyer,buyer_email,contact_id,license_id,license_name,exclusive,price,fee,source,sold_at,notes,created_at,external_id)
     VALUES(?,?,?,?,NULL,?,?,?,?,?,'beatstars',?,'',?,?)`
  )
  const result: ImportResult = { imported: 0, duplicates: 0, skipped: 0, unmatched: 0 }
  db.transaction(() => {
    let exclusive = false
    for (const r of rows) {
      if (r.status === 'duplicate') { result.duplicates++; continue }
      if (r.status === 'skipped') { result.skipped++; continue }
      if (r.status === 'unmatched') { result.unmatched++; continue }
      const g = (groupOf.get(r.beatId) as Row).group_id as number
      ins.run(r.beatId, g, r.buyer, r.email, r.licenseId, r.license, r.exclusive ? 1 : 0, r.price, r.fee, r.soldAt, Date.now(), r.externalId)
      if (r.exclusive) { db.prepare("UPDATE beats SET status='sold' WHERE group_id=?").run(g); exclusive = true }
      result.imported++
    }
    if (exclusive) db.prepare("INSERT INTO settings(key,value) VALUES('site_dirty','1') ON CONFLICT(key) DO UPDATE SET value='1'").run()
    db.prepare("INSERT INTO settings(key,value) VALUES('beatstars_columns',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(namesOf(det.columns, table[0])))
  })()
  return result
}

