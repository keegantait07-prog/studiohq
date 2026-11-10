import type Database from 'better-sqlite3'

/** Test-only: inserts a group (if needed) and a beat with sensible defaults. */
export function addBeat(db: Database.Database, b: { id: number; title: string; groupId?: number; ext?: string; mtime?: number; missing?: boolean; status?: string; bpm?: number; key?: string }): void {
  const g = b.groupId ?? b.id
  db.prepare('INSERT OR IGNORE INTO groups(id,key,name) VALUES(?,?,?)').run(g, `g${g}`, b.title)
  const ext = b.ext ?? 'mp3'
  db.prepare('INSERT INTO beats(id,path,filename,title,folder,ext,size,mtime,group_id,missing,status,bpm,key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.id, `/beats/${b.id}.${ext}`, `${b.id}.${ext}`, b.title, '/beats', ext, 1, b.mtime ?? b.id, g, b.missing ? 1 : 0, b.status ?? 'finished', b.bpm ?? null, b.key ?? null, 1)
}
