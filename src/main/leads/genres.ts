import type Database from 'better-sqlite3'

/** The producer's genres for lead scoring: the distinct genre tags on their beats (not loops), lowercased. Read on every call. */
export function producerGenres(db: Database.Database): string[] {
  const rows = db.prepare(
    `SELECT DISTINCT lower(trim(t.value)) g FROM tags t JOIN beats b ON b.id=t.beat_id WHERE t.kind='genre' AND b.kind='beat' AND b.missing=0`
  ).all() as { g: string }[]
  return [...new Set(rows.map((r) => r.g).filter(Boolean))]
}
