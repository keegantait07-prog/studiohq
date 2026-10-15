import { useEffect, useMemo, useRef, useState } from 'react'
import { artPng } from './genart'
import type { Beat, BeatDetail, Settings, VideoExport, VideoFormat, VideoLook, VideoMotion, VideoProgress, VizStyle } from '@shared/types'
import { LAYOUT, previewWaveSvg } from '@shared/videoTemplate'
import { displayKey } from '@shared/key'
import { Waveform } from './Waveform'
import { bestSection } from './suggest'
import { errMsg } from './salesUtils'
import { fmtDur } from './format'

const ACCENTS = ['#ff6b3d', '#3987e5', '#1baf7a', '#e87ba4', '#eda100', '#9085e9', '#ffffff']
const LOOKS: { id: VideoLook; label: string }[] = [{ id: 'classic', label: 'Classic' }, { id: 'minimal', label: 'Minimal' }, { id: 'poster', label: 'Poster' }]
const VIZ: { id: VizStyle; label: string; hint: string }[] = [
  { id: 'mirror', label: 'Mirror bars', hint: 'Classic bars from the centre line' },
  { id: 'bars', label: 'Bars', hint: 'Rounded bars from the floor' },
  { id: 'line', label: 'Waveform', hint: 'The real waveform, drawn live' },
  { id: 'ribbon', label: 'Ribbon', hint: 'A smooth glowing mountain range' },
  { id: 'led', label: 'LED stack', hint: 'Hi-fi analyser cells with falling peak caps' },
  { id: 'dots', label: 'Beads', hint: 'Columns of round dots that swell' },
  { id: 'sonar', label: 'Sonar', hint: 'Every kick sends a ring across the frame' },
  { id: 'aurora', label: 'Aurora', hint: 'Four drifting light ribbons, driven by bass, mids and highs' },
  { id: 'pulse', label: 'Heartbeat', hint: 'A monitor line that spikes on every kick' },
  { id: 'sparks', label: 'Sparks', hint: 'Kicks throw embers that fall back down' }
]
const MOTIONS: { id: VideoMotion; label: string; hint: string }[] = [
  { id: 'still', label: 'Still', hint: 'The frame stays put' },
  { id: 'drift', label: 'Slow push-in', hint: 'A gentle zoom across the whole clip' },
  { id: 'breathe', label: 'Breathe', hint: 'A steady in-and-out, 4 seconds a cycle' },
  { id: 'beat', label: 'Beat bounce', hint: 'The frame thumps on the beat, locked to the beat\u2019s tempo' }
]
const LENGTHS = [15, 30, 45, 60, 90, 0]

interface Prefs { look: VideoLook; viz: VizStyle; motion: VideoMotion; accent: string; formats: VideoFormat[]; length: number }
const DEFAULTS: Prefs = { look: 'classic', viz: 'mirror', motion: 'still', accent: '#ff6b3d', formats: ['vertical'], length: 30 }
const loadPrefs = (): Prefs => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('shq-video') ?? '{}') } } catch { return DEFAULTS } }

interface Props {
  beat: Beat
  settings: Settings | null
  videos: VideoExport[]
  onPlayAt: (id: number, at: number) => void
  onExported: () => void
  toast: (m: string) => void
}

