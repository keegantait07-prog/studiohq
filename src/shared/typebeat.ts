// Turns a beat's metadata into type-beat titles, a description, tags and social captions. Pure text templates, no network.
export interface CopyBeat { title: string; bpm: number | null; key: string | null; genre: string[]; vibe: string[]; artist: string[] }
export interface CopyProfile { producer: string; storeUrl: string; email: string; hashtags: string }
export interface CopyOptions { free: boolean; year: number }
export interface Copy { titles: string[]; description: string; tags: string[]; hashtags: string[]; caption: string; missingArtists: boolean }

const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())
const keyLabel = (k: string | null) => (k ? (k.endsWith('minor') ? `${k.split(' ')[0]} minor` : `${k.split(' ')[0]} major`) : '')
const compact = (s: string) => s.replace(/[^a-z0-9]/gi, '')
const uniq = (a: string[]) => [...new Set(a.map((x) => x.trim()).filter(Boolean))]

/** YouTube counts a tag that contains a space as quoted (2 more characters), plus a comma between tags. */
export function youtubeTagLength(tags: string[]): number {
  return tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1)
}

export function ytTitleLimit(t: string): { text: string; over: number } {
  return { text: t, over: Math.max(0, t.length - 100) }
}

export function generateCopy(b: CopyBeat, p: CopyProfile, o: CopyOptions): Copy {
  const artists = b.artist.map(cap)
  const [a1, a2] = artists
  const duo = a1 && a2 ? `${a1} x ${a2}` : a1 ?? ''
  const genre = cap(b.genre[0] ?? '')
  const vibe = cap(b.vibe[0] ?? '')
  const free = o.free ? '[FREE] ' : ''
  const bpm = b.bpm ? `${Math.round(b.bpm)} BPM` : ''
  const key = keyLabel(b.key)
  const q = `"${b.title}"`
  const prod = p.producer ? ` | Prod. ${p.producer}` : ''

  const titles: string[] = a1
    ? [
        `${free}${duo} Type Beat ${o.year} - ${q} | ${[vibe, genre].filter(Boolean).join(' ')} Instrumental`,
        `${free}${a1} Type Beat - ${q}${bpm ? ` (${bpm}${key ? ` ${key}` : ''})` : ''}`,
        `${free}${duo} Type Beat ${o.year} | ${q}${prod}`,
        `${free}${[vibe, genre].filter(Boolean).join(' ')} Type Beat ${o.year} - ${q} (${a1} Type Beat)`,
        `${a1} type beat ${o.year} - ${q}${bpm ? ` ${bpm}` : ''}`
      ]
    : [
        `${free}${[vibe, genre].filter(Boolean).join(' ')} Type Beat ${o.year} - ${q} | Instrumental${prod}`,
        `${free}${genre} Type Beat - ${q}${bpm ? ` (${bpm}${key ? ` ${key}` : ''})` : ''}`,
        `${free}${q} - ${[vibe, genre].filter(Boolean).join(' ')} Instrumental ${o.year}`
      ]

  const tidy = (t: string) => t.replace(/\s{2,}/g, ' ').replace(/\(\s*\)/g, '').replace(/\|\s*\|/g, '|').trim()
  for (let i = 0; i < titles.length; i++) titles[i] = tidy(titles[i])

  const tagSet: string[] = []
  for (const a of artists) tagSet.push(`${a} type beat`, `${a} type beat ${o.year}`, `free ${a} type beat`, `${a} instrumental`)
  if (a1 && a2) tagSet.push(`${a1} x ${a2} type beat`)
  for (const g of b.genre) tagSet.push(`${g} type beat`, `${g} instrumental`, `${g} beat`)
  for (const v of b.vibe) tagSet.push(`${v} type beat`, `${v} beat`)
  tagSet.push('type beat', `type beat ${o.year}`, 'free type beat', 'instrumental', 'beats for sale', 'rap instrumental')
  if (b.bpm) tagSet.push(`${Math.round(b.bpm)} bpm`)
  if (b.key) tagSet.push(`${keyLabel(b.key)} beat`)
  const tags: string[] = []
  for (const t of uniq(tagSet.map((x) => x.toLowerCase()))) {
    if (youtubeTagLength([...tags, t]) > 480) break // YouTube allows 500 characters of tags
    tags.push(t)
  }

  const tagWords = (x: string) => compact(x).toLowerCase()
  const hashtags = uniq([
    '#typebeat',
    ...b.genre.map((g) => `#${tagWords(g)}`),
    ...artists.map((a) => `#${tagWords(a)}typebeat`),
    ...b.vibe.map((v) => `#${tagWords(v)}`),
    ...p.hashtags.split(/\s+/).filter((h) => h.startsWith('#'))
  ]).slice(0, 15)

  const meta = [bpm, key].filter(Boolean).join(' | ')
  const description = [
    o.free ? 'Free for non-profit use. Credit required: (prod. ' + (p.producer || 'me') + ')' : '',
    p.storeUrl ? `Lease / buy this beat: ${p.storeUrl}` : '',
    '',
    `${q}${duo ? ` - ${duo} type beat` : ''}`,
    [genre && `${genre}`, meta].filter(Boolean).join(' | '),
    b.vibe.length ? `Mood: ${b.vibe.map(cap).join(', ')}` : '',
    '',
    p.email ? `Business / custom beats: ${p.email}` : '',
    p.producer ? `Produced by ${p.producer}` : '',
    '',
    hashtags.slice(0, 6).join(' ')
  ].filter((l, i, a) => !(l === '' && (i === 0 || a[i - 1] === ''))).join('\n').trim()

  const caption = [`${q}${a1 ? ` | ${duo} type beat` : ''}`, meta, p.storeUrl ? 'Link in bio to lease' : '', '', hashtags.join(' ')].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim()

  return { titles, description, tags, hashtags, caption, missingArtists: artists.length === 0 }
}
