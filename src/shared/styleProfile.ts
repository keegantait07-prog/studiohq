// Learns how successful type-beat channels package their videos. Pure: videos in, a StyleProfile out.
import type { StyleProfile, YtVideo } from './ytTypes'

const SEPARATORS = [' | ', ' - ', ' ~ ', ' // ']
const rate = (n: number, of: number) => (of ? n / of : 0)
/** the lower middle value, so an even count never invents a number between two real ones */
const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}
const count = <T>(xs: T[], key: (x: T) => string | null): Record<string, number> => {
  const m: Record<string, number> = {}
  for (const x of xs) {
    const k = key(x)
    if (k) m[k] = (m[k] ?? 0) + 1
  }
  return m
}
const top = (m: Record<string, number>, n: number): string[] =>
  Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([k]) => k)

function casingOf(title: string): 'title' | 'lower' | 'upper' | 'mixed' {
  const letters = title.replace(/[^A-Za-z]/g, '')
  if (!letters) return 'mixed'
  if (letters === letters.toUpperCase()) return 'upper'
  if (letters === letters.toLowerCase()) return 'lower'
  const words = title.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w))
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length
  return caps / words.length >= 0.6 ? 'title' : 'mixed'
}

const hashtagsOf = (s: string): string[] => (s.match(/#\w+/g) ?? []).map((h) => h.toLowerCase())

export function buildStyleProfile(videos: YtVideo[], scope: string): StyleProfile {
  const n = videos.length
  const brackets = count(videos, (v) => v.title.match(/^\s*([[(][^\])]{1,20}[\])])/)?.[1].toUpperCase() ?? null)
  const separators: Record<string, number> = {}
  for (const s of SEPARATORS) separators[s] = rate(videos.filter((v) => v.title.includes(s)).length, n)
  const casings = count(videos, (v) => casingOf(v.title))
  const casing = (['title', 'lower', 'upper', 'mixed'] as const).reduce((best, c) => ((casings[c] ?? 0) > (casings[best] ?? 0) ? c : best), 'mixed' as 'title' | 'lower' | 'upper' | 'mixed')

  const lines = videos.map((v) => v.description.split('\n'))
  const linkLines = lines.map((l) => l.findIndex((x) => /https?:\/\//.test(x)) + 1).filter((i) => i > 0)
  const tagCounts = videos.map((v) => v.tags.length)
  const tagChars = videos.map((v) => v.tags.join(',').length)
  const tagFreq = count(videos.flatMap((v) => [...new Set(v.tags.map((t) => t.toLowerCase()))]), (t) => t)
  const tagsPer = videos.map((v) => hashtagsOf(v.description))

  return {
    scope,
    sample: n,
    title: {
      medianLength: median(videos.map((v) => v.title.length)),
      bracketRate: Object.fromEntries(Object.entries(brackets).map(([k, c]) => [k, rate(c, n)])),
      yearRate: rate(videos.filter((v) => /\b20\d\d\b/.test(v.title)).length, n),
      quotedNameRate: rate(videos.filter((v) => /["“][^"”]+["”]/.test(v.title)).length, n),
      pairRate: rate(videos.filter((v) => /\S+ x \S+.*type beat/i.test(v.title)).length, n),
      separators,
      casing,
      emojiRate: rate(videos.filter((v) => /\p{Extended_Pictographic}/u.test(v.title)).length, n)
    },
    description: {
      medianLines: median(lines.map((l) => l.filter((x) => x.trim()).length)),
      linkLine: median(linkLines),
      hashtagBlockRate: rate(tagsPer.filter((h) => h.length).length, n),
      medianHashtags: median(tagsPer.map((h) => h.length))
    },
    tags: { medianCount: median(tagCounts), medianChars: median(tagChars), top: top(tagFreq, 20) },
    hashtags: { medianCount: median(tagsPer.map((h) => h.length)), top: top(count(tagsPer.flat(), (h) => h), 10) },
    examples: videos.slice(0, 8).map((v) => ({ title: v.title, description: v.description }))
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Plain-language findings for the review screen. */
export function describeProfile(p: StyleProfile): string[] {
  if (!p.sample) return ['No research yet.']
  const out = [`Based on ${p.sample} top videos.`]
  for (const [tag, r] of Object.entries(p.title.bracketRate).sort((a, b) => b[1] - a[1])) if (r >= 0.2) out.push(`${pct(r)} of titles use ${tag}.`)
  out.push(`Titles are about ${p.title.medianLength} characters, ${p.title.casing === 'lower' ? 'lower case' : p.title.casing === 'upper' ? 'upper case' : 'Title Case'}.`)
  if (p.title.yearRate >= 0.5) out.push(`${pct(p.title.yearRate)} include the year.`)
  if (p.title.quotedNameRate >= 0.5) out.push(`${pct(p.title.quotedNameRate)} put the beat name in quotes.`)
  const sep = Object.entries(p.title.separators).sort((a, b) => b[1] - a[1])[0]
  if (sep && sep[1] >= 0.3) out.push(`Most common separator: "${sep[0].trim()}" (${pct(sep[1])}).`)
  if (p.description.linkLine) out.push(`The link sits on line ${p.description.linkLine} of the description.`)
  if (p.description.hashtagBlockRate >= 0.5) out.push(`${p.description.medianHashtags} hashtags in the description.`)
  return out
}
