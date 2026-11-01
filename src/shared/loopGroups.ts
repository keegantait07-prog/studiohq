// Sections for the Loop Vault list: by the folder a loop lives in, by tempo band, by key, or not at all.
import { displayKey } from './key'

export type GroupBy = 'folder' | 'bpm' | 'key' | 'none'
export interface GroupableRow { beat: { folder: string; bpm: number | null; key: string | null } }
export interface Section<R> { key: string; label: string; rows: R[] }

const trim = (p: string) => p.replace(/\/+$/, '')
const parts = (p: string) => p.split('/').filter(Boolean)

/** The folder as you think of it: the path below your loop folder ("Drums / Kicks"), not the full path. */
export function folderLabel(folder: string, roots: string[]): string {
  const f = trim(folder)
  const root = roots.map(trim).filter((r) => r && (f === r || f.startsWith(r + '/'))).sort((a, b) => b.length - a.length)[0]
  if (root) {
    const rest = parts(f.slice(root.length))
    return rest.length ? rest.join(' / ') : parts(root).pop() ?? root
  }
  return parts(f).slice(-2).join(' / ') || f
}

const BANDS: { max: number; key: string; label: string }[] = [
  { max: 90, key: 'lt90', label: 'Under 90 BPM' },
  { max: 110, key: '90', label: '90–110 BPM' },
  { max: 130, key: '110', label: '110–130 BPM' },
  { max: 150, key: '130', label: '130–150 BPM' },
  { max: Infinity, key: '150', label: '150+ BPM' }
]

export function bpmBucket(bpm: number | null): { key: string; label: string; order: number } {
  if (bpm == null) return { key: 'unknown', label: 'Unknown BPM', order: BANDS.length }
  const i = BANDS.findIndex((b) => bpm < b.max)
  return { key: BANDS[i].key, label: BANDS[i].label, order: i }
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Rows keep the order they come in within each section. */
export function groupRows<R extends GroupableRow>(rows: R[], by: GroupBy, roots: string[]): Section<R>[] {
  if (!rows.length) return []
  if (by === 'none') return [{ key: 'all', label: '', rows }]
  const map = new Map<string, { label: string; order: number; rows: R[] }>()
  for (const r of rows) {
    let key: string, label: string, order = 0
    if (by === 'folder') { key = `f:${trim(r.beat.folder)}`; label = folderLabel(r.beat.folder, roots) }
    else if (by === 'bpm') { const b = bpmBucket(r.beat.bpm); key = `b:${b.key}`; label = b.label; order = b.order }
    else { key = `k:${r.beat.key ?? ''}`; label = r.beat.key ? displayKey(r.beat.key) : 'No key'; order = r.beat.key ? 0 : 1 }
    const s = map.get(key) ?? { label, order, rows: [] }
    s.rows.push(r)
    map.set(key, s)
  }
  return [...map.entries()]
    .map(([key, s]) => ({ key, ...s }))
    .sort((a, b) => a.order - b.order || natural(a.label, b.label))
    .map(({ key, label, rows: rs }) => ({ key, label, rows: rs }))
}
