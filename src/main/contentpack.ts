// One beat in, everything for posting out: a vertical clip, the full video, a YouTube draft to review, and planned posts.
// Nothing here publishes. Uploads stay in the review screen, where you add the link and press the button yourself.
import type { Beat, ContentPackRequest, ContentPackResult, Post, VideoOptions, VideoProgress } from '../shared/types'

export interface PackDeps {
  beat: (id: number) => Beat | null
  render: (o: VideoOptions, onProgress: (p: VideoProgress) => void) => Promise<string[]>
  videoIdOf: (path: string) => number | null
  draftBlocker: () => Promise<string | null>
  prepareDraft: (beatId: number, artists: string[], onProgress: (label: string, pct: number) => void, videoId: number) => Promise<{ videoId: number }>
  savePost: (p: Pick<Post, 'beatId' | 'platform' | 'status' | 'date'> & { caption: string }) => number
  footer: () => string
}

/** Shares of the whole job, so one progress bar covers every step. */
const STEPS = { vertical: [0, 0.3], full: [0.3, 0.85], draft: [0.85, 1] } as const
const within = (step: keyof typeof STEPS, pct: number) => STEPS[step][0] + pct * (STEPS[step][1] - STEPS[step][0])

export async function runContentPack(d: PackDeps, r: ContentPackRequest, onProgress: (p: VideoProgress) => void): Promise<ContentPackResult> {
  const beat = d.beat(r.beatId)
  if (!beat) throw new Error('Beat not found.')
  if (beat.ext === 'flp') throw new Error('This beat only exists as an FL project. Export a bounce first.')
  const look = { viz: r.look, accent: r.accent, title: beat.title, tagline: '', footer: d.footer() }
  const res: ContentPackResult = { files: [], draftVideoId: null, planned: 0, skipped: [] }

  if (r.vertical) {
    const out = await d.render({ ...look, beatId: beat.id, formats: ['vertical'], motion: 'drift', titles: 'intro', start: r.clipStart, length: r.clipLength }, (p) => onProgress({ label: `Clip: ${p.label}`, pct: within('vertical', p.pct) }))
    res.files.push(...out)
    for (const platform of r.plan) {
      d.savePost({ beatId: beat.id, platform: platform.platform, status: 'planned', date: platform.date, caption: beat.title })
      res.planned++
    }
  }

  let full: string | undefined
  if (r.full) {
    const out = await d.render({ ...look, beatId: beat.id, formats: ['horizontal'], motion: 'drift', titles: 'both', cta: 'Lease it: link in the description', start: 0, length: 0 }, (p) => onProgress({ label: `Full video: ${p.label}`, pct: within('full', p.pct) }))
    res.files.push(...out)
    full = out[0]
  }

  // A draft problem shouldn't cost you the videos that were just made, so it is reported rather than thrown.
  if (r.draft) {
    const videoId = full ? d.videoIdOf(full) : null
    const blocker = !videoId ? 'The YouTube draft needs the full video.' : !r.artists.length ? 'Add a type-beat artist to get a YouTube draft.' : await d.draftBlocker()
    if (blocker) res.skipped.push(blocker)
    else {
      try {
        const draft = await d.prepareDraft(beat.id, r.artists, (label, pct) => onProgress({ label: `YouTube: ${label}`, pct: within('draft', pct) }), videoId!)
        res.draftVideoId = draft.videoId
      } catch (e) { res.skipped.push(`YouTube draft: ${(e as Error).message}`) }
    }
  }
  onProgress({ label: 'Pack finished', pct: 1 })
  return res
}
