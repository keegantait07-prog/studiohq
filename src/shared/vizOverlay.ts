// Title layers drawn over any preset: an intro slate and an end card. Timing comes from Remotion's
// spring() and interpolate(), and every value is a pure function of the frame index, so the Player,
// a scrub and the export draw the same picture. The overlay never zooms with the frame motion.
import { Easing, interpolate, spring } from 'remotion'
import type { VideoTitles, VizStyle } from './types'
import type { SceneLayout } from './vizScene'
import type { VizFeatures } from './vizFeatures'

export interface OverlayText { title: string; tagline: string; footer: string; cta: string; bpm: number | null; key: string | null }

type Ctx = CanvasRenderingContext2D
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace'
const COND = '"Barlow Condensed", "Arial Narrow", sans-serif'
const clampOpt = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const OUT = Easing.bezier(0.16, 1, 0.3, 1)
const IN = Easing.bezier(0.7, 0, 0.84, 0)

/** Paper and ink for each preset, so the titles look printed on the same stock. */
// `paper` fills the intro band and `ink` is its type; the end card dims the frame to `veil`.
type Stock = { paper: string; ink: string; veil: string }
const STOCK: Partial<Record<VizStyle, Stock>> = {
  lab: { paper: '#f3f2ef', ink: '#26282c', veil: '#26282c' },
  tape: { paper: '#efe5cf', ink: '#2a231b', veil: '#2a231b' },
  riso: { paper: '#f1ebdd', ink: '#1f2a44', veil: '#1f2a44' },
  score: { paper: '#f3eee2', ink: '#1d1a16', veil: '#1d1a16' },
  cover: { paper: '#f4f2ee', ink: '#121317', veil: '#08090c' },
  vinyl: { paper: '#efe7d6', ink: '#1c1815', veil: '#120f0d' },
  ridge: { paper: '#ecebe6', ink: '#0b0b0c', veil: '#000000' },
  phosphor: { paper: '#6effaa', ink: '#020905', veil: '#020905' },
  led: { paper: '#fff8ec', ink: '#050507', veil: '#000000' },
  ink: { paper: '#f5f1e7', ink: '#1d2333', veil: '#1d2333' },
  typewriter: { paper: '#f4efe2', ink: '#24221f', veil: '#1c1410' },
  bauhaus: { paper: '#efe8da', ink: '#1b1a19', veil: '#1b1a19' }
}
const stockOf = (s: VizStyle): Stock => STOCK[s] ?? { paper: '#f3f1ec', ink: '#16171a', veil: '#16171a' }

/** How long the intro slate and the end card last, in seconds. */
export const INTRO_S = 2.4
export const OUTRO_S = 3.2

/** Whether a clip is long enough to carry the end card without crowding the intro. */
export const hasOutro = (titles: VideoTitles, f: VizFeatures) => titles === 'both' && f.frames / f.fps >= 9

function letters(ctx: Ctx, text: string, x: number, y: number, frame: number, fps: number, delay: number, rise: number): void {
  const total = ctx.measureText(text).width
  let cx = x - total / 2
  ctx.textAlign = 'left'
  let n = 0
  for (const ch of text) {
    const w = ctx.measureText(ch).width
    const s = spring({ frame, fps, delay: delay + n * 1.2, config: { damping: 14, stiffness: 160, mass: 0.6 } })
    if (s > 0.001) {
      ctx.globalAlpha = Math.min(1, s * 1.4)
      ctx.fillText(ch, cx, y + (1 - s) * rise)
    }
    cx += w
    n++
  }
  ctx.globalAlpha = 1
}

function fitFont(ctx: Ctx, text: string, font: (px: number) => string, size: number, maxW: number): number {
  let s = size
  ctx.font = font(s)
  while (s > 18 && ctx.measureText(text).width > maxW) { s -= 4; ctx.font = font(s) }
  return s
}

