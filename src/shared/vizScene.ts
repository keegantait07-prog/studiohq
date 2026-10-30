// Full-frame video presets, drawn with Canvas2D. Every frame is a pure function of the analysed
// timeline (VizFeatures) and the frame index: no hidden state and no Math.random, so the live
// preview, a scrub and the export all draw identical pictures.
//
// Each preset is an object with a point of view, and everything on it is real data from the
// track: transcribed notes, the bar grid, kicks, loudness, chroma and the stereo image.
//   lab   an engineer's instrument panel on paper
//   tape  a worn cassette deck on cardboard, with VU needles and a pen-plotter printout
//   riso  a two-ink risograph poster that mis-registers on the kicks
import type { VideoMotion, VizStyle } from './types'
import { NB, VEC, WAVE, type VizFeatures } from './vizFeatures'

export interface Box { x: number; y: number; w: number; h: number }
export interface SceneLayout { W: number; H: number }
export interface SceneMeta { title: string; tagline: string; footer: string; bpm: number | null; key: string | null; cover: CanvasImageSource | null }

type Ctx = CanvasRenderingContext2D

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace'
const COND = '"Barlow Condensed", "Arial Narrow", sans-serif'
const HAND = '"Caveat", "Bradley Hand", cursive'
const SERIF = '"Source Serif 4", Georgia, serif'
export const SCENE_FONTS = [`500 20px ${MONO}`, `600 20px ${MONO}`, `600 20px ${COND}`, `700 20px ${COND}`, `600 20px ${HAND}`, `400 20px ${SERIF}`, `italic 400 20px ${SERIF}`]

/** Make sure the fonts the presets draw with are ready (canvas text never waits for them). */
export async function loadSceneFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all(SCENE_FONTS.map((f) => document.fonts.load(f).catch(() => null)))
}

const hash = (a: number, b = 0): number => { const x = Math.sin(a * 127.1 + b * 311.7 + 0.1) * 43758.5453; return x - Math.floor(x) }
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const pad = (n: number, w: number) => String(Math.max(0, Math.floor(n))).padStart(w, '0')
const clock = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60, 2)}`

function hexRgb(hex: string): [number, number, number] {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0xff6b3d
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a)})`

/** The pitch classes of a key like "A minor", for marking the scale on the key pads. */
function scaleOf(key: string | null): Set<number> {
  const m = key && /^([A-G])([#b]?)\s+(major|minor)$/.exec(key)
  if (!m) return new Set()
  const root = (NAMES.indexOf(m[1]) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12
  const steps = m[3] === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]
  return new Set(steps.map((s) => (root + s) % 12))
}
const shortKey = (k: string | null) => (k ? k.replace(' minor', ' MIN').replace(' major', ' MAJ') : '')

/** How the whole frame moves. */
export function motionScale(m: VideoMotion | undefined, f: VizFeatures | null, frame: number): number {
  const fps = f?.fps ?? 30
  if (m === 'drift') return 1 + 0.07 * (f ? frame / Math.max(1, f.frames) : (frame / fps / 14) % 1)
  if (m === 'breathe') return 1.04 + 0.03 * Math.sin(((frame / fps) / 4) * Math.PI * 2)
  if (m === 'beat') return 1.012 + 0.03 * (f ? f.kick[clamp(frame, 0, f.frames - 1)] : 0)
  return 1
}

/** One frame's view of the timeline. */
class Frame {
  i = 0
  t = 0
  bass = 0; mid = 0; high = 0; rms = 0; kick = 0; snap = 0; beat = 1
  constructor(public f: VizFeatures) {}
  at(i: number): this {
    const f = this.f, k = clamp(Math.round(i), 0, f.frames - 1)
    this.i = k; this.t = k / f.fps
    this.bass = f.bass[k]; this.mid = f.mid[k]; this.high = f.high[k]; this.rms = f.rms[k]
    this.kick = f.kick[k]; this.snap = f.snap[k]; this.beat = f.beat[k]
    return this
  }
  get dur() { return this.f.frames / this.f.fps }
  get progress() { return this.i / Math.max(1, this.f.frames - 1) }
  /** frames per beat, and the frame where beat 1 of bar 1 falls */
  get P() { return (this.f.fps * 60) / this.f.bpm }
  get origin() { return this.i - (this.beat - 1) * this.P }
  get bar() { return Math.max(1, Math.floor((this.beat - 1) / 4) + 1) }
  get inBar() { return (((this.beat - 1) % 4) + 4) % 4 }
  band(x: number, lag = 0): number {
    const k = clamp(this.i - lag, 0, this.f.frames - 1) * NB
    const p = clamp(x) * (NB - 1), a = Math.floor(p), b = Math.min(NB - 1, a + 1)
    return lerp(this.f.bands[k + a], this.f.bands[k + b], p - a) / 255
  }
  hold(x: number, span = 16): number {
    let m = 0
    for (let l = 0; l < span; l++) m = Math.max(m, this.band(x, l) - l * 0.022)
    return m
  }
  wave(x: number, lag = 0): number {
    const k = clamp(this.i - lag, 0, this.f.frames - 1) * WAVE
    const p = clamp(x) * (WAVE - 1), a = Math.floor(p), b = Math.min(WAVE - 1, a + 1)
    return lerp(this.f.wave[k + a], this.f.wave[k + b], p - a) / 127
  }
  peakAt(frame: number): number { return frame < 0 || frame >= this.f.frames ? 0 : this.f.peak[Math.floor(frame)] / 255 }
  rmsAt(frame: number): number { return this.f.rms[clamp(Math.floor(frame), 0, this.f.frames - 1)] }
  /** notes overlapping [from, to) frames */
  notes(from: number, to: number, fn: (s: number, e: number, midi: number, vel: number) => void): void {
    const n = this.f.notes
    for (let j = 0; j < n.length; j += 4) {
      if (n[j] >= to) break
      if (n[j + 1] > from) fn(n[j], n[j + 1], n[j + 2], n[j + 3])
    }
  }
}

// ---------------------------------------------------------------- drawing helpers

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
}

/** Set a font, shrinking it until `text` fits in `maxW`. Returns the size used. */
function fit(ctx: Ctx, text: string, font: (px: number) => string, size: number, maxW: number, min = 10): number {
  let s = size
  ctx.font = font(s)
  while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = font(s) }
  return s
}

function spaced(ctx: Ctx, text: string, x: number, y: number, track: number, align: 'left' | 'right' = 'left'): number {
  let w = 0
  for (const ch of text) w += ctx.measureText(ch).width + track
  let cx = align === 'right' ? x - w + track : x
  const prev = ctx.textAlign
  ctx.textAlign = 'left'
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track }
  ctx.textAlign = prev
  return w
}

/** A tile of seeded specks: paper fibre and print grain. Static, so it reads as material, not noise. */
function grainTile(seed: number, dark: string, light: string, density: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  for (let i = 0; i < 256 * 256 * density; i++) {
    const x = hash(i, seed) * 256, y = hash(i, seed + 1) * 256, r = 0.4 + hash(i, seed + 2) * 1.1
    g.fillStyle = hash(i, seed + 3) > 0.5 ? dark : light
    g.globalAlpha = 0.25 + 0.75 * hash(i, seed + 4)
    g.fillRect(x, y, r, r)
  }
  for (let i = 0; i < 26; i++) { // fibres
    const x = hash(i, seed + 9) * 256, y = hash(i, seed + 10) * 256, a = hash(i, seed + 11) * Math.PI
    g.strokeStyle = dark; g.globalAlpha = 0.25; g.lineWidth = 0.6
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke()
  }
  return c
}

function texture(ctx: Ctx, tile: HTMLCanvasElement, W: number, H: number, a: number, op: GlobalCompositeOperation = 'source-over'): void {
  const p = ctx.createPattern(tile, 'repeat')
  if (!p) return
  ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = op; ctx.fillStyle = p; ctx.fillRect(0, 0, W, H); ctx.restore()
}

interface Kit { ctx: Ctx; W: number; H: number; tall: boolean; u: number; F: Frame; meta: SceneMeta; A: [number, number, number] }

// ================================================================ LAB: the instrument panel

const LAB = { paper: '#ebeae6', panel: '#f3f2ef', rule: '#a4a6a3', faint: '#d7d6d1', ink: '#26282c', mute: '#8b8d91', ghost: '#c3c4c0' }

function labBoxes(W: number, H: number, tall: boolean) {
  if (tall) {
    const m = 64, w = W - 2 * m
    return {
      head: { x: m, y: 58, w, h: 64 }, over: { x: m, y: 140, w, h: 360 }, roll: { x: m, y: 530, w, h: 520 },
      dial: { x: m, y: 1090, w: 400, h: 420 }, wave: { x: m + 440, y: 1100, w: w - 440, h: 170 },
      meters: { x: m + 440, y: 1292, w: w - 440, h: 210 }, hwy: { x: m, y: 1540, w, h: 220 }, pads: { x: m, y: 1780, w, h: 76 }, foot: { x: m, y: 1890, w, h: 0 }
    }
  }
  const m = Math.round(W * 0.03), split = Math.round(W * 0.63), w = split - m
  const rx = split + 28, rw = W - m - rx
  return {
    head: { x: m, y: 34, w: W - 2 * m, h: 52 }, over: { x: m, y: 100, w, h: 230 }, roll: { x: m, y: 350, w, h: 400 },
    dial: { x: rx, y: 100, w: rw * 0.5, h: 330 }, pads: { x: rx + rw * 0.54, y: 120, w: rw * 0.46, h: 290 },
    wave: { x: rx, y: 460, w: rw, h: 220 }, meters: { x: rx, y: 700, w: rw, h: 300 }, hwy: { x: m, y: 772, w, h: 250 }, foot: { x: rx, y: 1030, w: rw, h: 0 }
  }
}

const ranges = new WeakMap<VizFeatures, [number, number]>()
/** The roll's pitch range: the clip's own notes, padded out to whole octaves (at least two). */
function noteRange(f: VizFeatures): [number, number] {
  let r = ranges.get(f)
  if (!r) {
    let a = 127, b = 0
    for (let j = 2; j < f.notes.length; j += 4) { a = Math.min(a, f.notes[j]); b = Math.max(b, f.notes[j]) }
    if (a > b) { a = 48; b = 72 }
    let lo = Math.floor((a - 1) / 12) * 12, hi = Math.ceil((b + 2) / 12) * 12
    if (hi - lo < 24) hi = lo + 24
    if (hi - lo > 48) lo = hi - 48
    r = [Math.max(12, lo), Math.min(120, hi)]
    ranges.set(f, r)
  }
  return r
}

function labPanel(k: Kit, b: Box, label?: string, label2?: string): void {
  const { ctx, u } = k
  ctx.fillStyle = LAB.panel; ctx.fillRect(b.x, b.y, b.w, b.h)
  ctx.strokeStyle = LAB.rule; ctx.lineWidth = 1.5 * u; ctx.strokeRect(b.x, b.y, b.w, b.h)
  if (label) {
    ctx.font = `500 ${18 * u}px ${MONO}`; ctx.fillStyle = LAB.mute; ctx.textBaseline = 'top'
    const w = spaced(ctx, label, b.x + 14 * u, b.y + 12 * u, 2.5 * u)
    if (label2) { ctx.fillStyle = rgba(k.A, 1); spaced(ctx, label2, b.x + 14 * u + w + 16 * u, b.y + 12 * u, 2.5 * u) }
    ctx.textBaseline = 'alphabetic'
  }
}

