import { useEffect, useMemo, useState } from 'react'
import { usePlayerTime, type PlayerClock } from './player'
import { artPng } from './genart'
import type { Beat, BeatDetail, Settings, VideoExport, VideoFormat, VideoMotion, VideoProgress, VideoTitles, VizStyle } from '@shared/types'
import type { VizFeatures } from '@shared/vizFeatures'
import { displayKey } from '@shared/key'
import { Waveform } from './Waveform'
import { bestSection } from './suggest'
import { errMsg } from './salesUtils'
import { fmtDur, fmtBpm } from './format'
import { keyColor } from './keyColor'
import { Monitor, Tile, type Feed } from './Studio'

const ACCENTS = ['#ff6b3d', '#3987e5', '#1baf7a', '#e87ba4', '#eda100', '#9085e9', '#ffffff']
const VIZ: { id: VizStyle; label: string; hint: string }[] = [
  { id: 'lab', label: 'Lab', hint: 'An engineer\u2019s instrument panel on paper: the real notes on a piano roll, a bar dial, scope, spectrum, vectorscope and a note highway' },
  { id: 'tape', label: 'Tape', hint: 'A worn cassette deck on cardboard: reels that wind through the clip, VU needles with real ballistics and a pen plotter printing the beat' },
  { id: 'riso', label: 'Riso', hint: 'A two-ink risograph poster: your cover in halftone, ink that slips out of register on every kick, and the bar printed as a 16-step grid' },
  { id: 'cover', label: 'Cover', hint: 'Your artwork front and centre over a blurred wash of itself, swelling on the kicks, with a mirrored spectrum and a progress bar' },
  { id: 'vinyl', label: 'Vinyl', hint: 'A record turning at 33⅓ seen from above: every groove is a moment of the clip lit by its loudness, and the tonearm walks inward as it plays' },
  { id: 'ridge', label: 'Ridge', hint: 'The last few seconds of the spectrum stacked as ridgelines on black, the newest line in your accent' },
  { id: 'phosphor', label: 'Phosphor', hint: 'A green-screen oscilloscope: a stereo XY trace with afterglow, a triggered waveform and a live log of every kick and snare by bar' },
  { id: 'score', label: 'Score', hint: 'Engraved sheet music: the transcribed notes scroll across a grand staff, with dynamics from the loudness and a keyboard of what sounds' },
  { id: 'led', label: 'LED', hint: 'A dot-matrix LED wall: your title as a scrolling marquee, a ring that pulses on every kick and spectrum columns with peak caps' },
  { id: 'ink', label: 'Ink', hint: 'Suminagashi: every kick floats a drop of ink on water and pushes the older rings aside, downbeats in your accent, the title on a hanging paper strip' },
  { id: 'typewriter', label: 'Typewriter', hint: 'The beat typed out live, one 16th at a time: x for kicks in red ribbon, o for snares, a carriage return every bar, and each bar\u2019s root note highlighted in its colour' },
  { id: 'bauhaus', label: 'Bauhaus', hint: 'A cut-paper screenprint that recomposes itself every phrase: shapes slide to new places a beat apart and land on springs, each one breathing with its own band, overprinting in your accent and its triad' }
]
const MOTIONS: { id: VideoMotion; label: string; hint: string }[] = [
  { id: 'still', label: 'Still', hint: 'The frame stays put' },
  { id: 'drift', label: 'Slow push-in', hint: 'A gentle zoom across the whole clip' },
  { id: 'breathe', label: 'Breathe', hint: 'A steady in-and-out, 4 seconds a cycle' },
  { id: 'beat', label: 'Beat bounce', hint: 'The frame thumps on the beat, locked to the beat\u2019s tempo' }
]
const TITLES: { id: VideoTitles; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Just the visualizer' },
  { id: 'intro', label: 'Intro', hint: 'Your title wipes in on a printed band for the first two seconds, letter by letter' },
  { id: 'both', label: 'Intro + end card', hint: 'Adds an end card for the last three seconds: title, your call to action and footer, then a fade to black (clips of 9 seconds or more)' }
]
const LENGTHS = [15, 30, 45, 60, 90, 0]

interface Prefs { viz: VizStyle; motion: VideoMotion; titles: VideoTitles; accent: string; formats: VideoFormat[]; length: number }
const DEFAULTS: Prefs = { viz: 'vinyl', motion: 'still', titles: 'intro', accent: '#ff6b3d', formats: ['vertical'], length: 30 }
const loadPrefs = (): Prefs => {
  try {
    const p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('shq-video') ?? '{}') }
    return VIZ.some((v) => v.id === p.viz) ? p : { ...p, viz: DEFAULTS.viz } // styles from older versions fall back
  } catch { return DEFAULTS }
}

interface Props {
  beat: Beat
  settings: Settings | null
  videos: VideoExport[]
  onPlayAt: (id: number, at: number) => void
  onExported: () => void
  toast: (m: string) => void
  playId: number | null
  playing: boolean
  playClock: PlayerClock
}

