import type { Beat, Status } from '@shared/types'
import { STATUSES } from '@shared/types'
import { normalizeKey } from '@shared/key'

export interface Parsed {
  chips: string[]
  test: (b: Beat) => boolean
}

const STATUS_WORDS: Record<string, (s: Status) => boolean> = {
  idea: (s) => s === 'idea', wip: (s) => s === 'wip', finished: (s) => s === 'finished', sent: (s) => s === 'sent', sold: (s) => s === 'sold',
  unsold: (s) => s !== 'sold', unsent: (s) => s !== 'sent' && s !== 'sold', unfinished: (s) => s === 'idea' || s === 'wip'
}

/** "dark, 140+ BPM, unsold, finished" -> predicate. Every clause must match. */
export function parseQuery(q: string): Parsed {
  const tests: ((b: Beat) => boolean)[] = []
  const chips: string[] = []
  const texts: string[] = []

  for (const raw of q.split(',')) {
    const c = raw.trim().toLowerCase()
    if (!c) continue
    let m: RegExpMatchArray | null
    if ((m = c.match(/^(\d{2,3})\s*\+\s*(?:bpm)?$/))) {
      const n = +m[1]; tests.push((b) => b.bpm != null && b.bpm >= n); chips.push(`BPM ≥ ${n}`)
    } else if ((m = c.match(/^(?:<|under\s*)\s*(\d{2,3})\s*(?:bpm)?$/))) {
      const n = +m[1]; tests.push((b) => b.bpm != null && b.bpm <= n); chips.push(`BPM ≤ ${n}`)
    } else if ((m = c.match(/^(\d{2,3})\s*-\s*(\d{2,3})\s*(?:bpm)?$/))) {
      const lo = +m[1], hi = +m[2]; tests.push((b) => b.bpm != null && b.bpm >= lo && b.bpm <= hi); chips.push(`BPM ${lo}–${hi}`)
    } else if ((m = c.match(/^(\d{2,3})\s*bpm$/))) {
      const n = +m[1]; tests.push((b) => b.bpm != null && Math.abs(b.bpm - n) <= 1.5); chips.push(`BPM ${n}`)
    } else if (STATUS_WORDS[c]) {
      const f = STATUS_WORDS[c]; tests.push((b) => f(b.status)); chips.push(c)
    } else if ((m = c.match(/^(?:key:?\s*)?([a-g][#b]?\s?(?:m|min|minor|maj|major)?)$/)) && (c.startsWith('key') || /[#]|m|maj|min/.test(c.slice(1)))) {
      const k = normalizeKey(m[1]); if (k) { tests.push((b) => b.key === k); chips.push(`key ${k}`) }
    } else {
      for (const w of c.split(/\s+/)) texts.push(w)
    }
  }
  if (texts.length) {
    chips.push(...texts.map((t) => `“${t}”`))
    tests.push((b) => {
      const hay = [b.title, b.filename, b.credits, b.versionLabel, b.folder.split('/').pop(), ...b.tags.vibe, ...b.tags.genre, ...b.tags.artist].join(' ').toLowerCase()
      return texts.every((t) => hay.includes(t))
    })
  }
  return { chips, test: (b) => tests.every((t) => t(b)) }
}

export function isStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s)
}