function lab(k: Kit): void {
  const { ctx, W, H, F, u, meta, A, tall } = k
  const B = labBoxes(W, H, tall)
  ctx.fillStyle = LAB.paper; ctx.fillRect(0, 0, W, H)

  // ---- header: window chrome, title, live readouts
  {
    const b = B.head, cy = b.y + b.h / 2
    ;[LAB.ink, LAB.mute, rgba(A, 1)].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(b.x + 10 * u + i * 26 * u, cy, 7 * u, 0, Math.PI * 2); ctx.fill() })
    ctx.textBaseline = 'middle'
    const right = `${meta.bpm ? Math.round(meta.bpm) + ' BPM' : ''}${meta.key ? '  ·  ' + shortKey(meta.key) : ''}  ·  ${clock(F.t)}.${pad((F.t % 1) * 100, 2)}`
    ctx.font = `500 ${20 * u}px ${MONO}`; ctx.fillStyle = LAB.mute
    const rw = ctx.measureText(right).width
    ctx.textAlign = 'right'; ctx.fillText(right, b.x + b.w, cy); ctx.textAlign = 'left'
    const tx = b.x + 96 * u, room = b.w - 96 * u - rw - 30 * u
    fit(ctx, meta.title.toUpperCase(), (s) => `600 ${s}px ${MONO}`, 30 * u, room * 0.62)
    ctx.fillStyle = LAB.ink; ctx.fillText(meta.title.toUpperCase(), tx, cy)
    const tw = ctx.measureText(meta.title.toUpperCase()).width
    if (meta.tagline) { fit(ctx, meta.tagline, (s) => `400 ${s}px ${MONO}`, 20 * u, room - tw - 24 * u); ctx.fillStyle = LAB.mute; ctx.fillText(meta.tagline, tx + tw + 24 * u, cy) }
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = LAB.rule; ctx.fillRect(b.x, b.y + b.h, b.w, 1.5 * u)
  }

  // ---- overview: the whole clip, the played part inked, and a block spectrogram underneath
  {
    const b = B.over
    labPanel(k, b, 'OVERVIEW', `${clock(F.t)} / ${clock(F.dur)}`)
    const x0 = b.x + 16 * u, w = b.w - 32 * u, mid = b.y + b.h * 0.33, amp = b.h * 0.18
    const ph = x0 + w * F.progress
    for (let x = 0; x < w; x += 4 * u) {
      const fr = (x / w) * F.f.frames, v = Math.max(0.03, F.peakAt(fr))
      ctx.fillStyle = x0 + x < ph ? rgba(A, 0.9) : LAB.ghost
      ctx.fillRect(x0 + x, mid - v * amp, 2 * u, 2 * v * amp)
    }
    const rows = 10, gy = b.y + b.h * 0.6, gh = b.h * 0.34, cw = 14 * u, ch = gh / rows
    const cols = Math.floor(w / cw), fpc = F.f.frames / cols
    for (let c = 0; c < cols; c++) {
      const fr = Math.floor(c * fpc), cx = x0 + c * cw
      const age = (F.i - fr) / F.f.fps
      for (let r = 0; r < rows; r++) {
        const v = F.f.bands[clamp(fr, 0, F.f.frames - 1) * NB + Math.floor(((r + 0.5) / rows) * NB)] / 255
        if (v < 0.35) continue
        const recent = age >= 0 && age < 2.5
        ctx.fillStyle = recent ? rgba(A, 0.25 + 0.75 * (v - 0.35) / 0.65) : age < 0 ? `rgba(160,162,158,${0.1 + 0.2 * v})` : `rgba(120,122,118,${0.15 + 0.35 * v})`
        ctx.fillRect(cx, gy + gh - (r + 1) * ch, cw - 2 * u, ch - 2 * u)
      }
    }
    ctx.fillStyle = LAB.ink; ctx.fillRect(ph - 1.5 * u, b.y + 44 * u, 3 * u, b.h - 56 * u)
  }

  // ---- piano roll of the transcribed notes, four bars visible
  {
    const b = B.roll
    labPanel(k, b)
    const gut = 62 * u, rulerH = 36 * u, x0 = b.x + gut, w = b.w - gut - 2 * u, y0 = b.y + rulerH, h = b.h - rulerH - 2 * u
    const [lo, hi] = noteRange(F.f), rowH = h / (hi - lo)
    const span = 16 * F.P, left = F.i - span * 0.28, ppf = w / span, phx = x0 + (F.i - left) * ppf
    ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip()
    for (let m = lo; m <= hi; m++) {
      const y = y0 + h - (m - lo) * rowH
      if (m % 12 === 0) {
        ctx.fillStyle = LAB.rule; ctx.fillRect(x0, y, w, 1.2 * u)
        ctx.font = `500 ${17 * u}px ${MONO}`; ctx.fillStyle = LAB.mute; ctx.textBaseline = 'middle'; ctx.fillText(`C${m / 12 - 1}`, b.x + 12 * u, y - rowH / 2); ctx.textBaseline = 'alphabetic'
      } else if ([1, 3, 6, 8, 10].includes(m % 12)) { ctx.fillStyle = 'rgba(0,0,0,0.025)'; ctx.fillRect(x0, y - rowH, w, rowH) }
    }
    const b0 = Math.floor((left - F.origin) / F.P) - 1
    for (let bt = b0; bt < b0 + 20; bt++) {
      const x = x0 + (F.origin + bt * F.P - left) * ppf
      if (x < x0 || x > x0 + w) continue
      const isBar = ((bt % 4) + 4) % 4 === 0
      ctx.fillStyle = isBar ? LAB.rule : LAB.faint
      ctx.fillRect(x, isBar ? b.y : y0, isBar ? 1.5 * u : 1 * u, isBar ? b.h : h)
      if (isBar) { ctx.font = `500 ${18 * u}px ${MONO}`; ctx.fillStyle = LAB.mute; ctx.fillText(String(bt / 4 + 1), x + 8 * u, b.y + 24 * u) }
    }
    ctx.fillStyle = LAB.rule; ctx.fillRect(b.x, y0, b.w, 1.2 * u)
    let activeRow = -1
    F.notes(left, left + span, (s, e, midi, vel) => {
      if (midi < lo || midi >= hi) return
      const y = y0 + h - (midi - lo + 1) * rowH, x = x0 + (s - left) * ppf, nw = Math.max(4 * u, (e - s) * ppf - 2 * u)
      const on = s <= F.i && F.i < e
      ctx.fillStyle = on ? rgba(A, 1) : s > F.i ? `rgba(38,40,44,${0.45 + 0.4 * vel})` : `rgba(38,40,44,${0.18 + 0.22 * vel})`
      ctx.fillRect(x, y + rowH * 0.12, nw, Math.max(2 * u, rowH * 0.76))
      if (on) activeRow = y
    })
    if (activeRow >= 0) { ctx.fillStyle = rgba(A, 1); ctx.fillRect(b.x, activeRow + rowH * 0.12, gut - 8 * u, Math.max(2 * u, rowH * 0.76)) }
    ctx.fillStyle = LAB.ink; ctx.fillRect(phx - 1.5 * u, b.y, 3 * u, b.h)
    ctx.restore()
  }

  // ---- bar dial: the hand sweeps the bar, kicks leave marks where they landed
  {
    const b = B.dial, cx = b.x + b.w / 2, cy = b.y + b.h / 2 + 14 * u, r = Math.min(b.w, b.h) * 0.36
    ctx.fillStyle = rgba(A, 1); ctx.fillRect(b.x, b.y, 18 * u, 18 * u)
    ctx.font = `600 ${20 * u}px ${MONO}`; ctx.fillStyle = LAB.ink; ctx.textBaseline = 'top'; ctx.fillText('CH 1', b.x + 30 * u, b.y - 1 * u); ctx.textBaseline = 'alphabetic'
    ctx.strokeStyle = LAB.rule; ctx.lineWidth = 1.5 * u
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.stroke()
    for (let t = 0; t < 16; t++) {
      const a = (t / 16) * Math.PI * 2 - Math.PI / 2, major = t % 4 === 0
      const r1 = r * (major ? 1.08 : 1.03), r2 = r * (major ? 1.2 : 1.07)
      ctx.lineWidth = (major ? 2 : 1.2) * u; ctx.strokeStyle = major ? LAB.ink : LAB.mute
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke()
      if (major) {
        const beatNo = t / 4 + 1, on = Math.floor(F.inBar) + 1 === beatNo
        ctx.font = `500 ${20 * u}px ${MONO}`; ctx.fillStyle = on ? rgba(A, 1) : LAB.mute; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(beatNo), cx + Math.cos(a) * r * 1.36, cy + Math.sin(a) * r * 1.36)
      }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `500 ${16 * u}px ${MONO}`; ctx.fillStyle = LAB.mute; ctx.fillText('BAR', cx, cy - r * 0.14)
    ctx.font = `600 ${42 * u}px ${MONO}`; ctx.fillStyle = LAB.ink; ctx.fillText(String(F.bar), cx, cy + r * 0.1)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    const barStart = F.origin + (F.bar - 1) * 4 * F.P
    const mark = (list: Int32Array, amp: Float32Array, rad: number, from: number, alpha: number, width: number) => {
      for (let j = 0; j < list.length; j++) {
        const fr = list[j]
        if (fr < from || fr >= from + 4 * F.P || fr > F.i) continue
        const a = ((fr - from) / (4 * F.P)) * Math.PI * 2 - Math.PI / 2
        ctx.strokeStyle = rgba(A, alpha * (0.4 + 0.6 * amp[j])); ctx.lineWidth = width
        ctx.beginPath(); ctx.arc(cx, cy, rad, a - 0.09, a + 0.09); ctx.stroke()
      }
    }
    ctx.lineCap = 'round'
    mark(F.f.kicks, F.f.kickAmp, r * 0.62, barStart - 4 * F.P, 0.3, 7 * u)
    mark(F.f.kicks, F.f.kickAmp, r * 0.78, barStart, 1, 9 * u)
    mark(F.f.snaps, F.f.snapAmp, r * 0.9, barStart, 0.45, 4 * u)
    const ha = (F.inBar / 4) * Math.PI * 2 - Math.PI / 2
    ctx.strokeStyle = LAB.ink; ctx.lineWidth = 3 * u
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(ha) * r * 0.36, cy + Math.sin(ha) * r * 0.36); ctx.lineTo(cx + Math.cos(ha) * r * 1.02, cy + Math.sin(ha) * r * 1.02); ctx.stroke()
    ctx.lineCap = 'butt'
    ctx.fillStyle = rgba(A, 1); ctx.beginPath(); ctx.arc(cx + Math.cos(ha) * r * 0.78, cy + Math.sin(ha) * r * 0.78, (7 + 5 * F.kick) * u, 0, Math.PI * 2); ctx.fill()
  }

  // ---- waveform with the short-term loudness line
  {
    const b = B.wave
    labPanel(k, b, 'WAVEFORM', 'LOUDNESS S')
    const x0 = b.x + 12 * u, w = b.w - 24 * u, y0 = b.y + 44 * u, h = b.h - 56 * u, mid = y0 + h / 2
    const back = 3 * F.f.fps, fwd = 1 * F.f.fps, ppf = w / (back + fwd), ph = x0 + back * ppf
    for (let x = 0; x < w; x += 3 * u) {
      const fr = F.i - back + x / ppf, v = fr < 0 || fr >= F.f.frames ? 0 : Math.max(0.03, F.rmsAt(fr) * (0.55 + 0.45 * Math.abs(F.wave(hash(Math.floor(fr), 2), Math.round(F.i - fr)))))
      ctx.fillStyle = fr <= F.i ? LAB.ink : LAB.ghost
      ctx.fillRect(x0 + x, mid - v * h * 0.42, 1.6 * u, 2 * v * h * 0.42 + 1)
    }
    ctx.beginPath()
    const st = F.f.fps * 3
    for (let x = 0; x <= w; x += 4 * u) {
      const fr = Math.floor(F.i - back + x / ppf)
      let sum = 0, n = 0
      for (let j = Math.max(0, fr - st); j <= Math.min(F.f.frames - 1, fr); j += 3) { sum += F.f.rms[j]; n++ }
      const y = y0 + h - (n ? sum / n : 0) * h * 0.9
      if (x === 0) ctx.moveTo(x0 + x, y); else ctx.lineTo(x0 + x, y)
    }
    ctx.strokeStyle = rgba(A, 1); ctx.lineWidth = 2.5 * u; ctx.stroke()
    ctx.fillStyle = rgba(A, 1); ctx.fillRect(ph - 1 * u, y0 - 6 * u, 2 * u, h + 6 * u)
  }

  // ---- scope, spectrum, vectorscope
  {
    const b = B.meters, gap = 14 * u, bw = (b.w - 2 * gap) / 3
    const boxes = [0, 1, 2].map((i) => ({ x: b.x + i * (bw + gap), y: b.y, w: bw, h: b.h }))
    const inner = (bx: Box) => ({ x: bx.x + 10 * u, y: bx.y + 42 * u, w: bx.w - 20 * u, h: bx.h - 52 * u })
    labPanel(k, boxes[0], 'SCOPE'); labPanel(k, boxes[1], 'SPECTRUM'); labPanel(k, boxes[2], 'VECTOR')
    const grid = (r: Box) => { ctx.fillStyle = LAB.faint; for (let i = 1; i < 4; i++) { ctx.fillRect(r.x + (r.w * i) / 4, r.y, 1 * u, r.h); ctx.fillRect(r.x, r.y + (r.h * i) / 4, r.w, 1 * u) } }
    const s = inner(boxes[0]); grid(s)
    ctx.beginPath()
    for (let i = 0; i <= 80; i++) { const x = s.x + (i / 80) * s.w, y = s.y + s.h / 2 - F.wave(i / 80) * s.h * 0.45; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) }
    ctx.strokeStyle = rgba(A, 1); ctx.lineWidth = 2 * u; ctx.stroke()
    const p = inner(boxes[1]), n = 14, cw = p.w / n
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n, v = F.band(x), hv = F.hold(x, 20)
      ctx.fillStyle = LAB.ink; ctx.fillRect(p.x + i * cw + cw * 0.18, p.y + p.h - v * p.h, cw * 0.64, v * p.h)
      ctx.fillStyle = rgba(A, 1); ctx.fillRect(p.x + i * cw + cw * 0.18, p.y + p.h - hv * p.h - 6 * u, cw * 0.64, 2.5 * u)
    }
    const v = inner(boxes[2]), vx = v.x + v.w / 2, vy = v.y + v.h / 2, vr = Math.min(v.w, v.h) * 0.46
    ctx.strokeStyle = LAB.faint; ctx.lineWidth = 1.2 * u
    ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.moveTo(vx - vr * 0.7, vy - vr * 0.7); ctx.lineTo(vx + vr * 0.7, vy + vr * 0.7); ctx.moveTo(vx + vr * 0.7, vy - vr * 0.7); ctx.lineTo(vx - vr * 0.7, vy + vr * 0.7); ctx.stroke()
    ctx.fillStyle = rgba(A, 0.75)
    const base = F.i * VEC * 2
    for (let j = 0; j < VEC; j++) {
      const L = F.f.vec[base + 2 * j] / 127, R = F.f.vec[base + 2 * j + 1] / 127
      ctx.fillRect(vx + (L - R) * vr * 0.62 - 1.5 * u, vy - (L + R) * vr * 0.5 - 1.5 * u, 3 * u, 3 * u)
    }
  }

  // ---- note highway: the transcribed notes come down twelve pitch lanes
  {
    const b = B.hwy
    labPanel(k, b)
    let score = 0, combo = 0
    F.notes(0, F.i + 1, (s, _e, _m, vel) => { if (s <= F.i) score += Math.round(10 + vel * 90) * 10 })
    const ks = F.f.kicks
    let jLast = -1
    for (let j = 0; j < ks.length && ks[j] <= F.i; j++) jLast = j
    if (jLast >= 0 && F.i - ks[jLast] < 2.5 * F.P) { combo = 1; for (let j = jLast; j > 0 && ks[j] - ks[j - 1] < 2.5 * F.P; j--) combo++ }
    score += (jLast + 1) * 50
    ctx.font = `600 ${22 * u}px ${MONO}`; ctx.fillStyle = LAB.ink; ctx.textBaseline = 'top'
    ctx.fillText(`SCORE ${pad(score, 7)}`, b.x + 18 * u, b.y + 14 * u)
    ctx.fillStyle = rgba(A, 1); ctx.textAlign = 'right'
    ctx.fillText(`${combo} COMBO  ×${1 + Math.floor(combo / 16)}`, b.x + b.w - 50 * u, b.y + 14 * u)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    const lanes = 12, hitY = b.y + b.h - 44 * u, topY = b.y + 50 * u, cx = b.x + b.w / 2 - 20 * u
    const spanHit = b.w * 0.8, spanTop = b.w * 0.16
    const laneX = (l: number, p: number) => cx + ((l + 0.5) / lanes - 0.5) * lerp(spanTop, spanHit, p)
    ctx.strokeStyle = LAB.faint; ctx.lineWidth = 1.2 * u
    for (let l = 0; l <= lanes; l++) { ctx.beginPath(); ctx.moveTo(cx + (l / lanes - 0.5) * spanTop, topY); ctx.lineTo(cx + (l / lanes - 0.5) * spanHit, hitY); ctx.stroke() }
    for (let d = 0; d < 6; d++) { const p = Math.pow(((d + (F.beat % 1)) / 6), 2); const y = lerp(topY, hitY, p); ctx.fillStyle = LAB.faint; ctx.fillRect(cx - lerp(spanTop, spanHit, p) / 2, y, lerp(spanTop, spanHit, p), 1 * u) }
    const look = 2.2 * F.f.fps
    const lit = new Set<number>()
    F.notes(F.i - 2, F.i + look, (s, e, midi, vel) => {
      const lane = ((midi % 12) + 12) % 12
      if (s <= F.i && F.i < e) { lit.add(lane); return }
      if (s < F.i) return
      const z = (s - F.i) / look, p = Math.pow(1 - z, 2), y = lerp(topY, hitY, p), sc = lerp(0.25, 1, p)
      ctx.fillStyle = `rgba(38,40,44,${0.35 + 0.6 * vel * p})`
      rr(ctx, laneX(lane, p) - 15 * u * sc, y - 5 * u * sc, 30 * u * sc, 10 * u * sc, 5 * u * sc); ctx.fill()
    })
    for (let l = 0; l < lanes; l++) {
      const x = laneX(l, 1), on = lit.has(l)
      ctx.strokeStyle = on ? rgba(A, 1) : LAB.rule; ctx.lineWidth = 2 * u
      ctx.beginPath(); ctx.arc(x, hitY, 13 * u, 0, Math.PI * 2); ctx.stroke()
      if (on) {
        ctx.fillStyle = rgba(A, 0.9); ctx.beginPath(); ctx.arc(x, hitY, 9 * u, 0, Math.PI * 2); ctx.fill()
        ctx.font = `500 ${15 * u}px ${MONO}`; ctx.fillStyle = LAB.ink; ctx.textAlign = 'center'; ctx.fillText(NAMES[l], x, hitY - 22 * u); ctx.textAlign = 'left'
      }
    }
    ctx.font = `500 ${15 * u}px ${MONO}`; ctx.fillStyle = LAB.mute
    ctx.fillText('TRACK', b.x + 18 * u, b.y + b.h - 12 * u)
    ctx.textAlign = 'right'; ctx.fillText(`${Math.round(F.f.bpm)} BPM`, b.x + b.w - 50 * u, b.y + b.h - 12 * u); ctx.textAlign = 'left'
    const mh = b.h - 70 * u, my = b.y + 50 * u
    ctx.strokeStyle = LAB.rule; ctx.lineWidth = 1.2 * u; ctx.strokeRect(b.x + b.w - 30 * u, my, 10 * u, mh)
    ctx.fillStyle = LAB.ink; ctx.fillRect(b.x + b.w - 28 * u, my + mh * (1 - F.rms), 6 * u, mh * F.rms)
  }

  // ---- key pads: pitch classes lit from the chroma, the key's scale dotted
  {
    const b = B.pads, sc = scaleOf(meta.key)
    const rows = tall ? 2 : 4, cols = 12 / rows, gap = 10 * u, pw = (b.w - (cols - 1) * gap) / cols, ph = (b.h - (rows - 1) * gap) / rows
    const ch = F.i * 12
    let lastOct = 4
    F.notes(F.i - 1, F.i + 1, (_s, _e, midi) => { lastOct = Math.floor(midi / 12) - 1 })
    for (let p = 0; p < 12; p++) {
      const x = b.x + (p % cols) * (pw + gap), y = b.y + Math.floor(p / cols) * (ph + gap)
      const v = F.f.chroma[ch + p] / 255, on = v > 0.82 && F.rms > 0.12
      ctx.fillStyle = on ? rgba(A, 0.25 + 0.75 * v) : LAB.panel
      ctx.fillRect(x, y, pw, ph)
      ctx.strokeStyle = on ? rgba(A, 1) : LAB.rule; ctx.lineWidth = 1.5 * u; ctx.strokeRect(x, y, pw, ph)
      ctx.font = `500 ${17 * u}px ${MONO}`; ctx.fillStyle = on ? '#fff' : LAB.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(on ? `${NAMES[p]}${lastOct}` : NAMES[p], x + pw / 2, y + ph / 2)
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      if (sc.has(p)) { ctx.fillStyle = on ? '#fff' : LAB.mute; ctx.beginPath(); ctx.arc(x + pw - 9 * u, y + 9 * u, 3 * u, 0, Math.PI * 2); ctx.fill() }
    }
  }

  // ---- footer
  {
    const b = B.foot
    ctx.font = `500 ${18 * u}px ${MONO}`; ctx.fillStyle = LAB.mute; ctx.textBaseline = 'middle'
    if (meta.footer) spaced(ctx, meta.footer.toUpperCase(), b.x, b.y, 2 * u)
    ctx.textAlign = 'right'; ctx.fillText(`${clock(F.t)} / ${clock(F.dur)}`, b.x + b.w, b.y); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }
}

