import type { SoundRow } from './types'
import { displayKey } from './key'

export const KIT_SLOTS = [
  { id: 'kicks', folder: 'Kicks', single: 'Kick', target: 20 },
  { id: 'snares', folder: 'Snares', single: 'Snare', target: 20 },
  { id: 'claps', folder: 'Claps', single: 'Clap', target: 15 },
  { id: 'hats', folder: 'Hi Hats', single: 'Hi Hat', target: 25 },
  { id: 'opens', folder: 'Open Hats', single: 'Open Hat', target: 10 },
  { id: '808s', folder: '808s', single: '808', target: 25 },
  { id: 'percs', folder: 'Percs', single: 'Perc', target: 15 },
  { id: 'fx', folder: 'FX', single: 'FX', target: 10 },
  { id: 'vox', folder: 'Vox', single: 'Vox', target: 10 },
  { id: 'loops', folder: 'Loops', single: 'Loop', target: 0 }
] as const

export type SlotId = (typeof KIT_SLOTS)[number]['id']
export interface KitPick { id: number; auto: boolean }
export type Picks = Record<SlotId, KitPick[]>

export const emptyPicks = (): Picks => Object.fromEntries(KIT_SLOTS.map((s) => [s.id, []])) as unknown as Picks

const OPEN = /\bopens?\b|\bopen ?hats?\b|(^|[^a-z])oh(?![a-z])|\bcrash(es)?\b|\bcymbals?\b|\bride\b/i

/** Which slot a library sound belongs to, or null when it should not be offered (not a WAV, MIDI, melodic...). */
export function slotOf(s: Pick<SoundRow, 'k' | 'n' | 'e'>, dir = ''): SlotId | null {
  if (s.e !== 'wav') return null
  switch (s.k) {
    case 'kick': return 'kicks'
    case 'snare': return 'snares'
    case 'clap': return 'claps'
    case 'hat': return OPEN.test(`${s.n} ${dir.slice(dir.lastIndexOf('/') + 1)}`) ? 'opens' : 'hats'
    case '808': return '808s'
    case 'perc': return 'percs'
    case 'fx': return 'fx'
    case 'vocal': return 'vox'
    case 'loop': return 'loops'
    default: return null
  }
}

/** Candidate sounds per slot; files with the same name and size (the same sample reused across kits) appear once. */
export function candidates(items: SoundRow[], dirs: string[] = []): Record<SlotId, SoundRow[]> {
  const out = Object.fromEntries(KIT_SLOTS.map((s) => [s.id, [] as SoundRow[]])) as unknown as Record<SlotId, SoundRow[]>
  const seen = new Set<string>()
  for (const s of items) {
    const slot = slotOf(s, dirs[s.d])
    if (!slot) continue
    const key = `${slot}|${s.n.toLowerCase()}|${s.s}`
    if (seen.has(key)) continue
    seen.add(key)
    out[slot].push(s)
  }
  return out
}

/** Tops every slot up to its target with random unpicked candidates. Existing picks are kept. */
export function autoFill(picks: Picks, cands: Record<SlotId, SoundRow[]>, targets: Record<SlotId, number>, rand: () => number = Math.random): Picks {
  const next = { ...picks }
  for (const slot of KIT_SLOTS) {
    const have = new Set(next[slot.id].map((p) => p.id))
    const pool = cands[slot.id].filter((c) => !have.has(c.id))
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
    const need = Math.max(0, (targets[slot.id] ?? 0) - next[slot.id].length)
    next[slot.id] = [...next[slot.id], ...pool.slice(0, need).map((c) => ({ id: c.id, auto: true }))]
  }
  return next
}

/** Drops the auto-picked sounds so Auto-fill can draw a new set; hand-picks stay. */
export function clearAuto(picks: Picks): Picks {
  return Object.fromEntries(KIT_SLOTS.map((s) => [s.id, picks[s.id].filter((p) => !p.auto)])) as unknown as Picks
}

/** Safe for a file or folder name: no path separators or characters macOS and Windows reject. */
export function cleanName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
}

export const cleanTag = (t: string): string => cleanName(t).replace(/^@+/, '').replace(/\s+/g, '')

/** "Kick 01 @tag.wav". 808s carry their key and loops their tempo, when known. */
export function sampleName(slot: SlotId, index: number, total: number, row: Pick<SoundRow, 'y' | 'b'>, tag: string): string {
  const def = KIT_SLOTS.find((s) => s.id === slot)!
  const pad = String(Math.max(total, 1)).length
  const num = String(index + 1).padStart(Math.max(2, pad), '0')
  const extra = slot === '808s' && row.y ? ` ${displayKey(row.y)}` : slot === 'loops' && row.b ? ` ${Math.round(row.b)}BPM` : ''
  const t = cleanTag(tag)
  return `${def.single} ${num}${extra}${t ? ` @${t}` : ''}.wav`
}

export interface KitFile { slot: SlotId; folder: string; name: string; id: number }

/** The full rename plan for a kit, in slot order. */
export function planKit(picks: Picks, rows: Map<number, SoundRow>, tag: string): KitFile[] {
  const out: KitFile[] = []
  for (const slot of KIT_SLOTS) {
    const list = picks[slot.id].map((p) => rows.get(p.id)).filter((r): r is SoundRow => !!r)
    list.forEach((r, i) => out.push({ slot: slot.id, folder: slot.folder, name: sampleName(slot.id, i, list.length, r, tag), id: r.id }))
  }
  return out
}
