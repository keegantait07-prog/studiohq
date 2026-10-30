import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { AbsoluteFill, Html5Audio, useCurrentFrame, useCurrentScale } from 'remotion'
import type { VideoFormat, VideoMotion, VideoTitles, VizStyle } from '@shared/types'
import { sceneLayout, TILE_LAYOUT } from '@shared/videoTemplate'
import { createScene, loadSceneFonts, motionScale, type SceneLayout, type SceneMeta } from '@shared/vizScene'
import type { VizFeatures } from '@shared/vizFeatures'
import { drawOverlay, type OverlayText } from '@shared/vizOverlay'

// ---- one shared animation clock (30fps) so a dozen live previews cost one rAF loop ----
type Sub = (t: number) => void
const subs = new Set<Sub>()
let raf = 0, last = 0
const loop = (ms: number) => { raf = requestAnimationFrame(loop); if (ms - last < 33) return; last = ms; subs.forEach((f) => f(ms / 1000)) }
const subscribe = (f: Sub) => { subs.add(f); if (!raf) raf = requestAnimationFrame(loop); return () => { subs.delete(f); if (!subs.size) { cancelAnimationFrame(raf); raf = 0 } } }
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Seconds since start, re-rendering every `every` frames while `on`. Stays at 0 for people who asked for less motion. */
export function useClock(every = 1, on = true) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!on || reduced()) return
    let n = 0
    return subscribe((s) => { if (n++ % every === 0) setT(s) })
  }, [every, on])
  return t
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function useVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [vis, setVis] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, vis] as const
}

export interface Feed { features: VizFeatures | null; start: number; len: number; playing: boolean; time: number }

/** Which analysed frame to show: the playhead while the clip plays, otherwise a loop through the clip. */
export function frameOf(f: Feed, clock: number, shift = 0): number {
  const F = f.features
  if (!F) return 0
  if (f.playing && f.time >= f.start && f.time < f.start + F.frames / F.fps) return Math.floor((f.time - f.start) * F.fps)
  return Math.floor((clock + shift) * F.fps) % F.frames
}

export interface MetaIn { title: string; tagline: string; footer: string; bpm: number | null; key: string | null; cover: string | null }

/** The cover as a decoded image, and a flag once the presets' fonts are in. */
function useMeta(m: MetaIn): SceneMeta {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [fonts, setFonts] = useState(0)
  useEffect(() => { let live = true; loadSceneFonts().then(() => live && setFonts(1)); return () => { live = false } }, [])
  useEffect(() => {
    if (!m.cover) { setImg(null); return }
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = m.cover
  }, [m.cover])
  return useMemo(() => ({ title: m.title, tagline: m.tagline, footer: m.footer, bpm: m.bpm, key: m.key, cover: img }), [m.title, m.tagline, m.footer, m.bpm, m.key, img, fonts]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** A canvas that draws one preset, sized to its box at the screen's pixel density. */
function useSceneCanvas(L: SceneLayout, viz: VizStyle, accent: string, meta: SceneMeta, features: VizFeatures | null, frame: number, width: number, scale = 1) {
  const ref = useRef<HTMLCanvasElement>(null)
  const draw = useMemo(() => createScene(L, viz, accent, meta), [L, viz, accent, meta])
  useLayoutEffect(() => {
    const c = ref.current
    if (!c || !width) return
    const cw = Math.round(width * Math.min(1.5, devicePixelRatio || 1)), ch = Math.round((cw * L.H) / L.W)
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch }
    const ctx = c.getContext('2d')
    if (!ctx) return
    if (!features) { ctx.fillStyle = '#0d0e11'; ctx.fillRect(0, 0, cw, ch); return }
    const k = cw / L.W
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.save(); ctx.translate((cw - cw * scale) / 2, (ch - ch * scale) / 2); ctx.scale(scale, scale)
    draw(ctx, features, frame, k)
    ctx.restore()
  }, [draw, features, frame, width, L, scale])
  return ref
}

interface MonProps { fmt: VideoFormat; meta: MetaIn; text: OverlayText; titles: VideoTitles; feed: Feed; beatId: number; viz: VizStyle; accent: string; motion: VideoMotion; exporting: boolean; onToggle: () => void; label: string }

interface CompProps { L: SceneLayout; viz: VizStyle; accent: string; meta: SceneMeta; text: OverlayText; titles: VideoTitles; motion: VideoMotion; features: VizFeatures; beatId: number; start: number }

/** The Remotion composition behind a monitor: one canvas painted exactly like an export frame. */
function SceneComp({ L, viz, accent, meta, text, titles, motion, features, beatId, start }: CompProps) {
  const frame = useCurrentFrame()
  const scale = useCurrentScale()
  const ref = useRef<HTMLCanvasElement>(null)
  const draw = useMemo(() => createScene(L, viz, accent, meta), [L, viz, accent, meta])
  const layer = useMemo(() => document.createElement('canvas'), [])
  useLayoutEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    const lctx = layer.getContext('2d')
    if (!c || !ctx || !lctx) return
    const cw = Math.max(2, Math.round(L.W * scale * Math.min(1.5, devicePixelRatio || 1))), ch = Math.round((cw * L.H) / L.W)
    if (c.width !== cw || c.height !== ch) { c.width = layer.width = cw; c.height = layer.height = ch }
    const k = cw / L.W, s = motionScale(motion, features, frame)
    draw(lctx, features, frame, k)
    ctx.setTransform(s, 0, 0, s, (cw - cw * s) / 2, (ch - ch * s) / 2)
    ctx.drawImage(layer, 0, 0)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    drawOverlay(ctx, L, viz, accent, text, titles, features, frame)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [draw, layer, features, frame, scale, L, motion, viz, accent, text, titles])
  return (
    <AbsoluteFill>
      <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
      <Html5Audio src={`shqa://beat/${beatId}`} trimBefore={Math.round(start * features.fps)} />
    </AbsoluteFill>
  )
}

