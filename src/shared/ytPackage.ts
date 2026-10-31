// Prompt, validation and fallback for the YouTube packaging step, plus the BeatStars link gate. Pure.
import { generateCopy } from './typebeat'
import { describeProfile } from './styleProfile'
import { LINK_PLACEHOLDER, type BeatProfile, type PackageDraft, type StyleProfile } from './ytTypes'

const TITLE_MAX = 100
const TAGS_MAX = 480
const HOSTS = new Set(['beatstars.com', 'www.beatstars.com'])
const URL_RE = /https?:\/\//i

export function validateBeatstarsUrl(input: string): { ok: true; url: string } | { ok: false; reason: string } {
  const s = input.trim()
  if (!s) return { ok: false, reason: 'Paste the BeatStars link for this beat.' }
  let u: URL
  try { u = new URL(s) } catch { return { ok: false, reason: 'That is not a web address.' } }
  if (u.protocol !== 'https:') return { ok: false, reason: 'The link must start with https://.' }
  if (!HOSTS.has(u.hostname)) return { ok: false, reason: 'The link must be on beatstars.com.' }
  return { ok: true, url: s }
}

export function fillLink(description: string, url: string): string {
  return description.split(LINK_PLACEHOLDER).join(url)
}

export function buildPrompt(beat: BeatProfile, style: StyleProfile, producer: string): { system: string; user: string } {
  const system = [
    'You write the YouTube packaging for a type beat video.',
    'Reply with JSON only, no other text: {"titles": [5 strings], "description": string, "tags": [strings], "hashtags": [strings]}.',
    `The description must contain the text ${LINK_PLACEHOLDER} exactly once, where the buy link belongs, and no other URL anywhere.`,
    'Follow the style findings you are given. The example videos only show that style: never copy an example title or description.',
    `Every title is at most ${TITLE_MAX} characters. The tags together are at most ${TAGS_MAX} characters.`
  ].join('\n')
  const examples = style.examples.slice(0, 8).map((e) => `Example title: ${e.title}\nExample description:\n${e.description.slice(0, 600)}\n`).join('\n')
  const user = [
    `Producer: ${producer || 'unknown'}`,
    `Beat: "${beat.title}"`,
    `Tempo: ${beat.bpm ? `${Math.round(beat.bpm)} BPM` : 'unknown'}; key: ${beat.key ?? 'unknown'}; energy: ${beat.energy ?? 'unknown'}`,
    `Genre: ${beat.genre.join(', ') || 'unknown'}; mood: ${beat.vibe.join(', ') || 'unknown'}`,
    `Type-beat artists: ${beat.artist.join(', ') || 'none given'}`,
    '',
    `What top videos like this do (${style.scope}):`,
    ...describeProfile(style).map((l) => `- ${l}`),
    `- Typical tag count ${style.tags.medianCount}; common tags: ${style.tags.top.slice(0, 10).join(', ')}`,
    '',
    examples
  ].join('\n')
  return { system, user }
}

const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string')

export function parsePackage(raw: string): PackageDraft | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  const o = j as Record<string, unknown> | null
  if (!o || !strings(o.titles) || !o.titles.length || typeof o.description !== 'string' || !strings(o.tags) || !strings(o.hashtags)) return null
  return { titles: o.titles.map((t) => t.trim()), description: o.description, tags: o.tags.map((t) => t.trim()).filter(Boolean), hashtags: o.hashtags.map((t) => t.trim()).filter(Boolean), source: 'claude' }
}

/** Problems that make a package unusable; empty means it is fine. */
export function validatePackage(p: PackageDraft, exampleTitles: string[]): string[] {
  const out: string[] = []
  if (p.titles.length < 3) out.push('Need at least 3 titles.')
  p.titles.forEach((t, i) => {
    if (!t) out.push(`Title ${i + 1} is empty.`)
    else if (t.length > TITLE_MAX) out.push(`Title ${i + 1} is too long (${t.length} characters, the limit is ${TITLE_MAX}).`)
  })
  const placeholders = p.description.split(LINK_PLACEHOLDER).length - 1
  if (placeholders !== 1) out.push(`The description must contain the link placeholder exactly once (found ${placeholders}).`)
  const withoutPlaceholder = p.description.split(LINK_PLACEHOLDER).join('')
  if ([...p.titles, withoutPlaceholder, ...p.tags, ...p.hashtags].some((s) => URL_RE.test(s))) out.push('Contains a URL. The only link allowed is the placeholder.')
  if (p.tags.join(',').length > TAGS_MAX) out.push(`The tags are too long (the limit is ${TAGS_MAX} characters).`)
  const seen = new Set(exampleTitles.map((t) => t.trim().toLowerCase()))
  if (p.titles.some((t) => seen.has(t.trim().toLowerCase()))) out.push('A title copies an example video.')
  return out
}

/** The offline template package, with the link placeholder on the first line. */
export function fallbackPackage(beat: BeatProfile, producer: string, year: number): PackageDraft {
  const c = generateCopy(
    { title: beat.title, bpm: beat.bpm, key: beat.key, genre: beat.genre, vibe: beat.vibe, artist: beat.artist },
    { producer, storeUrl: '', email: '', hashtags: '' },
    { free: true, year }
  )
  return { titles: c.titles.map((t) => t.slice(0, TITLE_MAX)), description: `Lease / buy this beat: ${LINK_PLACEHOLDER}\n\n${c.description}`, tags: c.tags, hashtags: c.hashtags, source: 'template' }
}
