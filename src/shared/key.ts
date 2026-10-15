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
