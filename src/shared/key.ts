export function normalizeKey(raw: string): string | null {
  const m = raw.trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(min(?:or)?|maj(?:or)?|m|M)?$/)
  if (!m) return null
  const note = m[1].toUpperCase() + m[2].replace('♯', '#').replace('♭', 'b')
  const q = m[3]
  const minor = q === 'm' || (q ? /^min/i.test(q) : false)
  return `${note} ${minor ? 'minor' : 'major'}`
}

/** "C# minor" -> "C#m", "E major" -> "E" */
export function displayKey(k: string | null): string {
  if (!k) return ''
  const [note, q] = k.split(' ')
  return q === 'minor' ? `${note}m` : note
}

const SHARP: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }
const CAM_MAJOR: Record<string, number> = { C: 8, G: 9, D: 10, A: 11, E: 12, B: 1, 'F#': 2, 'C#': 3, 'G#': 4, 'D#': 5, 'A#': 6, F: 7 }
const CAM_MINOR: Record<string, number> = { A: 8, E: 9, B: 10, 'F#': 11, 'C#': 12, 'G#': 1, 'D#': 2, 'A#': 3, F: 4, C: 5, G: 6, D: 7 }

/** "A minor" -> "8A", "C major" -> "8B" (the DJ wheel producers use to mix keys). */
export function camelot(k: string | null): string | null {
  if (!k) return null
  const [raw, q] = k.split(' ')
  const note = SHARP[raw] ?? raw
  const n = (q === 'minor' ? CAM_MINOR : CAM_MAJOR)[note]
  return n ? `${n}${q === 'minor' ? 'A' : 'B'}` : null
}

/** Same key, a step either way round the wheel, or the relative major/minor all blend well. */
export function keysCompatible(a: string | null, b: string | null): boolean {
  const x = camelot(a), y = camelot(b)
  if (!x || !y) return false
  const nx = parseInt(x, 10), ny = parseInt(y, 10), lx = x.slice(-1), ly = y.slice(-1)
  if (nx === ny) return true
  const step = Math.min((nx - ny + 12) % 12, (ny - nx + 12) % 12)
  return step === 1 && lx === ly
}

/** Tempos that work together: within 6%, or one is half/double the other. */
export function bpmCompatible(a: number | null, b: number | null): boolean {
  if (!a || !b) return false
  return [1, 2, 0.5].some((f) => Math.abs(a * f - b) / b <= 0.06)
}