// ================================================================ TAPE: a worn deck on cardboard

const TAPE = { board: '#cbb895', boardDark: '#b8a37d', ink: '#2a231b', cream: '#efe5cf', shell: '#36302a', shellHi: '#4a423a', window: '#1b1815', pack: '#5a3b28', paper: '#f2ead8' }

function tapeBoxes(W: number, H: number, tall: boolean) {
  if (tall) return { stamp: { x: 70, y: 70, w: 940, h: 90 }, cass: { x: 70, y: 190, w: 940, h: 600 }, vuL: { x: 70, y: 850, w: 450, h: 320 }, vuR: { x: 560, y: 850, w: 450, h: 320 }, deck: { x: 70, y: 1210, w: 940, h: 140 }, print: { x: 40, y: 1400, w: 1000, h: 380 }, foot: { x: 70, y: 1850, w: 940, h: 0 } }
  const m = Math.round(W * 0.035), cw = Math.round(H * 0.95), rx = m + cw + 40, rw = W - m - rx
  return { stamp: { x: m, y: 30, w: cw, h: 70 }, cass: { x: m, y: 110, w: cw, h: cw * 0.62 }, vuL: { x: rx, y: 110, w: rw / 2 - 12, h: rw * 0.5 }, vuR: { x: rx + rw / 2 + 12, y: 110, w: rw / 2 - 12, h: rw * 0.5 }, deck: { x: rx, y: 150 + rw * 0.5, w: rw, h: 130 }, print: { x: 0, y: H - 330, w: W, h: 270 }, foot: { x: m, y: H - 26, w: W - 2 * m, h: 0 } }
}

// a real VU scale is not linear in dB: these are the needle positions of the printed marks
const VU_MARKS: [number, number][] = [[-20, 0], [-10, 0.26], [-7, 0.38], [-5, 0.48], [-3, 0.6], [-2, 0.67], [-1, 0.74], [0, 0.81], [1, 0.87], [2, 0.93], [3, 1]]
function vuPos(db: number): number {
  for (let i = 1; i < VU_MARKS.length; i++) if (db <= VU_MARKS[i][0]) { const [d0, p0] = VU_MARKS[i - 1], [d1, p1] = VU_MARKS[i]; return lerp(p0, p1, (db - d0) / (d1 - d0)) }
  return 1.04
}

