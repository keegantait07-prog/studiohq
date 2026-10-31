// What the publisher knows about a beat, and which artists it probably sounds like.
import type { BeatProfile } from './ytTypes'

export interface BeatProfileInput { title: string; bpm: number | null; key: string | null; tags: { vibe: string[]; genre: string[]; artist: string[] }; thumb: number[] }
export interface KnownArtist { artist: string; genre: string[]; bpmRange: [number, number] }

export function beatProfile(b: BeatProfileInput): BeatProfile {
  // the app keeps a 48-point low-band waveform summary per beat; its mean level is the only loudness measure there is
  const mean = b.thumb.length ? b.thumb.reduce((a, x) => a + x, 0) / b.thumb.length : null
  const energy = mean == null ? null : mean < 0.25 ? 'low' : mean > 0.5 ? 'high' : 'medium'
  return { title: b.title, bpm: b.bpm, key: b.key, genre: b.tags.genre, vibe: b.tags.vibe, artist: b.tags.artist, energy }
}

/** Artists whose genres and tempo overlap the beat, best match first; ties keep the given order. */
export function suggestArtists(b: BeatProfile, known: KnownArtist[], limit = 3): string[] {
  const have = new Set(b.artist.map((a) => a.toLowerCase()))
  const genres = new Set(b.genre.map((g) => g.toLowerCase()))
  return known
    .filter((k) => !have.has(k.artist.toLowerCase()))
    .map((k, i) => ({ k, i, score: k.genre.filter((g) => genres.has(g.toLowerCase())).length + (b.bpm != null && b.bpm >= k.bpmRange[0] && b.bpm <= k.bpmRange[1] ? 1 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score || a.i - b2.i)
    .slice(0, limit)
    .map((x) => x.k.artist)
}