function intro(ctx: Ctx, L: SceneLayout, stock: Stock, accent: string, t: OverlayText, f: VizFeatures, i: number): void {
  const fps = f.fps, { W, H } = L
  const tall = H > W, u = tall ? W / 1080 : H / 1080
  if (i > INTRO_S * fps) return
  const bandH = (tall ? 330 : 300) * u, cy = H * (tall ? 0.5 : 0.5)
  // the band wipes in from the left, holds, and wipes out to the right
  const inX = interpolate(i, [0, 0.45 * fps], [0, 1], { ...clampOpt, easing: OUT })
  const outX = interpolate(i, [1.85 * fps, INTRO_S * fps], [0, 1], { ...clampOpt, easing: IN })
  const x0 = W * outX, x1 = W * inX
  if (x1 <= x0) return
  const kick = f.kick[Math.min(f.frames - 1, i)] ?? 0
  ctx.save()
  ctx.fillStyle = stock.paper
  ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 40 * u; ctx.shadowOffsetY = 10 * u
  ctx.fillRect(x0, cy - bandH / 2, x1 - x0, bandH)
  ctx.shadowColor = 'transparent'
  // accent rule along the top edge, drawn a beat later
  const rule = interpolate(i, [0.25 * fps, 0.8 * fps], [0, 1], { ...clampOpt, easing: OUT })
  ctx.fillStyle = accent
  ctx.fillRect(x0, cy - bandH / 2, Math.max(0, Math.min(x1, W * rule) - x0), 8 * u)
  ctx.beginPath(); ctx.rect(x0, cy - bandH / 2, x1 - x0, bandH); ctx.clip()

  ctx.fillStyle = stock.ink
  ctx.textBaseline = 'alphabetic'
  const title = t.title.toUpperCase() || 'UNTITLED'
  const size = fitFont(ctx, title, (px) => `700 ${px}px ${COND}`, (tall ? 150 : 140) * u, W * 0.86)
  letters(ctx, title, W / 2, cy + size * 0.32 - kick * 4 * u, i, fps, 0.18 * fps, size * 0.6)

  const sub = [t.tagline, [t.bpm ? `${Math.round(t.bpm)} BPM` : '', t.key ?? ''].filter(Boolean).join(' · ')].filter(Boolean).join('   /   ')
  if (sub) {
    ctx.globalAlpha = interpolate(i, [0.6 * fps, 1 * fps], [0, 1], clampOpt)
    fitFont(ctx, sub.toUpperCase(), (px) => `500 ${px}px ${MONO}`, 30 * u, W * 0.84)
    ctx.textAlign = 'center'
    ctx.fillText(sub.toUpperCase(), W / 2, cy - bandH / 2 + 62 * u + interpolate(i, [0.6 * fps, 1 * fps], [14 * u, 0], { ...clampOpt, easing: OUT }))
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

function outro(ctx: Ctx, L: SceneLayout, stock: Stock, accent: string, t: OverlayText, f: VizFeatures, i: number): void {
  const fps = f.fps, { W, H } = L
  const tall = H > W, u = tall ? W / 1080 : H / 1080
  const s0 = f.frames - OUTRO_S * fps
  const j = i - s0
  if (j < 0) return
  ctx.save()
  // the frame dims to ink, then the card rises on springs
  ctx.globalAlpha = interpolate(j, [0, 0.5 * fps], [0, 0.95], clampOpt) // dark enough that the preset's own title cannot ghost through
  ctx.fillStyle = stock.veil
  ctx.fillRect(0, 0, W, H)
  ctx.globalAlpha = 1
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  const cy = H * 0.5
  ctx.fillStyle = stock.paper
  const title = t.title.toUpperCase() || 'UNTITLED'
  const size = fitFont(ctx, title, (px) => `700 ${px}px ${COND}`, (tall ? 132 : 128) * u, W * 0.84)
  letters(ctx, title, W / 2, cy - 30 * u, j, fps, 0.2 * fps, size * 0.5)

  const pop = spring({ frame: j, fps, delay: 0.55 * fps, config: { damping: 12, stiffness: 180 } })
  if (t.cta && pop > 0.001) {
    ctx.font = `600 ${Math.round(34 * u)}px ${MONO}`
    const cta = t.cta.toUpperCase()
    const tw = Math.min(W * 0.8, ctx.measureText(cta).width + 64 * u), th = 76 * u
    ctx.save()
    ctx.translate(W / 2, cy + 70 * u)
    ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop)
    ctx.globalAlpha = Math.min(1, pop)
    ctx.fillStyle = accent
    ctx.beginPath(); ctx.roundRect(-tw / 2, 0, tw, th, th / 2); ctx.fill()
    ctx.fillStyle = stock.veil
    ctx.textAlign = 'center'
    fitFont(ctx, cta, (px) => `600 ${px}px ${MONO}`, 34 * u, tw - 48 * u)
    ctx.fillText(cta, 0, th / 2 + 12 * u)
    ctx.restore()
  }
  if (t.footer) {
    ctx.globalAlpha = interpolate(j, [0.9 * fps, 1.3 * fps], [0, 0.8], clampOpt)
    ctx.fillStyle = stock.paper
    ctx.textAlign = 'center'
    fitFont(ctx, t.footer, (px) => `500 ${px}px ${MONO}`, 30 * u, W * 0.8)
    ctx.fillText(t.footer, W / 2, cy + 220 * u)
  }
  // fade to black with the audio's fade-out
  ctx.globalAlpha = interpolate(i, [f.frames - 0.6 * fps, f.frames - 1], [0, 1], clampOpt)
  if (ctx.globalAlpha > 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H) }
  ctx.restore()
}

/** Paint the title layers for frame `i` on top of an already-drawn preset frame (in layout pixels). */
export function drawOverlay(ctx: Ctx, L: SceneLayout, style: VizStyle, accent: string, t: OverlayText, titles: VideoTitles, f: VizFeatures, i: number): void {
  if (titles === 'none') return
  const stock = stockOf(style)
  if (hasOutro(titles, f) && i >= f.frames - OUTRO_S * f.fps) outro(ctx, L, stock, accent, t, f, i)
  else intro(ctx, L, stock, accent, t, f, i)
}