function vuMeter(k: Kit, b: Box, needle: number, label: string): void {
  const { ctx, u, A } = k
  ctx.fillStyle = TAPE.shell; rr(ctx, b.x, b.y, b.w, b.h, 18 * u); ctx.fill()
  const f = { x: b.x + 16 * u, y: b.y + 16 * u, w: b.w - 32 * u, h: b.h - 32 * u }
  const lamp = ctx.createRadialGradient(f.x + f.w / 2, f.y + f.h * 0.8, 10, f.x + f.w / 2, f.y + f.h * 0.6, f.w * 0.75)
  lamp.addColorStop(0, '#f7e7b6'); lamp.addColorStop(1, '#d9c38f')
  ctx.fillStyle = lamp; rr(ctx, f.x, f.y, f.w, f.h, 8 * u); ctx.fill()
  const px = f.x + f.w / 2, py = f.y + f.h * 1.02, R = Math.min(f.h * 0.8, f.w * 0.52)
  const ang = (p: number) => lerp(-0.85, 0.85, p) - Math.PI / 2
  ctx.lineWidth = 2 * u; ctx.strokeStyle = TAPE.ink
  ctx.beginPath(); ctx.arc(px, py, R, ang(0), ang(VU_MARKS[7][1])); ctx.stroke()
  ctx.lineWidth = 8 * u; ctx.strokeStyle = rgba(A, 0.95)
  ctx.beginPath(); ctx.arc(px, py, R + 3 * u, ang(VU_MARKS[7][1]), ang(1)); ctx.stroke()
  ctx.font = `600 ${16 * u}px ${COND}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (const [db, p] of VU_MARKS) {
    const a = ang(p)
    ctx.strokeStyle = db >= 0 ? rgba(A, 1) : TAPE.ink; ctx.lineWidth = 2 * u
    ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * R, py + Math.sin(a) * R); ctx.lineTo(px + Math.cos(a) * (R + 14 * u), py + Math.sin(a) * (R + 14 * u)); ctx.stroke()
    if ([-20, -10, -5, -3, 0, 3].includes(db)) { ctx.fillStyle = db >= 0 ? rgba(A, 1) : TAPE.ink; ctx.fillText(db > 0 ? `+${db}` : String(db), px + Math.cos(a) * (R + 30 * u), py + Math.sin(a) * (R + 30 * u)) }
  }
  ctx.font = `700 ${34 * u}px ${COND}`; ctx.fillStyle = TAPE.ink; ctx.fillText('VU', px, f.y + f.h * 0.66)
  ctx.font = `600 ${18 * u}px ${COND}`; ctx.fillText(label, f.x + 22 * u, f.y + f.h - 20 * u)
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  const a = ang(vuPos(-20 + 23 * needle)), len = R * 1.06
  for (const [off, col, w] of [[6 * u, 'rgba(60,40,10,0.22)', 3.5 * u], [0, TAPE.ink, 2.6 * u]] as const) {
    ctx.strokeStyle = col; ctx.lineWidth = w
    ctx.beginPath(); ctx.moveTo(px + off, py + off * 0.4); ctx.lineTo(px + Math.cos(a) * len + off, py + Math.sin(a) * len + off * 0.4); ctx.stroke()
  }
  const glare = ctx.createLinearGradient(f.x, f.y, f.x + f.w * 0.6, f.y + f.h)
  glare.addColorStop(0, 'rgba(255,255,255,0.22)'); glare.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = glare; rr(ctx, f.x, f.y, f.w, f.h, 8 * u); ctx.fill()
}

function tape(k: Kit, stains: HTMLCanvasElement): void {
  const { ctx, W, H, F, u, meta, A, tall } = k
  const B = tapeBoxes(W, H, tall)
  ctx.fillStyle = TAPE.board; ctx.fillRect(0, 0, W, H)
  ctx.drawImage(stains, 0, 0, W, H)

  // stamped header
  {
    const b = B.stamp
    ctx.save(); ctx.translate(b.x, b.y + b.h * 0.75); ctx.rotate(-0.025)
    ctx.font = `700 ${74 * u}px ${COND}`; ctx.fillStyle = 'rgba(42,35,27,0.82)'; ctx.fillText('SIDE A', 0, 0)
    const sw = ctx.measureText('SIDE A').width
    ctx.strokeStyle = 'rgba(42,35,27,0.7)'; ctx.lineWidth = 4 * u; ctx.strokeRect(-14 * u, -66 * u, sw + 28 * u, 78 * u)
    ctx.restore()
    ctx.font = `500 ${20 * u}px ${MONO}`; ctx.fillStyle = TAPE.ink; ctx.textAlign = 'right'
    ctx.fillText('TYPE II · HIGH BIAS · 70µs', b.x + b.w, b.y + b.h * 0.5)
    ctx.fillText(`${meta.bpm ? Math.round(meta.bpm) + ' BPM' : ''}${meta.key ? ' · ' + shortKey(meta.key) : ''}`, b.x + b.w, b.y + b.h * 0.5 + 28 * u)
    ctx.textAlign = 'left'
  }

  // the cassette
  {
    const b = B.cass, bump = F.kick * 3 * u
    ctx.save(); ctx.translate(0, bump)
    ctx.fillStyle = 'rgba(40,25,10,0.28)'; rr(ctx, b.x + 12 * u, b.y + 16 * u, b.w, b.h, 26 * u); ctx.fill()
    ctx.fillStyle = TAPE.shell; rr(ctx, b.x, b.y, b.w, b.h, 26 * u); ctx.fill()
    ctx.strokeStyle = TAPE.shellHi; ctx.lineWidth = 3 * u; rr(ctx, b.x + 8 * u, b.y + 8 * u, b.w - 16 * u, b.h - 16 * u, 20 * u); ctx.stroke()
    for (const [sx, sy] of [[0.035, 0.05], [0.965, 0.05], [0.035, 0.93], [0.965, 0.93], [0.5, 0.93]]) {
      const x = b.x + b.w * sx, y = b.y + b.h * sy
      ctx.fillStyle = '#7d7468'; ctx.beginPath(); ctx.arc(x, y, 9 * u, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#3a342d'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(x - 6 * u, y - 2 * u); ctx.lineTo(x + 6 * u, y + 2 * u); ctx.stroke()
    }
    // label
    const l = { x: b.x + b.w * 0.07, y: b.y + b.h * 0.08, w: b.w * 0.86, h: b.h * 0.6 }
    ctx.fillStyle = TAPE.cream; rr(ctx, l.x, l.y, l.w, l.h, 10 * u); ctx.fill()
    ctx.fillStyle = rgba(A, 0.92); ctx.fillRect(l.x, l.y + l.h * 0.62, l.w, l.h * 0.09)
    ctx.fillStyle = 'rgba(42,35,27,0.18)'
    for (let i = 1; i <= 3; i++) ctx.fillRect(l.x + 24 * u, l.y + l.h * (0.12 + i * 0.13), l.w - 48 * u, 1.5 * u)
    ctx.font = `600 ${20 * u}px ${COND}`; ctx.fillStyle = TAPE.ink; ctx.fillText('A', l.x + 22 * u, l.y + 34 * u)
    ctx.save(); ctx.translate(l.x + l.w / 2, l.y + l.h * 0.36); ctx.rotate(-0.018)
    ctx.textAlign = 'center'; ctx.fillStyle = '#1d2a4a'
    fit(ctx, meta.title, (s) => `600 ${s}px ${HAND}`, 92 * u, l.w * 0.82)
    ctx.fillText(meta.title, 0, 0)
    if (meta.tagline) { fit(ctx, meta.tagline, (s) => `600 ${s}px ${HAND}`, 44 * u, l.w * 0.8); ctx.fillText(meta.tagline, 0, 54 * u) }
    ctx.restore()
    // window and reels
    const w = { x: b.x + b.w * 0.25, y: l.y + l.h * 0.74, w: b.w * 0.5, h: l.h * 0.22 }
    const reelY = w.y + w.h / 2, cxL = w.x + w.w * 0.2, cxR = w.x + w.w * 0.8
    const rMax = w.w * 0.3, rMin = w.w * 0.11
    const rL = Math.sqrt(lerp(rMax * rMax, rMin * rMin, F.progress)), rR = Math.sqrt(lerp(rMin * rMin, rMax * rMax, F.progress))
    ctx.save(); rr(ctx, w.x, w.y, w.w, w.h, 12 * u); ctx.clip()
    ctx.fillStyle = TAPE.window; ctx.fillRect(w.x, w.y, w.w, w.h)
    for (const [cx, r] of [[cxL, rL], [cxR, rR]]) {
      ctx.fillStyle = TAPE.pack; ctx.beginPath(); ctx.arc(cx, reelY, r, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(255,220,180,0.08)'; ctx.lineWidth = 1 * u
      for (let rr2 = rMin * 1.1; rr2 < r; rr2 += 5 * u) { ctx.beginPath(); ctx.arc(cx, reelY, rr2, 0, Math.PI * 2); ctx.stroke() }
    }
    ctx.strokeStyle = TAPE.pack; ctx.lineWidth = 3 * u
    ctx.beginPath(); ctx.moveTo(cxL, reelY + rL); ctx.lineTo(cxR, reelY + rR); ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = '#6d655b'; ctx.lineWidth = 3 * u; rr(ctx, w.x, w.y, w.w, w.h, 12 * u); ctx.stroke()
    for (const [cx, r, dir] of [[cxL, rL, 1], [cxR, rR, 1]] as const) {
      const wob = 0.04 * Math.sin(F.t * 5.3)
      const theta = dir * (F.t * 2.4 * (rMax / r) + wob)
      const hub = rMin * 0.78
      ctx.fillStyle = '#e8e0cf'; ctx.beginPath(); ctx.arc(cx, reelY, hub, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = TAPE.window; ctx.beginPath(); ctx.arc(cx, reelY, hub * 0.55, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#e8e0cf'
      for (let t = 0; t < 6; t++) {
        const a = theta + (t / 6) * Math.PI * 2
        ctx.save(); ctx.translate(cx + Math.cos(a) * hub * 0.5, reelY + Math.sin(a) * hub * 0.5); ctx.rotate(a); ctx.fillRect(-hub * 0.16, -hub * 0.08, hub * 0.24, hub * 0.16); ctx.restore()
      }
    }
    // lower head opening
    ctx.fillStyle = TAPE.shellHi
    ctx.beginPath(); ctx.moveTo(b.x + b.w * 0.2, b.y + b.h); ctx.lineTo(b.x + b.w * 0.26, b.y + b.h * 0.8); ctx.lineTo(b.x + b.w * 0.74, b.y + b.h * 0.8); ctx.lineTo(b.x + b.w * 0.8, b.y + b.h); ctx.closePath(); ctx.fill()
    ctx.fillStyle = TAPE.window
    for (const hx of [0.33, 0.42, 0.5, 0.58, 0.67]) { rr(ctx, b.x + b.w * hx - 12 * u, b.y + b.h * 0.86, 24 * u, 24 * u, 4 * u); ctx.fill() }
    ctx.restore()
  }

  vuMeter(k, B.vuL, F.f.vuL[F.i], 'LEFT')
  vuMeter(k, B.vuR, F.f.vuR[F.i], 'RIGHT')

  // counter, transport keys, peak lamp
  {
    const b = B.deck
    const cw = b.w * 0.28
    ctx.fillStyle = TAPE.shell; rr(ctx, b.x, b.y, cw, b.h, 12 * u); ctx.fill()
    const count = F.t * 1.7, dw = (cw - 40 * u) / 3, dh = b.h - 40 * u
    for (let d = 0; d < 3; d++) {
      // each drum snaps over in the last quarter of its count, like a mechanical counter
      const place = Math.pow(10, 2 - d), v = (count / place) % 10, roll = clamp(((count % place) - (place - 0.25)) / 0.25)
      const x = b.x + 20 * u + d * dw, y = b.y + 20 * u
      ctx.save(); ctx.beginPath(); ctx.rect(x + 3 * u, y, dw - 6 * u, dh); ctx.clip()
      ctx.fillStyle = '#efe9dc'; ctx.fillRect(x + 3 * u, y, dw - 6 * u, dh)
      ctx.font = `600 ${dh * 0.72}px ${MONO}`; ctx.fillStyle = TAPE.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const n = Math.floor(v)
      ctx.fillText(String(n % 10), x + dw / 2, y + dh / 2 - roll * dh)
      ctx.fillText(String((n + 1) % 10), x + dw / 2, y + dh / 2 + (1 - roll) * dh)
      const shade = ctx.createLinearGradient(0, y, 0, y + dh); shade.addColorStop(0, 'rgba(0,0,0,0.35)'); shade.addColorStop(0.3, 'rgba(0,0,0,0)'); shade.addColorStop(0.7, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.35)')
      ctx.fillStyle = shade; ctx.fillRect(x + 3 * u, y, dw - 6 * u, dh)
      ctx.restore()
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const keys = ['REW', 'PLAY', 'FF', 'STOP', 'REC'], kx = b.x + cw + 24 * u, kw = (b.w - cw - 24 * u - 130 * u) / keys.length
    keys.forEach((name, i) => {
      const down = name === 'PLAY', x = kx + i * kw, y = b.y + (down ? 10 * u : 0)
      ctx.fillStyle = 'rgba(40,25,10,0.3)'; rr(ctx, x + 6 * u, b.y + 14 * u, kw - 12 * u, b.h - 14 * u, 8 * u); ctx.fill()
      ctx.fillStyle = down ? '#d9cfb9' : TAPE.cream; rr(ctx, x + 4 * u, y, kw - 12 * u, b.h - 16 * u, 8 * u); ctx.fill()
      ctx.font = `700 ${24 * u}px ${COND}`; ctx.fillStyle = TAPE.ink; ctx.fillText(name, x + kw / 2 - 4 * u, y + (b.h - 16 * u) / 2)
      if (name === 'REC') { ctx.fillStyle = rgba(A, 1); ctx.beginPath(); ctx.arc(x + kw - 26 * u, y + 18 * u, 5 * u, 0, Math.PI * 2); ctx.fill() }
    })
    const lx = b.x + b.w - 55 * u, ly = b.y + b.h * 0.4, hot = Math.max(F.kick > 0.55 ? F.kick : 0, F.f.vuL[F.i] > 0.95 ? 1 : 0)
    ctx.fillStyle = '#4a2a1c'; ctx.beginPath(); ctx.arc(lx, ly, 18 * u, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = rgba(A, 0.25 + 0.75 * hot); ctx.beginPath(); ctx.arc(lx, ly, 13 * u, 0, Math.PI * 2); ctx.fill()
    ctx.font = `600 ${17 * u}px ${COND}`; ctx.fillStyle = TAPE.ink; ctx.fillText('PEAK', lx, ly + 36 * u)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  // pen-plotter printout, scrolling under the pen
  {
    const b = B.print
    ctx.fillStyle = 'rgba(40,25,10,0.22)'; ctx.fillRect(b.x + 8 * u, b.y + 10 * u, b.w, b.h)
    ctx.fillStyle = TAPE.paper; ctx.fillRect(b.x, b.y, b.w, b.h)
    const holes = 22 * u, hy = [b.y + holes, b.y + b.h - holes]
    const fps = F.f.fps, ppf = 7 * u, penX = b.x + b.w * 0.8, scroll = F.i * ppf
    ctx.fillStyle = TAPE.board
    for (const y of hy) for (let x = b.x + 20 * u - (scroll % (40 * u)); x < b.x + b.w; x += 40 * u) { ctx.beginPath(); ctx.arc(x, y, 7 * u, 0, Math.PI * 2); ctx.fill() }
    const g0 = b.y + 50 * u, gh = b.h - 100 * u, mid = g0 + gh / 2
    ctx.fillStyle = 'rgba(160,80,50,0.18)'
    for (let x = b.x - (scroll % (30 * u)); x < b.x + b.w; x += 30 * u) ctx.fillRect(x, g0, 1 * u, gh)
    for (let y = g0; y <= g0 + gh; y += gh / 8) ctx.fillRect(b.x, y, b.w, 1 * u)
    // bar stamps and red kick ticks
    const barF = 4 * F.P
    const firstBar = Math.floor((F.i - (penX - b.x) / ppf - F.origin) / barF)
    for (let n = firstBar; n <= firstBar + 12; n++) {
      const fr = F.origin + n * barF, x = penX - (F.i - fr) * ppf
      if (x < b.x || x > penX) continue
      ctx.fillStyle = 'rgba(42,35,27,0.55)'; ctx.fillRect(x, g0 - 8 * u, 1.5 * u, gh + 16 * u)
      ctx.font = `700 ${26 * u}px ${COND}`; ctx.fillStyle = 'rgba(42,35,27,0.7)'; ctx.fillText(pad(n + 1, 3), x + 6 * u, g0 + 2 * u)
    }
    for (let j = 0; j < F.f.kicks.length; j++) {
      const x = penX - (F.i - F.f.kicks[j]) * ppf
      if (x < b.x || x > penX) continue
      ctx.fillStyle = rgba(A, 0.85); ctx.fillRect(x - 1.5 * u, g0 + gh - 10 * u, 3 * u, 22 * u)
    }
    ctx.beginPath()
    let first = true
    for (let x = b.x; x <= penX; x += 2 * u) {
      const fr = F.i - (penX - x) / ppf
      if (fr < 0) continue
      const sign = Math.floor(fr * 2) % 2 ? 1 : -1
      const y = mid + sign * F.peakAt(fr) * gh * 0.46 * (0.6 + 0.4 * hash(Math.floor(fr * 2), 7))
      if (first) { ctx.moveTo(x, y); first = false } else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(29,42,74,0.88)'; ctx.lineWidth = 1.8 * u; ctx.lineJoin = 'round'; ctx.stroke(); ctx.lineJoin = 'miter'
    const py = mid + (Math.floor(F.i * 2) % 2 ? 1 : -1) * F.peakAt(F.i) * gh * 0.46
    ctx.strokeStyle = TAPE.ink; ctx.lineWidth = 3 * u
    ctx.beginPath(); ctx.moveTo(penX, py); ctx.lineTo(penX + 60 * u, py - 90 * u); ctx.stroke()
    ctx.fillStyle = TAPE.ink; ctx.beginPath(); ctx.arc(penX, py, 5 * u, 0, Math.PI * 2); ctx.fill()
    void fps
  }

  // footer: handwritten credit
  {
    const b = B.foot
    ctx.font = `600 ${44 * u}px ${HAND}`; ctx.fillStyle = '#1d2a4a'; ctx.textBaseline = 'middle'
    if (meta.footer) ctx.fillText(meta.footer, b.x, b.y)
    ctx.font = `500 ${20 * u}px ${MONO}`; ctx.fillStyle = TAPE.ink; ctx.textAlign = 'right'
    ctx.fillText(`${clock(F.t)} / ${clock(F.dur)}`, b.x + b.w, b.y)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }
}

function makeStains(W: number, H: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = Math.round(W / 2); c.height = Math.round(H / 2)
  const g = c.getContext('2d')!
  g.scale(0.5, 0.5)
  for (let i = 0; i < 9; i++) {
    const x = hash(i, seed) * W, y = hash(i, seed + 1) * H, r = (0.1 + 0.25 * hash(i, seed + 2)) * W
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, 'rgba(120,85,40,0.10)'); gr.addColorStop(1, 'rgba(120,85,40,0)')
    g.fillStyle = gr; g.fillRect(0, 0, W, H)
  }
  // a coffee ring
  const x = W * (0.7 + 0.2 * hash(seed, 5)), y = H * (0.08 + 0.1 * hash(seed, 6)), r = W * 0.11
  g.strokeStyle = 'rgba(110,70,30,0.16)'; g.lineWidth = W * 0.008
  g.beginPath(); g.arc(x, y, r, 0.3, Math.PI * 1.85); g.stroke()
  g.lineWidth = W * 0.003; g.beginPath(); g.arc(x + 6, y - 4, r * 0.97, 0, Math.PI * 2); g.stroke()
  // vignette, the board darkening at the edges
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75)
  v.addColorStop(0, 'rgba(60,40,15,0)'); v.addColorStop(1, 'rgba(60,40,15,0.35)')
  g.fillStyle = v; g.fillRect(0, 0, W, H)
  return c
}

// ================================================================ RISO: a two-ink print

function risoInks(A: [number, number, number]): { one: string; two: string } {
  const blueish = A[2] > A[0] && A[2] > A[1] * 0.9
  return { one: rgba(A, 1), two: blueish ? '#d24a2e' : '#24409b' }
}

function risoBoxes(W: number, H: number, tall: boolean) {
  if (tall) return { img: { x: 70, y: 110, w: 940, h: 900 }, title: { x: 70, y: 1040, w: 940, h: 200 }, tag: { x: 70, y: 1262, w: 940, h: 50 }, steps: { x: 70, y: 1360, w: 940, h: 120 }, spec: { x: 70, y: 1520, w: 940, h: 250 }, foot: { x: 70, y: 1830, w: 940, h: 0 } }
  const m = Math.round(H * 0.07), s = H - 2 * m, rx = m + s + 50, rw = W - m - rx
  return { img: { x: m, y: m, w: s, h: s }, title: { x: rx, y: m - 10, w: rw, h: 190 }, tag: { x: rx, y: m + 200, w: rw, h: 44 }, steps: { x: rx, y: m + 290, w: rw, h: 110 }, spec: { x: rx, y: m + 440, w: rw, h: H - 2 * m - 520 }, foot: { x: rx, y: H - m, w: rw, h: 0 } }
}

interface Halftone { n: number; lum: Float32Array }

function halftoneSource(cover: CanvasImageSource | null, n: number, seed: number): Halftone {
  const lum = new Float32Array(n * n)
  if (cover) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = n
      const g = c.getContext('2d', { willReadFrequently: true })!
      const cw = (cover as HTMLImageElement).naturalWidth || (cover as ImageBitmap).width || n, ch = (cover as HTMLImageElement).naturalHeight || (cover as ImageBitmap).height || n
      const s = Math.min(cw, ch)
      g.drawImage(cover, (cw - s) / 2, (ch - s) / 2, s, s, 0, 0, n, n)
      const d = g.getImageData(0, 0, n, n).data
      let lo = 1, hi = 0
      for (let i = 0; i < n * n; i++) { const v = (0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) / 255; lum[i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v) }
      for (let i = 0; i < n * n; i++) lum[i] = (lum[i] - lo) / Math.max(0.1, hi - lo) // stretch, like a print operator would
      return { n, lum }
    } catch { /* fall through to the generated plate */ }
  }
  // no cover: a generated plate of overlapping discs, seeded by the title
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 1
    for (let i = 0; i < 4; i++) {
      const cx = hash(seed, i) * n, cy = hash(seed, i + 9) * n, r = (0.18 + 0.25 * hash(seed, i + 19)) * n
      const d = Math.hypot(x - cx, y - cy) / r
      if (d < 1) v *= 0.35 + 0.65 * d
    }
    lum[y * n + x] = v * (0.75 + 0.25 * (y / n))
  }
  return { n, lum }
}

function riso(k: Kit, ht: Halftone, grain: HTMLCanvasElement, speck: HTMLCanvasElement): void {
  const { ctx, W, H, F, u, meta, A, tall } = k
  const B = risoBoxes(W, H, tall)
  const ink = risoInks(A)
  const paper = '#f1ebdd'
  ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H)
  // the second drum drifts out of register a little, and jumps on each kick
  let kid = 0
  for (let j = 0; j < F.f.kicks.length && F.f.kicks[j] <= F.i; j++) kid = F.f.kicks[j]
  const jump = F.kick * 9 * u, dir = hash(kid, 3) * Math.PI * 2
  const off = { x: 3 * u + Math.cos(dir) * jump, y: -2 * u + Math.sin(dir) * jump }

  ctx.globalCompositeOperation = 'multiply'

  // plate 2: the cover as halftone, breathing with the low end
  {
    const b = B.img, n = ht.n, cell = b.w / n
    ctx.fillStyle = ink.two
    const swell = 0.9 + 0.18 * F.bass
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r = (1 - ht.lum[y * n + x]) * cell * 0.62 * swell
      if (r < cell * 0.06) continue
      ctx.beginPath(); ctx.arc(b.x + (x + 0.5 + (y % 2) * 0.5) * cell, b.y + (y + 0.5) * cell, r, 0, Math.PI * 2); ctx.fill()
    }
  }
  // plate 1: a flat sun that swells on the kick, plus a halftone gradient band
  {
    const b = B.img
    ctx.fillStyle = ink.one
    const r = b.w * (0.22 + 0.05 * F.kick + 0.03 * F.bass)
    const cx = b.x + b.w * (0.68 + 0.04 * Math.sin(F.t * 0.21)) + off.x, cy = b.y + b.h * (0.32 + 0.03 * Math.cos(F.t * 0.17)) + off.y
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    const cell = 18 * u, rows = Math.floor((b.h * 0.34) / cell)
    for (let y = 0; y < rows; y++) {
      const t = y / rows
      for (let x = 0; x * cell < b.w; x++) {
        const v = F.band((x * cell) / b.w)
        const rr2 = cell * 0.5 * clamp(t * 1.2) * (0.35 + 0.65 * v)
        if (rr2 < 0.8 * u) continue
        ctx.beginPath(); ctx.arc(b.x + (x + 0.5) * cell + off.x, b.y + b.h - (rows - y - 0.5) * cell + off.y, rr2, 0, Math.PI * 2); ctx.fill()
      }
    }
  }
  // title: plate 2 type with a plate 1 shadow
  {
    const b = B.title, text = meta.title.toUpperCase()
    const size = fit(ctx, text, (s) => `700 ${s}px ${COND}`, 230 * u, b.w, 40)
    ctx.textBaseline = 'alphabetic'
    const by = b.y + Math.min(b.h, size * 0.92)
    ctx.fillStyle = ink.one; ctx.fillText(text, b.x + off.x + 6 * u, by + off.y + 5 * u)
    ctx.fillStyle = ink.two; ctx.fillText(text, b.x, by)
    if (meta.tagline) { fit(ctx, meta.tagline, (s) => `italic 400 ${s}px ${SERIF}`, 44 * u, B.tag.w); ctx.fillText(meta.tagline, B.tag.x, B.tag.y + 36 * u) }
  }
  // the bar as a printed 16-step grid: kicks fill the steps they fell on, snares dot them
  {
    const b = B.steps, step = (4 * F.P) / 16, barStart = F.origin + (F.bar - 1) * 4 * F.P
    const cur = Math.floor((F.i - barStart) / step), cw = b.w / 16, s = Math.min(cw * 0.86, b.h - 40 * u)
    ctx.font = `500 ${20 * u}px ${MONO}`; ctx.fillStyle = ink.two
    ctx.fillText(`BAR ${pad(F.bar, 3)}   STEP ${pad(cur + 1, 2)}/16   ${Math.round(F.f.bpm)} BPM`, b.x, b.y + 18 * u)
    const hitK = new Float32Array(16), hitS = new Float32Array(16)
    const mark = (list: Int32Array, amp: Float32Array, into: Float32Array) => { for (let j = 0; j < list.length; j++) { const fr = list[j]; if (fr < barStart - step / 2 || fr > F.i) continue; const st = Math.round((fr - barStart) / step); if (st >= 0 && st < 16) into[st] = Math.max(into[st], amp[j]) } }
    mark(F.f.kicks, F.f.kickAmp, hitK); mark(F.f.snaps, F.f.snapAmp, hitS)
    for (let i = 0; i < 16; i++) {
      const x = b.x + i * cw + (cw - s) / 2, y = b.y + 36 * u
      ctx.strokeStyle = ink.two; ctx.lineWidth = (i === cur ? 5 : i % 4 === 0 ? 2.5 : 1.5) * u
      ctx.strokeRect(x, y, s, s)
      if (hitK[i]) { ctx.fillStyle = ink.one; ctx.fillRect(x + off.x * 0.5 + 4 * u, y + off.y * 0.5 + 4 * u, s - 8 * u, s - 8 * u) }
      if (hitS[i]) { ctx.fillStyle = ink.two; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.16, 0, Math.PI * 2); ctx.fill() }
    }
  }
  // spectrum as stacked halftone columns, with plate 1 caps
  {
    const b = B.spec, cols = 24, cw = b.w / cols, rows = Math.floor(b.h / cw)
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols, v = F.band(x), lit = v * rows
      ctx.fillStyle = ink.two
      for (let r = 0; r < rows; r++) {
        const f = clamp(lit - r)
        if (f <= 0) break
        ctx.beginPath(); ctx.arc(b.x + (c + 0.5) * cw, b.y + b.h - (r + 0.5) * cw, cw * 0.42 * (0.4 + 0.6 * f), 0, Math.PI * 2); ctx.fill()
      }
      const hv = F.hold(x, 22) * rows
      ctx.fillStyle = ink.one; ctx.fillRect(b.x + c * cw + cw * 0.12 + off.x, b.y + b.h - hv * cw - 6 * u + off.y, cw * 0.76, 7 * u)
    }
  }
  // footer and registration marks
  {
    const b = B.foot
    ctx.font = `700 ${40 * u}px ${COND}`; ctx.fillStyle = ink.two; ctx.textBaseline = 'middle'
    if (meta.footer) ctx.fillText(meta.footer.toUpperCase(), b.x, b.y)
    ctx.font = `500 ${20 * u}px ${MONO}`; ctx.textAlign = 'right'
    ctx.fillText(`${meta.key ? shortKey(meta.key) + '  ·  ' : ''}${clock(F.t)} / ${clock(F.dur)}`, b.x + b.w, b.y)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    const reg = (x: number, y: number, col: string, o: { x: number; y: number }) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5 * u
      ctx.beginPath(); ctx.arc(x + o.x, y + o.y, 12 * u, 0, Math.PI * 2); ctx.moveTo(x - 20 * u + o.x, y + o.y); ctx.lineTo(x + 20 * u + o.x, y + o.y); ctx.moveTo(x + o.x, y - 20 * u + o.y); ctx.lineTo(x + o.x, y + 20 * u + o.y); ctx.stroke()
    }
    for (const [x, y] of [[34 * u, 34 * u], [W - 34 * u, 34 * u], [34 * u, H - 34 * u], [W - 34 * u, H - 34 * u]]) { reg(x, y, ink.two, { x: 0, y: 0 }); reg(x, y, ink.one, off) }
  }
  ctx.globalCompositeOperation = 'source-over'
  // paper showing through the ink, and the paper's own grain
  texture(ctx, speck, W, H, 0.55)
  texture(ctx, grain, W, H, 0.5, 'multiply')
}

// ================================================================ COVER: the artwork, front and centre

/** The cover blown up and blurred into a backdrop, or an accent wash when there is no art. Built once. */
function coverBackdrop(W: number, H: number, cover: CanvasImageSource | null, A: [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!
  if (cover) {
    const cw = (cover as HTMLImageElement).naturalWidth || (cover as ImageBitmap).width || 1, ch = (cover as HTMLImageElement).naturalHeight || (cover as ImageBitmap).height || 1
    const s = Math.max(W / cw, H / ch) * 1.25
    g.filter = `blur(${Math.round(Math.max(W, H) / 28)}px) saturate(1.3)`
    g.drawImage(cover, (W - cw * s) / 2, (H - ch * s) / 2, cw * s, ch * s)
    g.filter = 'none'
  } else {
    const gr = g.createLinearGradient(0, 0, W, H)
    gr.addColorStop(0, rgba(A, 1)); gr.addColorStop(1, '#14161c')
    g.fillStyle = gr; g.fillRect(0, 0, W, H)
  }
  const v = g.createLinearGradient(0, 0, 0, H)
  v.addColorStop(0, 'rgba(8,9,12,0.45)'); v.addColorStop(1, 'rgba(8,9,12,0.82)')
  g.fillStyle = v; g.fillRect(0, 0, W, H)
  return c
}

function coverArt(ctx: Ctx, cover: CanvasImageSource | null, A: [number, number, number], title: string, x: number, y: number, s: number, r: number): void {
  ctx.save()
  rr(ctx, x, y, s, s, r); ctx.clip()
  if (cover) {
    const cw = (cover as HTMLImageElement).naturalWidth || (cover as ImageBitmap).width || 1, ch = (cover as HTMLImageElement).naturalHeight || (cover as ImageBitmap).height || 1
    const m = Math.min(cw, ch)
    ctx.drawImage(cover, (cw - m) / 2, (ch - m) / 2, m, m, x, y, s, s)
  } else {
    const gr = ctx.createLinearGradient(x, y, x + s, y + s)
    gr.addColorStop(0, rgba(A, 1)); gr.addColorStop(1, '#1b1d24')
    ctx.fillStyle = gr; ctx.fillRect(x, y, s, s)
    // no art: concentric rings, spaced by the title so each beat gets its own
    const seed = [...title].reduce((a, c) => a + c.charCodeAt(0), 0)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    for (let i = 1; i < 14; i++) { ctx.lineWidth = (1 + 3 * hash(seed, i)) * (s / 760); ctx.beginPath(); ctx.arc(x + s * 0.72, y + s * 0.3, s * (0.05 + i * 0.065 + 0.03 * hash(seed, i + 30)), 0, Math.PI * 2); ctx.stroke() }
  }
  ctx.restore()
}

function coverScene(k: Kit, bg: HTMLCanvasElement): void {
  const { ctx, W, H, F, u, meta, A, tall } = k
  ctx.drawImage(bg, 0, 0)
  const art = tall ? { x: 150, y: 250, s: 780 } : { x: Math.round(H * 0.13), y: Math.round(H * 0.15), s: Math.round(H * 0.7) }
  const col = tall ? { x: 110, w: W - 220, y: 1150 } : { x: art.x + art.s + 90, w: W - (art.x + art.s + 90) - Math.round(H * 0.11), y: art.y + 70 }
  // the art swells a touch on each kick
  {
    const sc = 1 + 0.022 * F.kick + 0.008 * F.bass
    const s = art.s * sc, x = art.x + (art.s - s) / 2, y = art.y + (art.s - s) / 2
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 60 * u; ctx.shadowOffsetY = 24 * u
    ctx.fillStyle = '#000'; rr(ctx, x, y, s, s, 22 * u); ctx.fill(); ctx.restore()
    coverArt(ctx, meta.cover, A, meta.title, x, y, s, 22 * u)
  }
  ctx.textAlign = tall ? 'center' : 'left'; ctx.textBaseline = 'alphabetic'
  const tx = tall ? W / 2 : col.x
  ctx.fillStyle = '#ffffff'
  fit(ctx, meta.title, (px) => `700 ${px}px ${COND}`, (tall ? 104 : 96) * u, col.w)
  ctx.fillText(meta.title, tx, col.y)
  if (meta.tagline) { ctx.fillStyle = 'rgba(255,255,255,0.72)'; fit(ctx, meta.tagline, (px) => `500 ${px}px ${COND}`, 44 * u, col.w); ctx.fillText(meta.tagline, tx, col.y + 62 * u) }
  // mirrored spectrum
  {
    const n = tall ? 44 : 40, top = col.y + (tall ? 120 : 120) * u, h = (tall ? 230 : 230) * u, mid = top + h * 0.62
    const bw = col.w / n
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n, v = Math.max(0.03, F.band(x) * (0.85 + 0.25 * F.kick)), hv = F.hold(x, 18)
      const bx = col.x + i * bw + bw * 0.2, w = bw * 0.6, up = v * h * 0.62, down = v * h * 0.3
      ctx.fillStyle = '#ffffff'; rr(ctx, bx, mid - up, w, up, w / 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; rr(ctx, bx, mid + 4 * u, w, down, w / 2); ctx.fill()
      ctx.fillStyle = rgba(A, 1); ctx.fillRect(bx, mid - hv * h * 0.62 - 9 * u, w, 3.5 * u)
    }
  }
  // progress
  {
    const y = col.y + (tall ? 430 : 420) * u, x0 = col.x, w = col.w
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; rr(ctx, x0, y, w, 6 * u, 3 * u); ctx.fill()
    ctx.fillStyle = '#ffffff'; rr(ctx, x0, y, w * F.progress, 6 * u, 3 * u); ctx.fill()
    ctx.beginPath(); ctx.arc(x0 + w * F.progress, y + 3 * u, (9 + 4 * F.kick) * u, 0, Math.PI * 2); ctx.fill()
    ctx.font = `500 ${24 * u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.textAlign = 'left'; ctx.fillText(clock(F.t), x0, y + 46 * u)
    ctx.textAlign = 'right'; ctx.fillText(clock(F.dur), x0 + w, y + 46 * u)
    const info = [meta.bpm ? `${Math.round(meta.bpm)} BPM` : '', shortKey(meta.key)].filter(Boolean).join('  ·  ')
    ctx.textAlign = 'center'; ctx.fillText(info, x0 + w / 2, y + 46 * u)
  }
  if (meta.footer) {
    ctx.font = `500 ${26 * u}px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = tall ? 'center' : 'left'
    ctx.fillText(meta.footer, tall ? W / 2 : col.x, tall ? H - 90 * u : H - Math.round(H * 0.15))
  }
  ctx.textAlign = 'left'
}

// ================================================================ VINYL: a record on a turntable, seen from above

const VINYL = { plinth: '#1c1815', rim: '#3a3632', metal: '#c9c5bc', cream: '#efe7d6', mute: 'rgba(239,231,214,0.6)' }

function vinyl(k: Kit, wood: HTMLCanvasElement): void {
  const { ctx, W, H, F, u, meta, A, tall } = k
  ctx.fillStyle = VINYL.plinth; ctx.fillRect(0, 0, W, H)
  texture(ctx, wood, W, H, 0.5)
  const R = tall ? 440 * u : H * 0.41
  const cx = tall ? W / 2 : H * 0.55, cy = tall ? 690 * u : H / 2
  const spin = F.t * (33.333 / 60) * Math.PI * 2
  // platter with strobe dots on the rim
  ctx.fillStyle = VINYL.rim; ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(239,231,214,0.55)'
  for (let i = 0; i < 120; i++) { const a = spin * 0.25 + (i / 120) * Math.PI * 2; ctx.fillRect(cx + Math.cos(a) * R * 1.03 - 2 * u, cy + Math.sin(a) * R * 1.03 - 2 * u, 4 * u, 4 * u) }
  // the record: each groove is one moment of the clip, outside in, lit by its loudness
  ctx.fillStyle = '#0c0c0d'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill()
  const rings = 150, inner = R * 0.36, outer = R * 0.965
  ctx.lineWidth = Math.max(1, ((outer - inner) / rings) * 0.7)
  for (let j = 0; j < rings; j++) {
    const p = j / rings, fr = p * (F.f.frames - 1), rad = outer - p * (outer - inner)
    const lv = F.rmsAt(fr), played = p <= F.progress
    ctx.strokeStyle = played ? `rgba(255,255,255,${0.04 + 0.16 * lv})` : `rgba(255,255,255,${0.03 + 0.07 * lv})`
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke()
  }
  // light catching the grooves: it stays put while the record turns
  {
    const g = ctx.createConicGradient(-Math.PI / 4, cx, cy)
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.06, 'rgba(255,255,255,0.13)'); g.addColorStop(0.12, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(0.56, 'rgba(255,255,255,0.09)'); g.addColorStop(0.62, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(cx, cy, inner * 0.92, 0, Math.PI * 2, true); ctx.fill()
  }
  // label, turning
  {
    const lr = R * 0.32
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(spin)
    ctx.fillStyle = rgba(A, 1); ctx.beginPath(); ctx.arc(0, 0, lr, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(0, 0, lr * 0.92, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#16120f'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
    fit(ctx, meta.title.toUpperCase(), (px) => `700 ${px}px ${COND}`, lr * 0.34, lr * 1.5)
    ctx.fillText(meta.title.toUpperCase(), 0, -lr * 0.3)
    ctx.font = `500 ${lr * 0.1}px ${MONO}`
    ctx.fillText(`SIDE A  ·  33⅓ RPM`, 0, lr * 0.42)
    if (meta.footer) { fit(ctx, meta.footer, (px) => `500 ${px}px ${MONO}`, lr * 0.11, lr * 1.3); ctx.fillText(meta.footer, 0, lr * 0.62) }
    ctx.restore()
    ctx.fillStyle = VINYL.metal; ctx.beginPath(); ctx.arc(cx, cy, 9 * u, 0, Math.PI * 2); ctx.fill()
  }
  // tonearm: the stylus walks inward with the clip
  {
    const px = cx + R * 1.02, py = cy - R * 0.98, d = Math.hypot(cx - px, cy - py), len = R * 1.22
    const rad = outer - F.progress * (outer - inner)
    const phi = Math.acos(clamp((d * d + len * len - rad * rad) / (2 * d * len), -1, 1))
    const th = Math.atan2(cy - py, cx - px) + phi
    const sx = px + Math.cos(th) * len, sy = py + Math.sin(th) * len
    ctx.fillStyle = VINYL.rim; ctx.beginPath(); ctx.arc(px, py, 44 * u, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = VINYL.metal; ctx.beginPath(); ctx.arc(px, py, 24 * u, 0, Math.PI * 2); ctx.fill()
    ctx.save(); ctx.translate(px, py); ctx.rotate(th + Math.PI)
    ctx.fillStyle = '#7e7a72'; ctx.fillRect(28 * u, -16 * u, 54 * u, 32 * u) // counterweight
    ctx.restore()
    ctx.strokeStyle = VINYL.metal; ctx.lineWidth = 9 * u; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke(); ctx.lineCap = 'butt'
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(th + 0.35)
    ctx.fillStyle = '#26221e'; ctx.fillRect(-10 * u, -26 * u, 60 * u, 52 * u)
    ctx.restore()
    ctx.fillStyle = rgba(A, 0.35 + 0.65 * F.kick); ctx.beginPath(); ctx.arc(sx, sy, (6 + 10 * F.kick) * u, 0, Math.PI * 2); ctx.fill()
  }
  // the side panel: title, readouts and a level ladder
  {
    const b = tall ? { x: 90, y: 1290, w: W - 180 } : { x: cx + R * 1.35, y: H * 0.22, w: W - (cx + R * 1.35) - H * 0.08 }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = VINYL.cream
    fit(ctx, meta.title.toUpperCase(), (px) => `700 ${px}px ${COND}`, 110 * u, b.w)
    ctx.fillText(meta.title.toUpperCase(), b.x, b.y + 90 * u)
    if (meta.tagline) { ctx.fillStyle = VINYL.mute; fit(ctx, meta.tagline, (px) => `500 ${px}px ${COND}`, 44 * u, b.w); ctx.fillText(meta.tagline, b.x, b.y + 150 * u) }
    ctx.font = `500 ${24 * u}px ${MONO}`; ctx.fillStyle = VINYL.mute
    const facts = [meta.bpm ? `${Math.round(meta.bpm)} BPM` : '', shortKey(meta.key), `${clock(F.t)} / ${clock(F.dur)}`].filter(Boolean).join('   ')
    ctx.fillText(facts, b.x, b.y + 210 * u)
    const n = 24, gap = 6 * u, cw = (b.w - gap * (n - 1)) / n, top = b.y + 250 * u, h = (tall ? 190 : 200) * u
    for (let i = 0; i < n; i++) {
      const v = F.band((i + 0.5) / n), lit = Math.round(v * 12)
      for (let s = 0; s < 12; s++) {
        const y = top + h - (s + 1) * (h / 12)
        ctx.fillStyle = s < lit ? (s >= 10 ? rgba(A, 1) : VINYL.cream) : 'rgba(239,231,214,0.08)'
        ctx.fillRect(b.x + i * (cw + gap), y + 2 * u, cw, h / 12 - 4 * u)
      }
    }
  }
}

// ================================================================ RIDGE: the spectrum's recent past as stacked ridgelines

function ridge(k: Kit): void {
  const { ctx, W, H, F, u, meta, A, tall } = k
  const bg = '#0b0b0c'
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
  const b = tall ? { x: 150, y: 330, w: W - 300, h: 1180 } : { x: W * 0.27, y: 120, w: W * 0.46, h: H - 330 }
  const rows = tall ? 46 : 34, n = 110, step = b.h / rows, lagStep = 3
  ctx.lineJoin = 'round'
  for (let r = 0; r < rows; r++) {
    const lag = (rows - 1 - r) * lagStep, base = b.y + (r + 1) * step
    const amp = step * (tall ? 5.2 : 4.6)
    ctx.beginPath(); ctx.moveTo(b.x, base)
    for (let i = 0; i <= n; i++) {
      const x = i / n, env = Math.exp(-(((x - 0.5) / 0.17) ** 2)), e2 = Math.exp(-(((x - 0.5) / 0.32) ** 2)) * 0.25
      const v = F.band(Math.abs(x - 0.5) * 1.8, lag)
      const jit = (hash(r * 131 + i, Math.floor((F.i - lag) / 2)) - 0.5) * 0.08
      const y = base - (env * (v + jit) + e2 * v * 0.6) * amp
      ctx.lineTo(b.x + x * b.w, y)
    }
    ctx.lineTo(b.x + b.w, base)
    ctx.fillStyle = bg; ctx.fill()
    ctx.strokeStyle = r === rows - 1 ? rgba(A, 1) : `rgba(236,234,228,${0.55 + 0.45 * (r / rows)})`
    ctx.lineWidth = (r === rows - 1 ? 3.2 : 2) * u
    ctx.stroke()
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#ecebe6'
  const ty = tall ? 1680 * u : H - 120 * u
  ctx.font = `600 ${(tall ? 64 : 56) * u}px ${COND}`
  const t = meta.title.toUpperCase()
  ctx.font = `600 ${fit(ctx, t, (px) => `600 ${px}px ${COND}`, (tall ? 64 : 56) * u, W * 0.6)}px ${COND}`
  const tw = [...t].reduce((a, ch) => a + ctx.measureText(ch).width + 14 * u, -14 * u)
  spaced(ctx, t, W / 2 - tw / 2, ty, 14 * u)
  ctx.font = `500 ${24 * u}px ${MONO}`; ctx.fillStyle = 'rgba(236,235,230,0.55)'
  const sub = [meta.tagline, meta.bpm ? `${Math.round(meta.bpm)} BPM` : '', shortKey(meta.key), `${clock(F.t)} / ${clock(F.dur)}`].filter(Boolean).join('  —  ').toUpperCase()
  ctx.fillText(sub, W / 2, ty + 56 * u)
  if (meta.footer) { ctx.fillText(meta.footer.toUpperCase(), W / 2, ty + 100 * u) }
  ctx.textAlign = 'left'
}

// ================================================================ PHOSPHOR: a green-screen oscilloscope and an event log

const PH = (a: number) => `rgba(110,255,170,${clamp(a)})`

function phosphorFx(W: number, H: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(0,0,0,0.28)'
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2)
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.75)')
  g.fillStyle = v; g.fillRect(0, 0, W, H)
  return c
}

function phosphor(k: Kit, fx: HTMLCanvasElement): void {
  const { ctx, W, H, F, u, meta, tall } = k
  ctx.fillStyle = '#020905'; ctx.fillRect(0, 0, W, H)
  const B = tall
    ? { head: { x: 80, y: 80, w: W - 160, h: 60 }, xy: { x: 90, y: 200, w: 900, h: 900 }, tr: { x: 90, y: 1150, w: 900, h: 250 }, log: { x: 90, y: 1450, w: 900, h: 400 } }
    : { head: { x: 70, y: 50, w: W - 140, h: 50 }, xy: { x: 80, y: 140, w: H - 220, h: H - 220 }, tr: { x: H - 80, y: 140, w: W - H + 10, h: 300 }, log: { x: H - 80, y: 490, w: W - H + 10, h: H - 570 } }
  const line = (pts: (i: number) => [number, number], count: number, a: number, w: number) => {
    ctx.beginPath()
    for (let i = 0; i < count; i++) { const [x, y] = pts(i); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) }
    ctx.strokeStyle = PH(a * 0.18); ctx.lineWidth = w * 4; ctx.stroke()
    ctx.strokeStyle = PH(a); ctx.lineWidth = w; ctx.stroke()
  }
  const grat = (b: Box, nx: number, ny: number) => {
    ctx.strokeStyle = PH(0.12); ctx.lineWidth = 1 * u
    for (let i = 0; i <= nx; i++) { ctx.beginPath(); ctx.moveTo(b.x + (b.w * i) / nx, b.y); ctx.lineTo(b.x + (b.w * i) / nx, b.y + b.h); ctx.stroke() }
    for (let i = 0; i <= ny; i++) { ctx.beginPath(); ctx.moveTo(b.x, b.y + (b.h * i) / ny); ctx.lineTo(b.x + b.w, b.y + (b.h * i) / ny); ctx.stroke() }
  }
  // header like a terminal prompt
  {
    const b = B.head
    ctx.font = `600 ${30 * u}px ${MONO}`; ctx.fillStyle = PH(0.95); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    const name = `> PLAY ${meta.title.toUpperCase().replace(/\s+/g, '_')}.WAV`
    fit(ctx, name, (px) => `600 ${px}px ${MONO}`, 30 * u, b.w * 0.62)
    ctx.fillText(name, b.x, b.y + b.h / 2)
    ctx.font = `500 ${24 * u}px ${MONO}`; ctx.fillStyle = PH(0.6); ctx.textAlign = 'right'
    ctx.fillText(`${meta.bpm ? Math.round(meta.bpm) + ' BPM  ' : ''}${shortKey(meta.key)}  T+${clock(F.t)}`, b.x + b.w, b.y + b.h / 2)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }
  // XY: left against right, with the last few frames still glowing on the tube
  {
    const b = B.xy, cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.w * 0.46
    grat(b, 8, 8)
    ctx.strokeStyle = PH(0.25); ctx.beginPath(); ctx.moveTo(cx, b.y); ctx.lineTo(cx, b.y + b.h); ctx.moveTo(b.x, cy); ctx.lineTo(b.x + b.w, cy); ctx.stroke()
    // a phase plot: the mid signal against itself a few samples later, so even mono beats draw loops
    const trail = [1, 0.5, 0.3, 0.18, 0.1, 0.06], lagS = 5
    for (let l = trail.length - 1; l >= 0; l--) {
      const fr = clamp(F.i - l, 0, F.f.frames - 1), base = fr * VEC * 2
      const mid = (j: number) => (F.f.vec[base + 2 * j] + F.f.vec[base + 2 * j + 1]) / 254
      line((j) => [cx + mid(j) * r * 0.95, cy - mid(j + lagS) * r * 0.95], VEC - lagS, trail[l] * (0.7 + 0.3 * F.rms), 2.2 * u)
    }
    ctx.font = `500 ${18 * u}px ${MONO}`; ctx.fillStyle = PH(0.45)
    ctx.fillText('X: MID(t)  ·  Y: MID(t+5)  ·  PHASE', b.x + 12 * u, b.y + b.h - 14 * u)
  }
  // trace: the waveform around this frame, triggered so it holds still
  {
    const b = B.tr
    grat(b, 10, 4)
    for (let l = 2; l >= 0; l--) line((i) => [b.x + (i / 160) * b.w, b.y + b.h / 2 - F.wave(i / 160, l) * b.h * 0.42], 161, [1, 0.35, 0.15][l] * (0.75 + 0.25 * F.kick), 2.4 * u)
  }
  // event log: the kicks and snaps so far, newest at the bottom
  {
    const b = B.log, rowH = 36 * u, max = Math.floor((b.h - 20 * u) / rowH)
    const ev: [number, string, number][] = []
    const f = F.f
    for (let j = f.kicks.length - 1; j >= 0 && ev.length < max * 2; j--) if (f.kicks[j] <= F.i) ev.push([f.kicks[j], 'KICK', f.kickAmp[j]])
    for (let j = f.snaps.length - 1, c = 0; j >= 0 && c < max * 2; j--) if (f.snaps[j] <= F.i) { ev.push([f.snaps[j], 'SNAP', f.snapAmp[j]]); c++ }
    ev.sort((a, b2) => a[0] - b2[0])
    const show = ev.slice(-max)
    ctx.font = `500 ${22 * u}px ${MONO}`; ctx.textBaseline = 'top'
    show.forEach(([fr, kind, amp], i) => {
      const bt = f.beat[clamp(fr, 0, f.frames - 1)], bar = Math.max(1, Math.floor((bt - 1) / 4) + 1), beat = Math.floor((((bt - 1) % 4) + 4) % 4) + 1
      const bars = '█'.repeat(Math.round(amp * 8)).padEnd(8, '░')
      const newest = i === show.length - 1
      ctx.fillStyle = PH(newest ? 1 : 0.35 + 0.5 * (i / show.length))
      ctx.fillText(`[${clock(fr / f.fps)}.${pad(((fr / f.fps) % 1) * 100, 2)}]  ${kind.padEnd(5)} BAR ${pad(bar, 3)}.${beat}  ${bars}`, b.x, b.y + i * rowH)
    })
    if (F.inBar % 1 < 0.5) { ctx.fillStyle = PH(0.9); ctx.fillRect(b.x, b.y + show.length * rowH + 2 * u, 14 * u, 24 * u) }
    ctx.textBaseline = 'alphabetic'
    if (meta.footer) { ctx.fillStyle = PH(0.4); ctx.textAlign = 'right'; ctx.fillText(meta.footer.toUpperCase(), b.x + b.w, b.y + b.h); ctx.textAlign = 'left' }
  }
  ctx.drawImage(fx, 0, 0)
}

// ================================================================ SCORE: the transcribed notes engraved on a grand staff

const SCORE = { paper: '#f3eee2', ink: '#1d1a16', mute: '#8a8276', staff: '#4a443c' }
const DIA = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
const SHARP = new Set([1, 3, 6, 8, 10])

function score(k: Kit, grain: HTMLCanvasElement): void {
  const { ctx, W, H, F, u, meta, A, tall } = k
  ctx.fillStyle = SCORE.paper; ctx.fillRect(0, 0, W, H)
  texture(ctx, grain, W, H, 0.4, 'multiply')
  // title block, engraved
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = SCORE.ink
  const top = tall ? 210 * u : 130 * u
  fit(ctx, meta.title, (px) => `italic 400 ${px}px ${SERIF}`, (tall ? 110 : 92) * u, W * 0.8)
  ctx.fillText(meta.title, W / 2, top)
  if (meta.tagline) { ctx.fillStyle = SCORE.mute; fit(ctx, meta.tagline, (px) => `400 ${px}px ${SERIF}`, 36 * u, W * 0.7); ctx.fillText(meta.tagline, W / 2, top + 60 * u) }
  ctx.textAlign = 'left'; ctx.fillStyle = SCORE.ink; ctx.font = `600 ${30 * u}px ${SERIF}`
  const mx = tall ? 80 * u : 110 * u
  ctx.fillText(`♩ = ${meta.bpm ? Math.round(meta.bpm) : '—'}`, mx, top + (tall ? 150 : 120) * u)
  if (meta.key) { ctx.textAlign = 'right'; ctx.font = `italic 400 ${30 * u}px ${SERIF}`; ctx.fillText(meta.key, W - mx, top + (tall ? 150 : 120) * u); ctx.textAlign = 'left' }

  // the system: treble over bass, four bars in view, the playhead a third of the way in
  const s = (tall ? 26 : 22) * u
  const sx = mx, sw = W - 2 * mx
  const trebTop = tall ? 640 * u : 380 * u, trebBot = trebTop + 4 * s, bassTop = trebBot + 5 * s, bassBot = bassTop + 4 * s
  ctx.strokeStyle = SCORE.staff; ctx.lineWidth = 1.6 * u
  for (const t0 of [trebTop, bassTop]) for (let l = 0; l < 5; l++) { ctx.beginPath(); ctx.moveTo(sx, t0 + l * s); ctx.lineTo(sx + sw, t0 + l * s); ctx.stroke() }
  ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(sx, trebTop); ctx.lineTo(sx, bassBot); ctx.stroke()
  ctx.fillStyle = SCORE.ink
  ctx.font = `${s * 6.4}px "Apple Symbols", "Noto Music", serif`; ctx.fillText('𝄞', sx + 8 * u, trebBot + s * 1.1)
  ctx.font = `${s * 3.6}px "Apple Symbols", "Noto Music", serif`; ctx.fillText('𝄢', sx + 12 * u, bassTop + s * 2.7)
  const lead = sx + s * 5.2, view = sw - s * 5.6
  const span = F.P * 16, playX = lead + view * 0.3
  const xOf = (fr: number) => playX + ((fr - F.i) / span) * view
  ctx.save(); ctx.beginPath(); ctx.rect(lead, trebTop - s * 6, view, bassBot - trebTop + s * 12); ctx.clip()
  // bar lines on the beat grid
  {
    const first = Math.floor((F.i - span * 0.3 - F.origin) / F.P) - 1, last = first + 20
    for (let n = first; n <= last; n++) {
      if (((n % 4) + 4) % 4 !== 0) continue
      const x = xOf(F.origin + n * F.P)
      ctx.strokeStyle = SCORE.staff; ctx.lineWidth = 1.6 * u
      ctx.beginPath(); ctx.moveTo(x, trebTop); ctx.lineTo(x, trebBot); ctx.moveTo(x, bassTop); ctx.lineTo(x, bassBot); ctx.stroke()
      ctx.font = `italic 400 ${18 * u}px ${SERIF}`; ctx.fillStyle = SCORE.mute; ctx.fillText(String(n / 4 + 1), x + 4 * u, trebTop - 10 * u)
    }
  }
  // notes
  const from = F.i - span * 0.3, to = F.i + span * 0.7
  F.notes(from, to, (st, en, midi, vel) => {
    const m = Math.round(midi), pc = ((m % 12) + 12) % 12, step = Math.floor(m / 12) * 7 + DIA[pc]
    const treble = m >= 60
    const y = treble ? trebBot - (step - 37) * (s / 2) : bassBot - (step - 25) * (s / 2)
    const x = xOf(st)
    const sounding = st <= F.i && en > F.i
    const col = sounding ? rgba(A, 1) : st > F.i ? 'rgba(29,26,22,0.72)' : SCORE.ink
    ctx.strokeStyle = SCORE.staff; ctx.lineWidth = 1.6 * u
    const t0 = treble ? trebTop : bassTop, b0 = treble ? trebBot : bassBot
    for (let ly = b0 + s; ly <= y + 0.1; ly += s) { ctx.beginPath(); ctx.moveTo(x - s * 0.9, ly); ctx.lineTo(x + s * 0.9, ly); ctx.stroke() }
    for (let ly = t0 - s; ly >= y - 0.1; ly -= s) { ctx.beginPath(); ctx.moveTo(x - s * 0.9, ly); ctx.lineTo(x + s * 0.9, ly); ctx.stroke() }
    const long = en - st >= F.P * 2
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35)
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62 * (sounding ? 1.12 : 1), s * 0.44 * (sounding ? 1.12 : 1), 0, 0, Math.PI * 2)
    if (long) { ctx.strokeStyle = col; ctx.lineWidth = 2.6 * u; ctx.stroke() } else { ctx.fillStyle = col; ctx.fill() }
    ctx.restore()
    ctx.strokeStyle = col; ctx.lineWidth = 2 * u
    const up = y > (t0 + b0) / 2
    ctx.beginPath(); ctx.moveTo(x + (up ? s * 0.58 : -s * 0.58), y); ctx.lineTo(x + (up ? s * 0.58 : -s * 0.58), y + (up ? -1 : 1) * s * 3.3); ctx.stroke()
    if (SHARP.has(pc)) { ctx.fillStyle = col; ctx.font = `${s * 1.5}px ${SERIF}`; ctx.fillText('♯', x - s * 1.9, y + s * 0.5) }
    if (vel > 0.85 && !long) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y + (up ? s : -s) * 1.1, 2.6 * u, 0, Math.PI * 2); ctx.fill() } // accent-ish staccato dot on loud hits
  })
  ctx.restore()
  // playhead
  ctx.fillStyle = rgba(A, 0.9); ctx.fillRect(playX - 1.5 * u, trebTop - s * 3, 3 * u, bassBot - trebTop + s * 6)
  // dynamics under the system, from the loudness, with a hairpin when it is building or falling
  {
    const lv = F.rms, mark = lv > 0.82 ? 'ff' : lv > 0.65 ? 'f' : lv > 0.48 ? 'mf' : lv > 0.32 ? 'mp' : lv > 0.18 ? 'p' : 'pp'
    const y = bassBot + s * 4.2
    ctx.fillStyle = SCORE.ink; ctx.font = `italic 600 ${s * 1.7}px ${SERIF}`; ctx.textAlign = 'center'
    ctx.fillText(mark, playX, y)
    const d = F.rms - F.rmsAt(F.i - F.f.fps)
    if (Math.abs(d) > 0.06) {
      const x0 = playX + s * 2.2, x1 = x0 + s * 7, open = s * 0.8
      ctx.strokeStyle = SCORE.ink; ctx.lineWidth = 1.8 * u; ctx.beginPath()
      if (d > 0) { ctx.moveTo(x1, y - s * 0.5 - open); ctx.lineTo(x0, y - s * 0.5); ctx.lineTo(x1, y - s * 0.5 + open) } else { ctx.moveTo(x0, y - s * 0.5 - open); ctx.lineTo(x1, y - s * 0.5); ctx.lineTo(x0, y - s * 0.5 + open) }
      ctx.stroke()
    }
    ctx.textAlign = 'left'
  }
  // a keyboard showing what sounds right now
  {
    const [lo, hi] = noteRange(F.f)
    const kb = tall ? { x: mx, y: 1360 * u, w: sw, h: 240 * u } : { x: mx, y: bassBot + s * 6.4, w: sw, h: H - (bassBot + s * 6.4) - 90 * u }
    const on = new Set<number>()
    F.notes(F.i, F.i + 1, (st, en, m) => { if (st <= F.i && en > F.i) on.add(Math.round(m)) })
    const whites: number[] = []
    for (let m = lo; m <= hi; m++) if (!SHARP.has(m % 12)) whites.push(m)
    const ww = kb.w / whites.length
    whites.forEach((m, i) => {
      ctx.fillStyle = on.has(m) ? rgba(A, 1) : '#fbf8f1'; ctx.fillRect(kb.x + i * ww, kb.y, ww - 2 * u, kb.h)
      ctx.strokeStyle = SCORE.staff; ctx.lineWidth = 1.2 * u; ctx.strokeRect(kb.x + i * ww, kb.y, ww - 2 * u, kb.h)
      if (m % 12 === 0) { ctx.fillStyle = SCORE.mute; ctx.font = `400 ${14 * u}px ${MONO}`; ctx.fillText(`C${Math.floor(m / 12) - 1}`, kb.x + i * ww + 4 * u, kb.y + kb.h - 8 * u) }
    })
    whites.forEach((m, i) => {
      const b = m + 1
      if (b > hi || !SHARP.has(b % 12)) return
      ctx.fillStyle = on.has(b) ? rgba(A, 1) : SCORE.ink
      ctx.fillRect(kb.x + (i + 1) * ww - ww * 0.32, kb.y, ww * 0.62, kb.h * 0.6)
    })
  }
  // folio
  ctx.fillStyle = SCORE.mute; ctx.font = `italic 400 ${24 * u}px ${SERIF}`
  ctx.textAlign = 'center'; ctx.fillText(`— ${F.bar} —`, W / 2, H - 50 * u)
  if (meta.footer) { ctx.textAlign = 'right'; ctx.fillText(meta.footer, W - mx, H - 50 * u) }
  ctx.textAlign = 'left'; ctx.fillText(`${clock(F.t)} / ${clock(F.dur)}`, mx, H - 50 * u)
}

// ================================================================ LED: a dot-matrix wall with a scrolling marquee

interface Marquee { w: number; h: number; bits: Uint8Array }

/** Text rendered to a 1-bit strip, one bit per LED. Built once. */
function marquee(text: string, rowsTall: number, mono = false): Marquee {
  const c = document.createElement('canvas')
  const g = c.getContext('2d', { willReadFrequently: true })!
  const font = mono ? `600 ${Math.round(rowsTall * 1.3)}px ${MONO}` : `700 ${Math.round(rowsTall * 1.3)}px ${COND}`
  g.font = font
  const w = Math.max(1, Math.ceil(g.measureText(text).width) + 2)
  c.width = w; c.height = rowsTall
  g.font = font; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'
  g.fillText(text, 1, rowsTall - 1)
  const d = g.getImageData(0, 0, w, rowsTall).data, bits = new Uint8Array(w * rowsTall)
  for (let i = 0; i < w * rowsTall; i++) bits[i] = d[i * 4 + 3] > 110 ? 1 : 0
  return { w, h: rowsTall, bits }
}

function led(k: Kit, mq: Marquee, sub: Marquee): void {
  const { ctx, W, H, F, u, A, tall } = k
  ctx.fillStyle = '#050507'; ctx.fillRect(0, 0, W, H)
  const p = 20 * u, cols = Math.floor(W / p), rows = Math.floor(H / p), ox = (W - cols * p) / 2 + p / 2, oy = (H - rows * p) / 2 + p / 2
  const lv = new Float32Array(cols * rows), hue = new Uint8Array(cols * rows) // 0 white, 1 accent, 2 dim accent
  const set = (c: number, r: number, v: number, h: number) => { if (c < 0 || r < 0 || c >= cols || r >= rows) return; const i = r * cols + c; if (v > lv[i]) { lv[i] = v; hue[i] = h } }
  // marquee: the title scrolls left, the second line scrolls right underneath
  const mr0 = tall ? 6 : 4
  const off = Math.floor(F.t * 16)
  for (let c = 0; c < cols; c++) {
    const x = ((c + off) % (mq.w + cols)) - cols
    if (x >= 0 && x < mq.w) for (let r = 0; r < mq.h; r++) if (mq.bits[r * mq.w + x]) set(c, mr0 + r, 0.92 + 0.08 * F.kick, 0)
    const x2 = (((cols - c) + Math.floor(F.t * 10)) % (sub.w + cols)) - cols
    const sx = sub.w - 1 - x2
    if (x2 >= 0 && sx >= 0 && sx < sub.w) for (let r = 0; r < sub.h; r++) if (sub.bits[r * sub.w + sx]) set(c, mr0 + mq.h + 2 + r, 0.8, 1)
  }
  // the pulse ring: grows on each kick, filled with the low end
  const below = mr0 + mq.h + 2 + sub.h + 2
  if (tall) {
    const cc = cols / 2 - 0.5, cr = below + 20, R = 8 + 6 * F.kick
    for (let r = cr - 20; r <= cr + 20; r++) for (let c = 0; c < cols; c++) {
      const d = Math.hypot(c - cc, r - cr)
      if (Math.abs(d - R) < 0.9) set(c, r, 1, 1)
      else if (d < R * 0.75 * F.bass) set(c, r, 0.55, 2)
      else if (Math.abs(d - (R + 4 + 3 * F.snap)) < 0.6) set(c, r, 0.35 + 0.5 * F.snap, 0)
    }
  }
  // spectrum columns with peak caps
  {
    const r1 = rows - 3, r0 = tall ? below + 42 : below + 3, h = r1 - r0
    for (let c = 1; c < cols - 1; c++) {
      const x = (c - 1) / (cols - 2), v = F.band(x), top = Math.round(v * h), cap = Math.round(F.hold(x, 22) * h)
      for (let r = 0; r < top; r++) set(c, r1 - r, 0.55 + 0.45 * (r / h), r > h * 0.7 ? 1 : 0)
      set(c, r1 - cap - 1, 0.9, 1)
    }
  }
  const unlit = new Path2D(), buckets = new Map<string, Path2D>()
  const glow = rgba(A, 0.16)
  const glowPath = new Path2D()
  const rad = p * 0.36
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, x = ox + c * p, y = oy + r * p
    if (lv[i] <= 0.01) { unlit.moveTo(x + rad * 0.8, y); unlit.arc(x, y, rad * 0.8, 0, Math.PI * 2); continue }
    const q = Math.round(lv[i] * 4) / 4
    const col = hue[i] === 0 ? `rgba(255,248,236,${q})` : hue[i] === 1 ? rgba(A, q) : rgba(A, q * 0.45)
    let path = buckets.get(col)
    if (!path) { path = new Path2D(); buckets.set(col, path) }
    path.moveTo(x + rad, y); path.arc(x, y, rad, 0, Math.PI * 2)
    if (lv[i] > 0.7) { glowPath.moveTo(x + rad * 2, y); glowPath.arc(x, y, rad * 2, 0, Math.PI * 2) }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fill(unlit)
  ctx.fillStyle = glow; ctx.fill(glowPath)
  for (const [col, path] of buckets) { ctx.fillStyle = col; ctx.fill(path) }
}

// ================================================================ registry

export const SCENE_STYLES: VizStyle[] = ['lab', 'tape', 'riso', 'cover', 'vinyl', 'ridge', 'phosphor', 'score', 'led']

export type SceneDraw = (ctx: Ctx, f: VizFeatures, frame: number, scale?: number) => void

/** Build a drawer for one preset. Call it with a canvas context and a frame index; it paints the whole frame. */
export function createScene(L: SceneLayout, style: VizStyle, accent: string, meta: SceneMeta): SceneDraw {
  const A = hexRgb(accent)
  const tall = L.H > L.W, u = tall ? L.W / 1080 : L.H / 1080
  const seed = [...meta.title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7)
  let frameObj: Frame | null = null
  let paint: (k: Kit) => void
  if (style === 'tape') {
    const stains = makeStains(L.W, L.H, seed)
    const grain = grainTile(seed, 'rgba(70,45,20,1)', 'rgba(255,240,210,1)', 0.05)
    paint = (k) => { tape(k, stains); texture(k.ctx, grain, k.W, k.H, 0.35) }
  } else if (style === 'riso') {
    const ht = halftoneSource(meta.cover, tall ? 64 : 58, seed)
    const grain = grainTile(seed, 'rgba(120,110,90,1)', 'rgba(255,255,255,1)', 0.035)
    const speck = grainTile(seed + 5, 'rgba(241,235,221,1)', 'rgba(241,235,221,1)', 0.02)
    paint = (k) => riso(k, ht, grain, speck)
  } else if (style === 'cover') {
    const bg = coverBackdrop(L.W, L.H, meta.cover, A)
    paint = (k) => coverScene(k, bg)
  } else if (style === 'vinyl') {
    const wood = grainTile(seed, 'rgba(0,0,0,1)', 'rgba(120,90,60,1)', 0.05)
    paint = (k) => vinyl(k, wood)
  } else if (style === 'ridge') {
    paint = (k) => ridge(k)
  } else if (style === 'phosphor') {
    const fx = phosphorFx(L.W, L.H)
    paint = (k) => phosphor(k, fx)
  } else if (style === 'score') {
    const grain = grainTile(seed, 'rgba(110,95,70,1)', 'rgba(255,255,255,1)', 0.025)
    paint = (k) => score(k, grain)
  } else if (style === 'led') {
    const mq = marquee(meta.title.toUpperCase() || 'UNTITLED', 16)
    const sub = marquee([meta.tagline, meta.bpm ? `${Math.round(meta.bpm)} BPM` : '', shortKey(meta.key), meta.footer].filter(Boolean).join('  ·  ').toUpperCase() || ' ', 11, true)
    paint = (k) => led(k, mq, sub)
  } else {
    const grain = grainTile(seed, 'rgba(90,90,85,1)', 'rgba(255,255,255,1)', 0.02)
    paint = (k) => { lab(k); texture(k.ctx, grain, k.W, k.H, 0.18) }
  }
  return (ctx, f, frame, scale = 1) => {
    if (!frameObj || frameObj.f !== f) frameObj = new Frame(f)
    const F = frameObj.at(frame)
    ctx.save()
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    paint({ ctx, W: L.W, H: L.H, tall, u, F, meta, A })
    ctx.restore()
  }
}
