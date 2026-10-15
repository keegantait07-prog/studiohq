import Database from 'better-sqlite3'
import { join } from 'path'
import { mkdirSync } from 'fs'

export function openDb(dir: string): Database.Database {
  mkdirSync(dir, { recursive: true })
  const db = new Database(join(dir, 'studio-hq.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS beats (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      title TEXT NOT NULL,
      folder TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      duration REAL,
      bpm REAL,
      bpm_source TEXT,
      bpm_confidence TEXT,
      key TEXT,
      key_source TEXT,
      status TEXT NOT NULL DEFAULT 'finished',
      notes TEXT NOT NULL DEFAULT '',
      credits TEXT NOT NULL DEFAULT '',
      group_id INTEGER NOT NULL REFERENCES groups(id),
      version_label TEXT NOT NULL DEFAULT '',
      project_path TEXT,
      project_confidence REAL,
      missing INTEGER NOT NULL DEFAULT 0,
      analyzed_at INTEGER,
      peaks TEXT,
      thumb TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS beats_group ON beats(group_id);
    CREATE TABLE IF NOT EXISTS tags (
      beat_id INTEGER NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (beat_id, kind, value)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  return db
}