/** A live monitor: a Remotion Player around the exact export frame, scrubbable, with the clip's audio. */
export function Monitor({ fmt, meta, text, titles, feed, beatId, viz, accent, motion, exporting, onToggle, label }: MonProps) {
  const L = sceneLayout(fmt)
  const m = useMeta(meta)
  const player = useRef<PlayerRef>(null)
  const F = feed.features
  // while the app's own player plays this clip, the monitor follows its playhead
  const follow = F && feed.playing && feed.time >= feed.start && feed.time < feed.start + F.frames / F.fps ? Math.floor((feed.time - feed.start) * F.fps) : null
  useEffect(() => {
    const p = player.current
    if (follow == null || !p) return
    if (p.isPlaying()) p.pause()
    p.seekTo(follow)
  }, [follow])
  const props = useMemo(() => (F ? { L, viz, accent, meta: m, text, titles, motion, features: F, beatId, start: feed.start } : null), [L, viz, accent, m, text, titles, motion, F, beatId, feed.start])
  return (
    <div className={`mon ${fmt === 'vertical' ? 'phone' : 'land'} ${exporting ? 'on' : ''}`}>
      <div className="mon-body">
        {props ? (
          <Player
            ref={player}
            component={SceneComp}
            inputProps={props}
            durationInFrames={Math.max(1, F!.frames)}
            fps={F!.fps}
            compositionWidth={L.W}
            compositionHeight={L.H}
            style={{ width: '100%', height: '100%' }}
            controls
            loop
            autoPlay={!reduced()}
            initiallyMuted
            showVolumeControls
            clickToPlay={false}
            numberOfSharedAudioTags={0}
            spaceKeyToPlayOrPause={false}
          />
        ) : <div className="frame-empty">Listening to the beat…</div>}
      </div>
      <button className="mon-tag" aria-pressed={exporting} onClick={onToggle} title={exporting ? 'Will be exported. Click to leave out.' : 'Click to include in the export'}>
        <i className="mon-check">{exporting ? '✓' : ''}</i>{label}
      </button>
    </div>
  )
}

export interface TileInfo { id: VizStyle; label: string; hint: string }
interface TileProps { info: TileInfo; i: number; on: boolean; accent: string; meta: MetaIn; features: VizFeatures | null; onPick: (v: VizStyle) => void }

/** One preset, playing. Each tile runs a few seconds apart so the wall never moves in lockstep. */
export const Tile = memo(function Tile({ info, i, on, accent, meta, features, onPick }: TileProps) {
  const [ref, vis] = useVisible<HTMLButtonElement>()
  const [box, w] = useWidth<HTMLDivElement>()
  const clock = useClock(2, vis)
  const fr = frameOf({ features, start: 0, len: 0, playing: false, time: 0 }, clock, i * 1.7)
  const m = useMeta(meta)
  const canvas = useSceneCanvas(TILE_LAYOUT, info.id, accent, m, vis ? features : null, fr, w)
  return (
    <button ref={ref} className={`tile ${on ? 'on' : ''}`} style={{ ['--i' as string]: i }} aria-pressed={on} onClick={() => onPick(info.id)} title={info.hint}>
      <div ref={box} className="tile-wave"><canvas ref={canvas} /></div>
      <b className="tile-label">{info.label}</b>
    </button>
  )
})
