// Runs the whole YouTube flow for one beat: research, packaging, image, video, the BeatStars link gate and the upload.
import type Database from 'better-sqlite3'
import { app, nativeImage, safeStorage } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { beatProfile, suggestArtists, type KnownArtist } from '../shared/beatProfile'
import { describeProfile } from '../shared/styleProfile'
import { buildUploadMetadata } from '../shared/ytUpload'
import { COST, quotaAllows } from '../shared/ytQuota'
import { fileSafeTitle } from '../shared/videoFiles'
import { checkYouTubeMetadata, fillLink, validateBeatstarsUrl } from '../shared/ytPackage'
import { LINK_PLACEHOLDER, type PublishDraft, type SavedDraft, type YtDraftEdits, type YtPublishEdits, type YtPublishResult, type YtStatus } from '../shared/ytTypes'
import type { Content } from './content'
import type { Store } from './store'
import { exportStill } from './stillvideo'
import { packageBeat } from './ytpackage'
import type { ImagePool } from './imagepool'
import type { YtAuth } from './ytauth'
import type { YtResearch } from './ytresearch'
import { uploadVideo } from './youtube'
import { addQuota, getKv, getSecret, quotaUsed } from './ytkv'

const uniquePath = (dir: string, name: string): string => {
  let p = join(dir, name)
  for (let i = 2; existsSync(p); i++) p = join(dir, name.replace(/\.mp4$/, ` ${i}.mp4`))
  return p
}

export class YtPublisher {
  private work = join(app.getPath('userData'), 'yt-work')

  constructor(private db: Database.Database, private store: Store, private content: Content, private auth: YtAuth, private research: YtResearch, private pool: ImagePool) {}

  // ---- saved drafts: the review screen can be reopened from the Videos tab ----
  private writeDraft(videoId: number, s: SavedDraft): void {
    this.db.prepare('INSERT INTO yt_drafts(video_id,json,updated_at) VALUES(?,?,?) ON CONFLICT(video_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at')
      .run(videoId, JSON.stringify({ ...s, draft: { ...s.draft, previewData: '' } }), Date.now())
  }
  private readDraft(videoId: number): SavedDraft | null {
    const r = this.db.prepare('SELECT json FROM yt_drafts WHERE video_id=?').get(videoId) as { json: string } | undefined
    return r ? (JSON.parse(r.json) as SavedDraft) : null
  }
  loadDraft(videoId: number): SavedDraft {
    const s = this.readDraft(videoId)
    if (!s) throw new Error('This video has no saved details. Make it again from the YouTube tab.')
    if (!existsSync(s.draft.thumbPath) || !existsSync(s.draft.videoPath)) throw new Error('The saved files for this video are missing. Make it again from the YouTube tab.')
    return { ...s, draft: { ...s.draft, previewData: nativeImage.createFromPath(s.draft.thumbPath).resize({ width: 640 }).toDataURL() } }
  }
  saveEdits(videoId: number, edits: YtDraftEdits): void {
    const s = this.readDraft(videoId)
    if (s) this.writeDraft(videoId, { ...s, edits })
  }

  async status(): Promise<YtStatus> {
    const s = this.auth.status()
    return {
      signedIn: s.signedIn, hasClientId: s.hasClientId, hasAnthropicKey: !!getKv(this.db, 'anthropic_key'), encryptionOk: safeStorage.isEncryptionAvailable(),
      imagesLeft: this.store.getSettings().ytImageFolder ? this.pool.scan().unused : null, quotaToday: this.research.quotaToday()
    }
  }

  /** Every artist tag in the Vault with the genres and tempo range of the beats it is on. */
  private knownArtists(): KnownArtist[] {
    const m = new Map<string, { artist: string; genre: Set<string>; lo: number; hi: number }>()
    for (const b of this.store.listBeats()) {
      for (const a of b.tags.artist) {
        const e = m.get(a.toLowerCase()) ?? { artist: a, genre: new Set<string>(), lo: Infinity, hi: -Infinity }
        b.tags.genre.forEach((g) => e.genre.add(g))
        if (b.bpm != null) { e.lo = Math.min(e.lo, b.bpm); e.hi = Math.max(e.hi, b.bpm) }
        m.set(a.toLowerCase(), e)
      }
    }
    return [...m.values()].map((e) => ({ artist: e.artist, genre: [...e.genre], bpmRange: [e.lo, e.hi] as [number, number] }))
  }

  suggestArtists(beatId: number): string[] {
    const b = this.store.getBeat(beatId)
    return b ? suggestArtists(beatProfile({ ...b, thumb: b.thumb }), this.knownArtists()) : []
  }

