// Reads hints out of bounce filenames, e.g.
// "(Ambient, Trap, Dark) GHOST (148bpm, C#min) @prodbysmalls x @yxellix.mp3"
import { basename, extname } from 'path'
import { normalizeKey } from '../shared/key'

const GENRES = new Set([
  'trap', 'drill', 'rnb', 'r&b', 'hiphop', 'hip hop', 'edm', 'house', 'dnb', 'phonk', 'afro', 'afrobeat', 'latin', 'reggaeton',
  'pop', 'hyperpop', 'rage', 'jersey', 'ambient', 'techno', 'trance', 'dubstep', 'bass house', 'future bounce', 'jazz', 'lofi', 'plugg', 'pluggnb', 'opium'
])

export interface NameHints {
  title: string
  bpm: number | null
  key: string | null
  vibe: string[]
  genre: string[]
  credits: string[]
  versionLabel: string
  groupKey: string
}

export function parseName(file: string, folderName: string, ownHandles: string[]): NameHints {
  let s = basename(file, extname(file))
  const credits: string[] = []
  s = s.replace(/@([\w.]+)/g, (_, raw: string) => {
    const h = raw.replace(/\.(mp3|wav|flac|m4a|aiff?|ogg)$/i, '').replace(/\.+$/, '')
    if (!/^prodby/i.test(h) && !ownHandles.includes(h.toLowerCase())) credits.push('@' + h.toLowerCase())
    return ' '
  })

  let bpm: number | null = null
  let key: string | null = null
  const bpmM = s.match(/(\d{2,3}(?:\.\d+)?)\s*bpm/i)
  if (bpmM) bpm = parseFloat(bpmM[1])
  const afterBpm = s.match(/bpm[\s,)\-]*([A-Ga-g][#b♯♭]?\s?(?:min(?:or)?|maj(?:or)?|m)?)(?![a-z])/i)
  if (afterBpm) key = normalizeKey(afterBpm[1])
  if (!key) {
    const k2 = s.match(/(?<![A-Za-z])([A-Ga-g][#b]?)\s?(min(?:or)?|maj(?:or)?)(?![a-z])/i)
    if (k2) key = normalizeKey(k2[1] + k2[2])
  }

  const vibe: string[] = []
  const genre: string[] = []
  const lead = s.match(/^\s*\(([^)]*)\)/)
  if (lead && !/bpm/i.test(lead[1])) {
    for (const raw of lead[1].split(',')) {
      const t = raw.trim().toLowerCase()
      if (t) (GENRES.has(t) ? genre : vibe).push(t)
    }
    s = s.slice(lead[0].length)
  }

  s = s.replace(/\([^)]*bpm[^)]*\)/gi, ' ').replace(/\[[^\]]*bpm[^\]]*\]/gi, ' ').replace(/\d{2,3}(?:\.\d+)?\s*bpm/gi, ' ')
  s = s.replace(/(?<![A-Za-z])[A-Ga-g][#b]?\s?(?:min(?:or)?|maj(?:or)?)(?![a-z])/gi, ' ')

  let versionLabel = ''
  const paren = [...s.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim())
  const vm = s.match(/\bv(\d+)\b/i)
  if (vm) versionLabel = 'v' + vm[1]
  else if (/\bstems?\b/i.test(s) || /stems/i.test(folderName)) versionLabel = 'stems'
  else if (/\bfinal\b/i.test(s)) versionLabel = 'final'
  else if (paren.length && /mix|empty|instrumental|inst\b|acapella|demo|clean|stripped|alt|remix|\bid\b/i.test(paren[paren.length - 1])) versionLabel = paren[paren.length - 1].toLowerCase()

  let core = s
    .replace(/\.(mp3|wav|flac|m4a|aiff?)\b/gi, ' ')
    .replace(/(^|\s)[+&](?=\s|$)/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(v\d+|final|stems?)\b/gi, ' ')
    .replace(/\s+x\s*$/i, ' ')
    .replace(/[\s\-–_,]+/g, ' ')
    .replace(/(^\s*x\s+|\s+x\s*$)/gi, ' ')
    .trim()
  // "Artist - Title" bounces keep the full text; otherwise tidy it
  if (!core) core = basename(file, extname(file))
  const groupKey = core.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return { title: core, bpm, key, vibe, genre, credits, versionLabel, groupKey }
}

export function genreFromFolder(folderName: string): string | null {
  const g = folderName.replace(/^[!\s]+/, '').trim().toLowerCase()
  if (!g || /^(beats|ideas|ideas : scraps|ideas: scraps|midi stuff|september beats \d+)$/.test(g)) return null
  return g
}
