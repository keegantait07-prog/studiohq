// Small helpers for the YouTube publisher: settings-table secrets (encrypted with the macOS Keychain via safeStorage) and the daily quota ledger.
import type Database from 'better-sqlite3'
import { safeStorage } from 'electron'
import { DAILY } from '../shared/ytQuota'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function getKv(db: Database.Database, key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined)?.value ?? null
}
export function setKv(db: Database.Database, key: string, v: string | null): void {
  if (v == null) db.prepare('DELETE FROM settings WHERE key=?').run(key)
  else db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, v)
}
export function getSecret(db: Database.Database, key: string): string | null {
  const v = getKv(db, key)
  return v ? safeStorage.decryptString(Buffer.from(v, 'base64')) : null
}
export function setSecret(db: Database.Database, key: string, value: string | null): void {
  if (!value?.trim()) return setKv(db, key, null)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available, so the secret was not saved.')
  setKv(db, key, safeStorage.encryptString(value.trim()).toString('base64'))
}

/** YouTube's quota resets at midnight Pacific time */
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

export function quotaUsed(db: Database.Database): { research: number; upload: number } {
  const out = { research: 0, upload: 0 }
  for (const r of db.prepare('SELECT kind, units FROM yt_quota WHERE day=?').all(day()) as Row[]) if (r.kind in out) out[r.kind as 'research' | 'upload'] = r.units
  return out
}
export function addQuota(db: Database.Database, kind: 'research' | 'upload', units: number): void {
  db.prepare('INSERT INTO yt_quota(day,kind,units) VALUES(?,?,?) ON CONFLICT(day,kind) DO UPDATE SET units=units+excluded.units').run(day(), kind, units)
}
export const quotaLeft = (db: Database.Database): number => DAILY - (quotaUsed(db).research + quotaUsed(db).upload)
