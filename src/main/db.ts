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
    CREATE TABLE IF NOT EXISTS license_types (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      exclusive INTEGER NOT NULL DEFAULT 0,
      default_price REAL,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      beat_id INTEGER NOT NULL REFERENCES beats(id),
      group_id INTEGER NOT NULL REFERENCES groups(id),
      buyer TEXT NOT NULL,
      buyer_email TEXT NOT NULL DEFAULT '',
      contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      license_id INTEGER REFERENCES license_types(id) ON DELETE SET NULL,
      license_name TEXT NOT NULL,
      exclusive INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'other',
      sold_at INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sales_group ON sales(group_id);
    CREATE TABLE IF NOT EXISTS beat_splits (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'producer',
      email TEXT NOT NULL DEFAULT '',
      pro TEXT NOT NULL DEFAULT '',
      ipi TEXT NOT NULL DEFAULT '',
      pub_pct REAL NOT NULL DEFAULT 0,
      master_pct REAL NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS splits_group ON beat_splits(group_id);
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      beat_id INTEGER NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      date INTEGER NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS posts_beat ON posts(beat_id);
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY,
      beat_id INTEGER NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sounds (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      dir TEXT NOT NULL,
      name TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      duration REAL,
      kind TEXT NOT NULL DEFAULT 'other',
      bpm REAL,
      key TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      missing INTEGER NOT NULL DEFAULT 0,
      hash TEXT,
      hash_size INTEGER,
      hash_mtime INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sounds_size ON sounds(size);
    CREATE INDEX IF NOT EXISTS sounds_dir ON sounds(dir);
    CREATE TABLE IF NOT EXISTS flp_projects (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      ppq INTEGER,
      partial INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      parsed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS flp_samples (
      project_id INTEGER NOT NULL REFERENCES flp_projects(id) ON DELETE CASCADE,
      ref TEXT NOT NULL,
      name TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT '',
      sound_id INTEGER,
      how TEXT NOT NULL DEFAULT 'missing',
      PRIMARY KEY (project_id, ref)
    );
    CREATE TABLE IF NOT EXISTS flp_midis (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES flp_projects(id) ON DELETE CASCADE,
      pattern INTEGER NOT NULL,
      name TEXT NOT NULL,
      notes INTEGER NOT NULL,
      path TEXT NOT NULL,
      sound_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS sound_tags (
      sound_id INTEGER NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      PRIMARY KEY (sound_id, value)
    );
    CREATE TABLE IF NOT EXISTS feedback_comments (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      beat_index INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      time REAL NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0,
      resolved INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS fb_slug ON feedback_comments(slug);
    CREATE TABLE IF NOT EXISTS studio_sessions (
      id INTEGER PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      auto INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS yt_cache (key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS yt_style (scope TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS yt_images (hash TEXT PRIMARY KEY, path TEXT NOT NULL, beat_id INTEGER, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS yt_drafts (video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS yt_quota (day TEXT NOT NULL, kind TEXT NOT NULL, units INTEGER NOT NULL, PRIMARY KEY(day, kind));
    CREATE TABLE IF NOT EXISTS assistant_threads (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      cli_session_id TEXT,
      messages TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugins (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '',
      total_size INTEGER NOT NULL DEFAULT 0,
      scanned_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS plugin_bundles (
      id INTEGER PRIMARY KEY,
      plugin_id INTEGER NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      archs TEXT NOT NULL DEFAULT '',
      bundle_id TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS plugin_files (
      id INTEGER PRIMARY KEY,
      plugin_id INTEGER NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS plugin_findings (
      id INTEGER PRIMARY KEY,
      plugin_id INTEGER NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      certainty TEXT NOT NULL DEFAULT 'likely',
      fix TEXT
    );
    CREATE TABLE IF NOT EXISTS plugin_actions (
      id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      plugin_name TEXT NOT NULL DEFAULT '',
      original_path TEXT NOT NULL DEFAULT '',
      new_path TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );
  `)
  const bcols = db.prepare('PRAGMA table_info(beats)').all() as { name: string }[]
  if (!bcols.some((c) => c.name === 'cover_path')) db.exec('ALTER TABLE beats ADD COLUMN cover_path TEXT')
  if (!bcols.some((c) => c.name === 'preview_path')) db.exec('ALTER TABLE beats ADD COLUMN preview_path TEXT')
  // loops share the beats table (same columns, same analysis); 'kind' keeps the two vaults apart
  if (!bcols.some((c) => c.name === 'kind')) db.exec("ALTER TABLE beats ADD COLUMN kind TEXT NOT NULL DEFAULT 'beat'")
  db.exec('CREATE INDEX IF NOT EXISTS beats_kind ON beats(kind)')
  const pcols = db.prepare('PRAGMA table_info(packs)').all() as { name: string }[]
  if (!pcols.some((c) => c.name === 'kind')) db.exec("ALTER TABLE packs ADD COLUMN kind TEXT NOT NULL DEFAULT 'pitch'")
  const gcols = db.prepare('PRAGMA table_info(groups)').all() as { name: string }[]
  if (!gcols.some((c) => c.name === 'split_sheet_at')) db.exec('ALTER TABLE groups ADD COLUMN split_sheet_at INTEGER')
  seedTemplates(db)
  seedLicenses(db)
  return db
}

function seedLicenses(db: Database.Database): void {
  if ((db.prepare('SELECT COUNT(*) c FROM license_types').get() as { c: number }).c) return
  const ins = db.prepare('INSERT INTO license_types(name,exclusive,default_price,sort) VALUES(?,?,?,?)')
  // starter prices only; edit them under Sales > Licenses
  ;[['MP3 Lease', 0, 25], ['WAV Lease', 0, 50], ['Trackout Lease', 0, 100], ['Unlimited Lease', 0, 200], ['Exclusive', 1, 500]].forEach(([n, e, p], i) => ins.run(n, e, p, i))
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