  async prepare(beatId: number, artists: string[], onProgress: (label: string, pct: number) => void): Promise<PublishDraft> {
    const beat = this.store.getBeat(beatId)
    if (!beat) throw new Error('Beat not found.')
    if (beat.ext === 'flp' || beat.missing) throw new Error('This beat only exists as an FL project. Export a bounce first.')
    const settings = this.store.getSettings()
    if (!settings.ytImageFolder) throw new Error('Choose your image folder in Settings first.')
    const next = this.pool.scan().next
    if (!next) throw new Error('Add images to your image folder first.')

    const chosen = artists.map((a) => a.trim()).filter(Boolean)
    if (chosen.join('|') !== beat.tags.artist.join('|')) this.store.setTags(beatId, { ...beat.tags, artist: chosen })
    const profile = beatProfile({ ...beat, tags: { ...beat.tags, artist: chosen }, thumb: beat.thumb })

    onProgress('Studying top videos', 0.05)
    const style = await this.research.profileFor(chosen[0] ?? '')
    onProgress('Writing the title and description', 0.2)
    const pkg = await packageBeat({ beat: profile, style, producer: settings.producerName, apiKey: getSecret(this.db, 'anthropic_key'), year: new Date().getFullYear() })

    onProgress('Preparing the image', 0.3)
    const { framePath, thumbPath } = this.pool.prepare(next.path, this.work)
    mkdirSync(settings.exportDir, { recursive: true })
    const videoPath = uniquePath(settings.exportDir, `${fileSafeTitle(beat.title)} - YouTube.mp4`)
    await exportStill({ audioPath: beat.path, framePath, outPath: videoPath, durationSec: beat.duration ?? 0 }, (p) => onProgress('Making the video', 0.3 + p * 0.7))
    const videoId = Number(this.db.prepare('INSERT INTO videos(beat_id,format,path,created_at) VALUES(?,?,?,?)').run(beatId, 'youtube', videoPath, Date.now()).lastInsertRowid)
    const previewData = nativeImage.createFromPath(thumbPath).resize({ width: 640 }).toDataURL()
    const draft: PublishDraft = { previewData, videoId, beatId, imageHash: next.hash, imagePath: next.path, videoPath, thumbPath, artists: chosen, package: pkg, styleFindings: describeProfile(style) }
    this.writeDraft(videoId, { draft, edits: null, uploaded: null })
    return draft
  }

  async publish(draft: PublishDraft, edits: YtPublishEdits, onProgress: (label: string, pct: number) => void = () => {}): Promise<YtPublishResult> {
    const link = validateBeatstarsUrl(edits.link)
    if (!link.ok) throw new Error(link.reason)
    const title = edits.title.trim()
    const description = edits.description.includes(LINK_PLACEHOLDER) ? fillLink(edits.description, link.url) : `Lease / buy this beat: ${link.url}\n\n${edits.description}`
    const problems = checkYouTubeMetadata({ title, description, tags: edits.tags, hashtags: edits.hashtags })
    if (problems.length) throw new Error(problems[0])
    // another upload may have used this picture since the draft was made
    if (this.pool.isUsed(draft.imageHash)) throw new Error('That image was used by another upload in the meantime. Prepare this beat again.')
    if (!quotaAllows(quotaUsed(this.db), COST.upload + COST.thumbnail, 'upload')) throw new Error("YouTube's daily upload quota is used up. Try again after midnight Pacific time.")

    const publishAt = edits.publishAt ? new Date(edits.publishAt) : undefined
    const metadata = buildUploadMetadata({ title, description, tags: edits.tags, hashtags: edits.hashtags, publishAt })
    addQuota(this.db, 'upload', COST.upload)
    const r = await uploadVideo({ auth: this.auth, videoPath: draft.videoPath, thumbPath: draft.thumbPath, metadata }, (p) => onProgress('Uploading to YouTube', p))
    addQuota(this.db, 'upload', COST.thumbnail)

    // only now is the image spent, so a failed upload never burns one
    this.pool.markUsed(draft.imageHash, draft.imagePath, draft.beatId)
    this.content.savePost({ beatId: draft.beatId, platform: 'youtube', status: publishAt ? 'planned' : 'posted', date: publishAt?.getTime() ?? Date.now(), url: `https://www.youtube.com/watch?v=${r.videoId}`, caption: title })
    const saved = this.readDraft(draft.videoId)
    this.writeDraft(draft.videoId, { draft, edits: saved?.edits ?? null, uploaded: r })
    return r
  }
}
