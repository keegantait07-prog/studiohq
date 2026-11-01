import { KIT_SLOTS, emptyPicks, soundKey, type Picks, type SlotId } from './kitmaker'
import type { SoundRow } from './types'

export interface SavedKit { id: string; name: string; tag: string; outDir: string; picks: Picks; targets: Record<SlotId, number>; updated: number }

export const defaultTargets = (): Record<SlotId, number> => Object.fromEntries(KIT_SLOTS.map((s) => [s.id, s.target])) as Record<SlotId, number>

export function newKit(name: string, tag = '', outDir = '', now = Date.now()): SavedKit {
  return { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, tag, outDir, picks: emptyPicks(), targets: defaultTargets(), updated: now }
}

/** Anything unreadable in storage becomes a usable kit instead of an error. */
export function sanitize(k: Partial<SavedKit> | null | undefined, now = Date.now()): SavedKit {
  const base = newKit(k?.name || 'My Drum Kit', k?.tag ?? '', k?.outDir ?? '', now)
  return { ...base, id: k?.id || base.id, picks: { ...emptyPicks(), ...(k?.picks ?? {}) }, targets: { ...defaultTargets(), ...(k?.targets ?? {}) }, updated: k?.updated ?? now }
}

export function upsert(kits: SavedKit[], kit: SavedKit): SavedKit[] {
  return kits.some((k) => k.id === kit.id) ? kits.map((k) => (k.id === kit.id ? kit : k)) : [...kits, kit]
}

/** "My Kit" -> "My Kit 2" when the name is taken, so two saved kits are never confusable. */
export function uniqueName(kits: SavedKit[], name: string): string {
  const taken = new Set(kits.map((k) => k.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`
}

/** Undo/redo for the picks. Each change pushes the previous picks; a new change clears redo. */
export interface History<T> { past: T[]; future: T[] }
export const emptyHistory = <T,>(): History<T> => ({ past: [], future: [] })
export function record<T>(h: History<T>, prev: T, limit = 60): History<T> { return { past: [...h.past, prev].slice(-limit), future: [] } }
export function undo<T>(h: History<T>, cur: T): { h: History<T>; value: T } | null {
  if (!h.past.length) return null
  return { value: h.past[h.past.length - 1], h: { past: h.past.slice(0, -1), future: [cur, ...h.future] } }
}
export function redo<T>(h: History<T>, cur: T): { h: History<T>; value: T } | null {
  if (!h.future.length) return null
  return { value: h.future[0], h: { past: [...h.past, cur], future: h.future.slice(1) } }
}

/** Which of the other saved kits already use each sample (matched by name and size, so a copy of the same file counts). */
export function usageByKey(kits: SavedKit[], activeId: string, rows: Map<number, SoundRow>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const k of kits) {
    if (k.id === activeId) continue
    const seen = new Set<string>()
    for (const slot of KIT_SLOTS) for (const p of k.picks[slot.id] ?? []) {
      const r = rows.get(p.id)
      if (!r) continue
      const key = soundKey(r)
      if (seen.has(key)) continue
      seen.add(key)
      out.set(key, [...(out.get(key) ?? []), k.name])
    }
  }
  return out
}
