import { KIT_SLOTS, emptyPicks, type Picks, type SlotId } from './kitmaker'

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
