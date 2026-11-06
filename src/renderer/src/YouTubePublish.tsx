import { useEffect, useState } from 'react'
import type { Beat, Settings, VideoFile } from '@shared/types'
import { validateBeatstarsUrl } from '@shared/ytPackage'
import type { PublishDraft, YtPublishResult, YtStatus } from '@shared/ytTypes'

type Step = 'pick' | 'preparing' | 'review' | 'done'
interface Props { beat: Beat; settings: Settings | null; toast: (m: string) => void; reload: () => void; reloadBeats: () => void; /** reopen the saved details of this video (from the Videos tab) */ openVideoId?: number | null }

export function YouTubePublish({ beat, settings, toast, reload, reloadBeats, openVideoId }: Props) {
  const [step, setStep] = useState<Step>('pick')
  const [st, setSt] = useState<YtStatus | null>(null)
  const [artists, setArtists] = useState<string[]>(beat.tags.artist)
  const [artist, setArtist] = useState('')
  const [suggested, setSuggested] = useState<string[]>([])
  const [progress, setProgress] = useState({ label: '', pct: 0 })
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<PublishDraft | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [link, setLink] = useState('')
  const [schedule, setSchedule] = useState(false)
  const [when, setWhen] = useState('')
  const [result, setResult] = useState<YtPublishResult | null>(null)
  const [exports, setExports] = useState<VideoFile[]>([])
  const [reuse, setReuse] = useState<number | undefined>(undefined)

  useEffect(() => { window.api.ytStatus().then(setSt) }, [settings?.ytImageFolder, settings?.ytClientId])
  useEffect(() => { if (!beat.tags.artist.length) window.api.ytSuggestArtists(beat.id).then(setSuggested); return window.api.onYtProgress(setProgress) }, [beat.id])

  useEffect(() => { window.api.videosList().then((v) => setExports(v.filter((x) => x.beatId === beat.id && x.format === 'horizontal' && x.exists))) }, [beat.id])

  // reopen a saved video: its details come back exactly as they were left
  useEffect(() => {
    if (!openVideoId) return
    window.api.ytLoadDraft(openVideoId).then(({ draft: d, edits, uploaded }) => {
      setDraft(d); setArtists(d.artists)
      setTitle(edits?.title ?? d.package.titles[0] ?? ''); setDescription(edits?.description ?? d.package.description)
      setTags(edits?.tags ?? d.package.tags.join(', ')); setHashtags(edits?.hashtags ?? d.package.hashtags.join(' ')); setLink(edits?.link ?? '')
      if (uploaded) { setResult(uploaded); setStep('done') } else setStep('review')
    }).catch((e) => setErr(String((e as Error).message)))
  }, [openVideoId])
  // the link you already saved for this beat, so it isn't typed twice
  useEffect(() => {
    if (!draft || link) return
    window.api.siteStatus().then((s) => { const l = s.entries.find((e) => e.beatId === beat.id)?.link; if (l) setLink(l) }).catch(() => {})
  }, [draft?.videoId, beat.id])
  // keep what is typed, so leaving the screen never loses it
  useEffect(() => {
    if (!draft || step !== 'review') return
    const t = setTimeout(() => { window.api.ytSaveEdits(draft.videoId, { title, description, tags, hashtags, link }).catch(() => {}) }, 700)
    return () => clearTimeout(t)
  }, [draft, step, title, description, tags, hashtags, link])

  const addArtist = (v: string) => { const a = v.trim().toLowerCase(); if (a && !artists.map((x) => x.toLowerCase()).includes(a)) setArtists([...artists, a]); setArtist('') }
  const blocker = !st ? 'Loading…'
    : !st.hasClientId || !st.signedIn ? 'Sign in to Google in Settings first (⌘,).'
    : st.imagesLeft == null ? 'Choose your image folder in Settings first (⌘,).'
    : st.imagesLeft === 0 ? 'Your image folder has no unused images. Add some in Settings.'
    : ''
  const linkCheck = validateBeatstarsUrl(link)
  const whenMs = schedule && when ? new Date(when).getTime() : undefined
  const scheduleBad = schedule && (!whenMs || whenMs < Date.now() + 15 * 60_000)

  const prepare = async () => {
    setErr(''); setStep('preparing'); setProgress({ label: 'Starting', pct: 0 })
    try {
      const d = await window.api.ytPrepare(beat.id, artists, reuse)
      setDraft(d); setTitle(d.package.titles[0] ?? ''); setDescription(d.package.description)
      setTags(d.package.tags.join(', ')); setHashtags(d.package.hashtags.join(' '))
      reloadBeats(); setStep('review')
    } catch (e) { setErr(String((e as Error).message)); setStep('pick') }
  }
  const publish = async () => {
    if (!draft || !linkCheck.ok) return
    setErr(''); setStep('preparing'); setProgress({ label: 'Uploading to YouTube', pct: 0 })
    try {
      const r = await window.api.ytPublish(draft, {
        title, description, link, publishAt: whenMs,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean), hashtags: hashtags.split(/\s+/).filter(Boolean)
      })
      setResult(r); reload(); toast('Uploaded to YouTube as private'); setStep('done')
    } catch (e) { setErr(String((e as Error).message)); setStep('review') }
  }

  if (step === 'preparing') return (
    <div className="ytp"><h3>{progress.label}…</h3><div className="yt-bar"><i style={{ width: `${Math.round(progress.pct * 100)}%` }} /></div></div>
  )

  if (step === 'done' && result) return (
    <div className="ytp">
      <h3>Uploaded as private</h3>
      <p className="help">Open YouTube Studio, check it over and press Publish.</p>
      {result.thumbnailError && <p className="help warn">The video is up, but the thumbnail was not set: {result.thumbnailError} Set it in YouTube Studio.</p>}
      <div className="draft-actions"><button className="primary" onClick={() => window.api.ytOpenStudio(result.studioUrl)}>Open YouTube Studio</button><button onClick={() => { setStep('pick'); setDraft(null); setLink(''); setResult(null) }}>Done</button></div>
    </div>
  )

  if (draft && step === 'review') return (
    <div className="ytp">
      <img className="yt-img" src={draft.previewData} alt="Video image" />
      <div className="draft-actions" style={{ marginTop: 6 }}><button onClick={() => window.api.revealPath(draft.videoPath)}>Show the video file</button><span className="dim">The video is this image for the whole beat.</span></div>
      {draft.package.source === 'template' && <p className="help warn">Written from the built-in templates (no Anthropic key, or Claude did not give a usable answer).</p>}
      <h3>Title</h3>
      {draft.package.titles.map((t) => <label key={t} className="check"><input type="radio" checked={title === t} onChange={() => setTitle(t)} /> {t}</label>)}
      <div className="titlerow"><input value={title} onChange={(e) => setTitle(e.target.value)} /><span className={title.length > 100 ? 'warn mono' : 'dim mono'}>{title.length}/100</span></div>
      <h3>Description</h3>
      <p className="help">The BeatStars link you paste below replaces the marker <code>{'{{BEATSTARS_LINK}}'}</code>.</p>
      <textarea rows={10} value={description} onChange={(e) => setDescription(e.target.value)} />
      <h3>Tags <span className="dim">({tags.length}/480)</span></h3>
      <textarea rows={3} value={tags} onChange={(e) => setTags(e.target.value)} />
      <h3>Hashtags</h3>
      <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
      <h3>What the research found</h3>
      <ul className="help">{draft.styleFindings.map((f) => <li key={f}>{f}</li>)}</ul>

      <div className="yt-sticky">
        <div className="field" style={{ margin: 0 }}>
          <label>BeatStars link (required)</label>
          <input value={link} placeholder="https://www.beatstars.com/beat/…" onChange={(e) => setLink(e.target.value)} />
          {link.trim() && !linkCheck.ok && <span className="help warn" style={{ margin: 0 }}>{linkCheck.reason}</span>}
        </div>
        <label className="check"><input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} /> Schedule it (stays private until then)</label>
        {schedule && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
        {scheduleBad && <span className="help warn" style={{ margin: 0 }}>Pick a time at least 15 minutes from now.</span>}
        {err && <span className="help warn" style={{ margin: 0 }}>{err}</span>}
        <div className="draft-actions" style={{ margin: 0 }}>
          <button className="primary" disabled={!linkCheck.ok || scheduleBad || !title.trim() || title.length > 100} onClick={publish}>Upload to YouTube</button>
          <button onClick={() => { setStep('pick'); setDraft(null) }}>Start over</button>
          {!linkCheck.ok && <span className="dim">Paste the BeatStars link to enable Upload.</span>}
        </div>
      </div>
    </div>
  )

  return (
    <div className="ytp">
      <h3>Type-beat artists</h3>
      <div className="chips">
        {artists.map((a) => <span key={a} className="chip artist">{a}<button onClick={() => setArtists(artists.filter((x) => x !== a))}>×</button></span>)}
        <input value={artist} placeholder="e.g. future, gunna" onChange={(e) => setArtist(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addArtist(artist) } }} />
      </div>
      {!artists.length && suggested.length > 0 && <p className="help">Sounds like: {suggested.map((a) => <button key={a} className="ghost" onClick={() => addArtist(a)}>+ {a}</button>)}</p>}
      {exports.length > 0 && (
        <div className="field">
          <label>Video to upload</label>
          <select value={reuse ?? ''} onChange={(e) => setReuse(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">New video from a still image</option>
            {exports.map((v) => <option key={v.id} value={v.id}>Your export from {new Date(v.createdAt).toLocaleDateString()}</option>)}
          </select>
        </div>
      )}
      {!artists.length && <p className="help">Add 1–2 artists this beat sounds like. The research is done on them.</p>}
      {st?.imagesLeft != null && st.imagesLeft > 0 && st.imagesLeft < 5 && <p className="help warn">Only {st.imagesLeft} unused image{st.imagesLeft === 1 ? '' : 's'} left in your image folder.</p>}
      {blocker && <p className="help warn">{blocker}</p>}
      {err && <p className="help warn">{err}</p>}
      <div className="draft-actions"><button className="primary" disabled={!!blocker || !artists.length} onClick={prepare}>Research, write and make the video</button></div>
    </div>
  )
}
