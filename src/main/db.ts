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

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'artist',
      email TEXT NOT NULL DEFAULT '',
      sound TEXT NOT NULL DEFAULT '',
      links TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      followup_days INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS packs (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      url TEXT,
      deployed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pack_beats (
      pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
      beat_id INTEGER NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (pack_id, beat_id)
    );
    CREATE TABLE IF NOT EXISTS pitches (
      id INTEGER PRIMARY KEY,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      pack_id INTEGER REFERENCES packs(id) ON DELETE SET NULL,
      subject TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'email',
      link TEXT NOT NULL DEFAULT '',
      sent_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      response_note TEXT NOT NULL DEFAULT '',
      responded_at INTEGER,
      next_followup_at INTEGER,
      followup_count INTEGER NOT NULL DEFAULT 0,
      last_followup_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS pitches_contact ON pitches(contact_id);
    CREATE TABLE IF NOT EXISTS pitch_beats (
      pitch_id INTEGER NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
      beat_id INTEGER NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
      response TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (pitch_id, beat_id)
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL
    );
  `)
  seedTemplates(db)
  return db
}

function seedTemplates(db: Database.Database): void {
  if ((db.prepare('SELECT COUNT(*) c FROM templates').get() as { c: number }).c) return
  const ins = db.prepare('INSERT INTO templates(name,kind,subject,body) VALUES(?,?,?,?)')
  ins.run(
    'First pitch', 'first_pitch', '{{beat_count}} beats for you, {{name}}',
    `Hey {{name}},

I'm {{my_name}}, a producer. I put together a few beats I think would fit what you're doing:

{{beats}}

Listen here: {{link}}

No pressure at all. If anything hits, let me know and I'll send the full files or stems.

{{my_name}}`
  )
  ins.run(
    'Follow-up', 'follow_up', 'Re: {{subject}}',
    `Hey {{name}},

Floating this back to the top of your inbox in case it got buried. I sent over {{beat_titles}} {{days}} days ago.

Listen: {{link}}

Happy to send other directions if these aren't it.

{{my_name}}`
  )
}
