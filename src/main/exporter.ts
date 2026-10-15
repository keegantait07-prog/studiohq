// Plain CSV exports of the catalog and sales, for spreadsheets, taxes and backups you can read.
import { writeFileSync } from 'fs'
import { join } from 'path'
import { camelot } from '../shared/key'
import type { Beat, Sale } from '../shared/types'

const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (cols: unknown[]) => cols.map(cell).join(',')
const day = (t: number) => new Date(t).toISOString().slice(0, 10)

export function beatsCsv(beats: Beat[]): string {
  const head = ['title', 'status', 'bpm', 'key', 'camelot', 'duration_s', 'vibe', 'genre', 'type_beat_artists', 'credits', 'version', 'kind', 'file', 'project', 'added']
  const lines = beats.map((b) => row([
    b.title, b.status, b.bpm, b.key, camelot(b.key), b.duration != null ? Math.round(b.duration) : '',
    b.tags.vibe.join('; '), b.tags.genre.join('; '), b.tags.artist.join('; '), b.credits, b.versionLabel,
    b.ext === 'flp' ? 'FL project' : 'audio', b.path, b.projectPath ?? '', day(b.createdAt)
  ]))
  return [row(head), ...lines].join('\n') + '\n'
}

export function salesCsv(sales: Sale[]): string {
  const head = ['date', 'beat', 'buyer', 'email', 'license', 'exclusive', 'price', 'fees', 'net', 'source', 'notes']
  const lines = sales.map((s) => row([day(s.soldAt), s.beatTitle, s.buyer, s.buyerEmail, s.licenseName, s.exclusive ? 'yes' : 'no', s.price.toFixed(2), s.fee.toFixed(2), (s.price - s.fee).toFixed(2), s.source, s.notes]))
  return [row(head), ...lines].join('\n') + '\n'
}

export function writeExports(dir: string, beats: Beat[], sales: Sale[]): string[] {
  const stamp = day(Date.now())
  const files = [join(dir, `studio-hq-beats-${stamp}.csv`), join(dir, `studio-hq-sales-${stamp}.csv`)]
  writeFileSync(files[0], beatsCsv(beats))
  writeFileSync(files[1], salesCsv(sales))
  return files
}