export function VideoBuilder({ beat, settings, videos, onPlayAt, onExported, toast }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const set = (p: Partial<Prefs>) => setPrefs((x) => { const n = { ...x, ...p }; try { localStorage.setItem('shq-video', JSON.stringify(n)) } catch { /* ignore */ } return n })
  const defaultTag = beat.tags.artist.length ? `${beat.tags.artist.slice(0, 2).map((a) => a.replace(/\b\w/g, (c) => c.toUpperCase())).join(' x ')} type beat` : [beat.bpm ? `${Math.round(beat.bpm)} BPM` : '', displayKey(beat.key)].filter(Boolean).join(' · ')
  const [title, setTitle] = useState(beat.title)
  const [tagline, setTagline] = useState(defaultTag)
  const [footer, setFooter] = useState(settings?.producerName ? `prod. ${settings.producerName}` : '')
  const [start, setStart] = useState(0)
  const [previewFmt, setPreviewFmt] = useState<VideoFormat>('vertical')
  const [still, setStill] = useState<string | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [detail, setDetail] = useState<BeatDetail | null>(null)
  const [progress, setProgress] = useState<VideoProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<string[]>([])
  const seq = useRef(0)

  // reset text when the beat changes; pick the best section as the starting point
  useEffect(() => {
    setTitle(beat.title); setTagline(defaultTag); setFooter(settings?.producerName ? `prod. ${settings.producerName}` : ''); setMade([])
    window.api.getBeat(beat.id).then((d) => {
      setDetail(d)
      if (d?.duration) setStart(bestSection(d.peaks, d.duration, prefs.length || d.duration, d.bpm))
    })
  }, [beat.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.api.coverData(beat.id).then(setCover) }, [beat.id, beat.coverPath])
  useEffect(() => window.api.onVideoProgress(setProgress), [])
  useEffect(() => { if (!prefs.formats.includes(previewFmt) && prefs.formats[0]) setPreviewFmt(prefs.formats[0]) }, [prefs.formats, previewFmt])

  // live preview: the real still from the exporter, debounced
  useEffect(() => {
    const id = ++seq.current
    const t = setTimeout(async () => {
      try {
        const img = await window.api.previewVideo({ beatId: beat.id, format: previewFmt, look: prefs.look, viz: prefs.viz, accent: prefs.accent, title, tagline, footer, start, length: prefs.length })
        if (id === seq.current) setStill(img)
      } catch { /* preview is best-effort */ }
    }, 350)
    return () => clearTimeout(t)
  }, [beat.id, beat.coverPath, previewFmt, prefs.look, prefs.viz, prefs.accent, title, tagline, footer]) // eslint-disable-line react-hooks/exhaustive-deps

  const dur = detail?.duration ?? beat.duration ?? 0
  const len = prefs.length || Math.max(0, dur - start)
  const L = LAYOUT[previewFmt]
  const shownW = previewFmt === 'vertical' ? 270 : 480
  const scale = shownW / L.W
  const wave = useMemo(() => previewWaveSvg({ format: previewFmt, viz: prefs.viz, accent: prefs.accent, peaks: detail?.peaks ?? [] }), [previewFmt, prefs.viz, prefs.accent, detail?.peaks])
  const region = dur ? { from: start / dur, to: Math.min(1, (start + len) / dur) } : undefined

  const doExport = async () => {
    setBusy(true); setMade([]); setProgress({ label: 'Starting', pct: 0 })
    try {
      const paths = await window.api.exportVideo({ beatId: beat.id, formats: prefs.formats, look: prefs.look, viz: prefs.viz, motion: prefs.motion, accent: prefs.accent, title, tagline, footer, start, length: prefs.length })
      setMade(paths)
      toast(`Exported ${paths.length} video${paths.length > 1 ? 's' : ''}`)
      onExported()
    } catch (e) { toast(errMsg(e)) }
    setBusy(false); setProgress(null)
  }
  const toggleFmt = (f: VideoFormat) => set({ formats: prefs.formats.includes(f) ? prefs.formats.filter((x) => x !== f) : [...prefs.formats, f] })
  const past = videos.filter((v) => v.beatId === beat.id).slice(0, 4)

  return (
    <div className="vb">
      <div className="vb-prev">
        <div className="seg" style={{ width: 'auto', marginBottom: 8 }}>
          {(['vertical', 'horizontal'] as const).map((f) => <button key={f} className={previewFmt === f ? 'on' : ''} onClick={() => setPreviewFmt(f)}>{f === 'vertical' ? '9:16' : '16:9'}</button>)}
        </div>
        <div className="frame-wrap" style={{ width: shownW, height: L.H * scale }}>
          {still ? <img src={still} width={shownW} alt="Video preview" /> : <div className="frame-empty">Rendering preview…</div>}
          {still && <div className="wave-ov" style={{ width: L.W, height: L.H, transform: `scale(${scale})` }} dangerouslySetInnerHTML={{ __html: wave }} />}
        </div>
        <div className="help" style={{ marginTop: 6 }}>The visualizer moves with the audio in the export.</div>
      </div>

      <div className="vb-controls">
        <div className="field"><label>Formats</label>
          <div className="seg" style={{ width: 'auto' }}>
            <button className={prefs.formats.includes('vertical') ? 'on' : ''} onClick={() => toggleFmt('vertical')}>Vertical 1080×1920 · TikTok, Reels, Shorts</button>
            <button className={prefs.formats.includes('horizontal') ? 'on' : ''} onClick={() => toggleFmt('horizontal')}>Horizontal 1920×1080 · YouTube</button>
          </div>
        </div>
        <div className="field"><label>Look</label><div className="seg" style={{ width: 'auto' }}>{LOOKS.map((l) => <button key={l.id} className={prefs.look === l.id ? 'on' : ''} onClick={() => set({ look: l.id })}>{l.label}</button>)}</div></div>
        <div className="field"><label>Animation style</label>
          <div className="stylegrid">{VIZ.map((l) => <button key={l.id} className={`stylecard ${prefs.viz === l.id ? 'on' : ''}`} onClick={() => set({ viz: l.id })} title={l.hint}><b>{l.label}</b><span>{l.hint}</span></button>)}</div>
        </div>
        <div className="field"><label>Frame motion</label>
          <div className="stylegrid four">{MOTIONS.map((l) => <button key={l.id} className={`stylecard ${prefs.motion === l.id ? 'on' : ''}`} onClick={() => set({ motion: l.id })} title={l.hint}><b>{l.label}</b><span>{l.hint}</span></button>)}</div>
        </div>
        <div className="field"><label>Accent color</label>
          <div className="swatches">{ACCENTS.map((c) => <button key={c} className={`swatch ${prefs.accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={c} />)}<input type="color" value={prefs.accent} onChange={(e) => set({ accent: e.target.value })} /></div>
        </div>
        <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="two">
          <div className="field"><label>Second line</label><input value={tagline} onChange={(e) => setTagline(e.target.value)} /></div>
          <div className="field"><label>Footer</label><input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="prod. yourname" /></div>
        </div>

        <div className="field">
          <label>Clip · {fmtDur(start)} → {fmtDur(start + len)} <span className="src">click the waveform to move it</span></label>
          <Waveform peaks={detail?.peaks ?? []} progress={0} region={region} height={48} onSeek={(f) => dur && setStart(Math.max(0, Math.min(f * dur, Math.max(0, dur - len))))} />
          <div className="clip-row">
            <select value={prefs.length} onChange={(e) => { const l = +e.target.value; set({ length: l }); if (l && start + l > dur) setStart(Math.max(0, dur - l)) }} style={{ width: 'auto' }}>
              {LENGTHS.map((l) => <option key={l} value={l}>{l ? `${l} seconds` : 'Full beat'}</option>)}
            </select>
            <button onClick={() => detail && setStart(bestSection(detail.peaks, dur, prefs.length || dur, detail.bpm))}>Best section</button>
            <button onClick={() => onPlayAt(beat.id, start)}>▶ Play from here</button>
          </div>
        </div>

        <div className="field"><label>Cover art</label>
          <div className="cover-row">
            <div className="cover-thumb" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>{!cover && 'No art'}</div>
            <div className="cover-btns">
              <button onClick={async () => { if (await window.api.chooseCover(beat.id)) onExported() }}>Choose image…</button>
              <button onClick={async () => { const ok = await window.api.saveCover(beat.id, await artPng({ seed: `g${beat.groupId}`, peaks: beat.thumb, key: beat.key, bpm: beat.bpm })); if (ok) onExported() }}>Generate from the music</button>
              {beat.coverPath && <button onClick={async () => { await window.api.clearCover(beat.id); onExported() }}>Remove</button>}
              <span className="help">{beat.coverPath ? 'Using your image.' : cover ? 'Using art embedded in the file.' : 'A colored placeholder is used until you add art.'}</span>
            </div>
          </div>
        </div>

        <div className="export-row">
          <button className="primary" disabled={busy || !prefs.formats.length || len < 2} onClick={doExport}>{busy ? 'Exporting…' : `Export ${prefs.formats.length > 1 ? 'both videos' : 'video'}`}</button>
          {busy && <button onClick={() => window.api.cancelVideo()}>Cancel</button>}
          {progress && busy && <div className="expbar"><div style={{ width: `${progress.pct * 100}%` }} /><span>{progress.label}</span></div>}
          <span className="dim small-note">Saved to {settings?.exportDir ?? '~/Movies/Studio HQ'}</span>
        </div>
        {made.map((p) => <div key={p} className="linkrow"><code>{p.split('/').pop()}</code><button onClick={() => window.api.revealPath(p)}>Show in Finder</button></div>)}
        {!made.length && past.length > 0 && (<><h3>Recent exports</h3>{past.map((v) => <div key={v.id} className="linkrow"><code>{v.path.split('/').pop()}</code><button onClick={() => window.api.revealPath(v.path)}>Show in Finder</button></div>)}</>)}
      </div>
    </div>
  )
}