export function VideoBuilder({ beat, settings, videos, onPlayAt, onExported, toast, playId, playing, playClock }: Props) {
  const playTime = usePlayerTime(playClock)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const set = (p: Partial<Prefs>) => setPrefs((x) => { const n = { ...x, ...p }; try { localStorage.setItem('shq-video', JSON.stringify(n)) } catch { /* ignore */ } return n })
  const defaultTag = beat.tags.artist.length ? `${beat.tags.artist.slice(0, 2).map((a) => a.replace(/\b\w/g, (c) => c.toUpperCase())).join(' x ')} type beat` : [beat.bpm ? `${Math.round(beat.bpm)} BPM` : '', displayKey(beat.key)].filter(Boolean).join(' · ')
  const [title, setTitle] = useState(beat.title)
  const [tagline, setTagline] = useState(defaultTag)
  const [footer, setFooter] = useState(settings?.producerName ? `prod. ${settings.producerName}` : '')
  const [cta, setCta] = useState('Full beat · link in bio')
  const [start, setStart] = useState(0)
  const [cover, setCover] = useState<string | null>(null)
  const [detail, setDetail] = useState<BeatDetail | null>(null)
  const [progress, setProgress] = useState<VideoProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<string[]>([])

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

  // the analysed clip: the same timeline the export draws from
  const [features, setFeatures] = useState<VizFeatures | null>(null)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => { window.api.vizFeatures(beat.id, start, prefs.length).then((f) => { if (live) setFeatures(f) }).catch(() => { /* preview is best-effort */ }) }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [beat.id, start, prefs.length])


  const dur = detail?.duration ?? beat.duration ?? 0
  const len = prefs.length || Math.max(0, dur - start)
  const region = dur ? { from: start / dur, to: Math.min(1, (start + len) / dur) } : undefined

  const doExport = async () => {
    setBusy(true); setMade([]); setProgress({ label: 'Starting', pct: 0 })
    try {
      const paths = await window.api.exportVideo({ beatId: beat.id, formats: prefs.formats, viz: prefs.viz, motion: prefs.motion, titles: prefs.titles, cta, accent: prefs.accent, title, tagline, footer, start, length: prefs.length })
      setMade(paths)
      toast(`Exported ${paths.length} video${paths.length > 1 ? 's' : ''}`)
      onExported()
    } catch (e) { toast(errMsg(e)) }
    setBusy(false); setProgress(null)
  }
  const toggleFmt = (f: VideoFormat) => set({ formats: prefs.formats.includes(f) ? prefs.formats.filter((x) => x !== f) : [...prefs.formats, f] })
  const past = videos.filter((v) => v.beatId === beat.id).slice(0, 4)

  const mine = playId === beat.id
  const feed: Feed = { features, start, len, playing: mine && playing, time: mine ? playTime : 0 }
  const meta = { title, tagline, footer, bpm: beat.bpm, key: beat.key, cover }
  const text = useMemo(() => ({ title, tagline, footer, cta, bpm: beat.bpm, key: beat.key }), [title, tagline, footer, cta, beat.bpm, beat.key])
  const headPct = dur && mine ? Math.min(100, (playTime / dur) * 100) : null
  const barPct = dur && beat.bpm ? ((240 / beat.bpm) / dur) * 100 : 0

  return (
    <div className="studio">
      <div className="stage">
        <Monitor fmt="vertical" meta={meta} text={text} titles={prefs.titles} beatId={beat.id} feed={feed} viz={prefs.viz} accent={prefs.accent} motion={prefs.motion} exporting={prefs.formats.includes('vertical')} onToggle={() => toggleFmt('vertical')} label="9:16  TikTok · Reels · Shorts" />
        <div className="stage-side">
          <Monitor fmt="horizontal" meta={meta} text={text} titles={prefs.titles} beatId={beat.id} feed={feed} viz={prefs.viz} accent={prefs.accent} motion={prefs.motion} exporting={prefs.formats.includes('horizontal')} onToggle={() => toggleFmt('horizontal')} label="16:9  YouTube" />
          <div className="readout">
            <span className="rd"><b className="mono">{fmtBpm(beat.bpm) || '—'}</b> BPM</span>
            <span className="rd"><i className="kdotc" style={{ background: keyColor(beat.key), color: keyColor(beat.key) }} /><b>{displayKey(beat.key) || 'No key'}</b></span>
            <span className="rd"><b className="mono">{fmtDur(len)}</b> clip</span>
            <span className="rd dim">starts at <b className="mono">{fmtDur(start)}</b></span>
            <button className="rd-play" onClick={() => (mine && playing ? onPlayAt(beat.id, playTime) : onPlayAt(beat.id, start))}>{mine && playing ? 'Playing' : '▶ Play the clip'}</button>
          </div>
        </div>
      </div>

      <div className="tl panel">
        <div className="tl-head">
          <h3>Clip</h3>
          <span className="mono">{fmtDur(start)} → {fmtDur(start + len)}</span>
          <span className="src">click the waveform to move it</span>
          <div className="grow" />
          <select value={prefs.length} onChange={(e) => { const l = +e.target.value; set({ length: l }); if (l && start + l > dur) setStart(Math.max(0, dur - l)) }} style={{ width: 'auto' }}>
            {LENGTHS.map((l) => <option key={l} value={l}>{l ? `${l} seconds` : 'Full beat'}</option>)}
          </select>
          <button onClick={() => detail && setStart(bestSection(detail.peaks, dur, prefs.length || dur, detail.bpm))}>Best section</button>
        </div>
        <div className="tl-wave">
          <Waveform peaks={detail?.peaks ?? []} progress={0} region={region} height={64} onSeek={(f) => dur && setStart(Math.max(0, Math.min(f * dur, Math.max(0, dur - len))))} />
          {barPct > 0.3 && <i className="tl-grid" style={{ backgroundImage: `repeating-linear-gradient(90deg, rgba(var(--fg-rgb), .16) 0 1px, transparent 1px ${barPct}%)` }} />}
          {headPct != null && <i className="tl-head-line" style={{ left: `${headPct}%` }} />}
        </div>
      </div>

      <div>
        <div className="sect-head"><h3>Animation style</h3><span className="dim">Each one is playing this clip, driven by its real notes, kicks and bars.</span></div>
        <div className="wall">
          {VIZ.map((v, i) => <Tile key={v.id} info={v} i={i} on={prefs.viz === v.id} accent={prefs.accent} meta={meta} features={features} onPick={(id) => set({ viz: id })} />)}
        </div>
      </div>

      <div className="ctrls">
        <div className="cc panel">
          <h3>Frame motion</h3>
          <div className="seg wrap" style={{ width: 'auto' }}>{MOTIONS.map((l) => <button key={l.id} className={prefs.motion === l.id ? 'on' : ''} onClick={() => set({ motion: l.id })} title={l.hint}>{l.label}</button>)}</div>
          <p className="help small-note">{MOTIONS.find((m) => m.id === prefs.motion)?.hint}</p>
          <h3>Titles</h3>
          <div className="seg wrap" style={{ width: 'auto' }}>{TITLES.map((l) => <button key={l.id} className={prefs.titles === l.id ? 'on' : ''} onClick={() => set({ titles: l.id })} title={l.hint}>{l.label}</button>)}</div>
          <p className="help small-note">{TITLES.find((m) => m.id === prefs.titles)?.hint}</p>
        </div>
        <div className="cc panel">
          <h3>Accent</h3>
          <div className="swatches">{ACCENTS.map((c) => <button key={c} className={`swatch ${prefs.accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={c} />)}<input type="color" value={prefs.accent} onChange={(e) => set({ accent: e.target.value })} /></div>
          <h3>Cover art</h3>
          <div className="cover-row">
            <div className="cover-thumb" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>{!cover && 'No art'}</div>
            <div className="cover-btns">
              <button onClick={async () => { if (await window.api.chooseCover(beat.id)) onExported() }}>Choose image…</button>
              <button onClick={async () => { const ok = await window.api.saveCover(beat.id, await artPng({ seed: `g${beat.groupId}`, peaks: beat.thumb, key: beat.key, bpm: beat.bpm })); if (ok) onExported() }}>Generate from the music</button>
              {beat.coverPath && <button onClick={async () => { await window.api.clearCover(beat.id); onExported() }}>Remove</button>}
            </div>
          </div>
        </div>
        <div className="cc panel">
          <h3>Words on the video</h3>
          <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field"><label>Second line</label><input value={tagline} onChange={(e) => setTagline(e.target.value)} /></div>
          <div className="field"><label>Footer</label><input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="prod. yourname" /></div>
          {prefs.titles === 'both' && <div className="field"><label>End card</label><input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Full beat · link in bio" /></div>}
        </div>
      </div>

      {!made.length && past.length > 0 && <div className="recent"><span className="dim">Recent exports</span>{past.map((v) => <button key={v.id} className="ghost" onClick={() => window.api.revealPath(v.path)} title="Show in Finder">{v.path.split('/').pop()}</button>)}</div>}
      {made.map((p) => <div key={p} className="linkrow"><code>{p.split('/').pop()}</code><button onClick={() => window.api.revealPath(p)}>Show in Finder</button></div>)}

      <div className="exportbar">
        <div className="seg" style={{ width: 'auto' }}>
          <button className={prefs.formats.includes('vertical') ? 'on' : ''} onClick={() => toggleFmt('vertical')}>Vertical 1080×1920</button>
          <button className={prefs.formats.includes('horizontal') ? 'on' : ''} onClick={() => toggleFmt('horizontal')}>Horizontal 1920×1080</button>
        </div>
        <span className="dim small-note eb-path">Saved to {settings?.exportDir ?? '~/Movies/Studio HQ'}</span>
        <div className="grow" />
        {progress && busy && <div className="expbar"><div style={{ width: `${progress.pct * 100}%` }} /><span>{progress.label}</span></div>}
        {busy && <button onClick={() => window.api.cancelVideo()}>Cancel</button>}
        <button className="primary" disabled={busy || !prefs.formats.length || len < 2} onClick={doExport}>{busy ? 'Exporting…' : `Export ${prefs.formats.length > 1 ? 'both videos' : 'video'}`}</button>
      </div>
    </div>
  )
}
