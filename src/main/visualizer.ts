// Draws the animated visualizer frames (raw RGB) that ffmpeg overlays on the still.
import type { VizStyle } from '../shared/types'

const SR = 44100
const N = 2048

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

export class Visualizer {
  private win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))
  private re = new Float64Array(N)
  private im = new Float64Array(N)
  private level: Float32Array
  private edges: number[]
  private rgb: [number, number, number]
  // motion state shared by the reactive styles
  private slow = 0
  private lowPrev = 0
  private lowPeak = 1e-6
  private low = 0
  private hit = 0
  private cool = 0
  private capHold: Float32Array
  private rings: { t: number }[] = []
  private ecg: Float32Array
  private ecgQueue: number[] = []
  private sparks: { x: number; y: number; vx: number; vy: number; life: number; r: number }[] = []
  private seed = 1234567

  constructor(private samples: Float32Array, private w: number, private h: number, private bars: number, private style: VizStyle, accent: string, private fps = 30) {
    this.level = new Float32Array(bars)
    this.capHold = new Float32Array(bars)
    this.ecg = new Float32Array(w)
    // log-spaced band edges between 35 Hz and 14 kHz, as FFT bin indices
    const lo = 35, hi = 14000
    this.edges = Array.from({ length: bars + 1 }, (_, i) => Math.max(1, Math.round(((lo * Math.pow(hi / lo, i / bars)) / SR) * N)))
    const n = parseInt(accent.slice(1), 16)
    this.rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  private analyse(frame: number): void {
    const center = Math.floor((frame / this.fps) * SR)
    const start = center - N / 2
    for (let i = 0; i < N; i++) {
      const s = this.samples[start + i] ?? 0
      this.re[i] = s * this.win[i]
      this.im[i] = 0
    }
    fft(this.re, this.im)
    let low = 0
    for (let k = 1; k <= Math.round((160 / SR) * N); k++) low += Math.hypot(this.re[k], this.im[k])
    this.low = low
    for (let b = 0; b < this.bars; b++) {
      const a = this.edges[b], z = Math.max(this.edges[b + 1], a + 1)
      let m = 0
      for (let k = a; k < z && k < N / 2; k++) m = Math.max(m, Math.hypot(this.re[k], this.im[k]))
      const hz = ((a + z) / 2 / N) * SR
      const db = 20 * Math.log10(m / (N / 4) + 1e-6) + 3 * Math.log2(Math.max(hz, 60) / 100) // gentle tilt so highs show up
      const v = Math.min(1, Math.max(0, (db + 62) / 52))
      const cur = this.level[b]
      this.level[b] = v > cur ? cur + (v - cur) * 0.7 : cur + (v - cur) * 0.2
    }
  }

  /** One frame of w*h*3 bytes, black background. */
  frame(i: number): Buffer {
    const { w, h } = this
    const buf = Buffer.alloc(w * h * 3)
    if (this.style === 'line') { this.drawLine(buf, i); return buf }
    this.analyse(i)
    this.tick()
    switch (this.style) {
      case 'ribbon': this.drawRibbon(buf); break
      case 'led': this.drawLed(buf); break
      case 'dots': this.drawDots(buf); break
      case 'sonar': this.drawSonar(buf); break
      case 'aurora': this.drawAurora(buf, i); break
      case 'pulse': this.drawPulse(buf); break
      case 'sparks': this.drawSparks(buf); break
      default: this.drawBars(buf)
    }
    return buf
  }

  private px(buf: Buffer, x: number, y: number, k = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const o = (y * this.w + x) * 3
    buf[o] = this.rgb[0] * k; buf[o + 1] = this.rgb[1] * k; buf[o + 2] = this.rgb[2] * k
  }

  private roundedBar(buf: Buffer, x0: number, bw: number, y0: number, y1: number): void {
    const r = bw / 2
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) {
      let inset = 0
      const dt = y - y0 + 0.5, db = y1 - y - 0.5
      const d = Math.min(dt, db)
      if (d < r) inset = r - Math.sqrt(Math.max(0, r * r - (r - d) * (r - d)))
      const xa = Math.round(x0 + inset), xb = Math.round(x0 + bw - inset)
      for (let x = xa; x < xb; x++) this.px(buf, x, y)
    }
  }

  private drawBars(buf: Buffer): void {
    const { w, h, bars } = this
    const pitch = w / bars, bw = Math.max(4, Math.round(pitch * 0.62))
    for (let b = 0; b < bars; b++) {
      const v = Math.pow(this.level[b], 1.15)
      const x0 = Math.round(b * pitch + (pitch - bw) / 2)
      if (this.style === 'mirror') {
        const half = Math.max(bw / 2 + 2, v * (h / 2))
        this.roundedBar(buf, x0, bw, Math.round(h / 2 - half), Math.round(h / 2 + half))
      } else {
        const bh = Math.max(bw + 2, v * h * 0.95)
        this.roundedBar(buf, x0, bw, Math.round(h - bh), h)
      }
    }
  }

  private drawLine(buf: Buffer, frame: number): void {
    const { w, h } = this
    const span = Math.floor(SR / 12) // ~83 ms of audio across the width
    const start = Math.floor((frame / this.fps) * SR) - span / 2
    const ys = new Float32Array(w)
    for (let x = 0; x < w; x++) {
      const a = Math.floor(start + (x / w) * span), z = Math.floor(start + ((x + 1) / w) * span)
      let sum = 0, c = 0
      for (let k = a; k < Math.max(z, a + 1); k++) { sum += this.samples[k] ?? 0; c++ }
      ys[x] = sum / c
    }
    for (let pass = 0; pass < 2; pass++) for (let x = 1; x < w - 1; x++) ys[x] = (ys[x - 1] + ys[x] * 2 + ys[x + 1]) / 4 // smooth
    let peak = 0.12
    for (let x = 0; x < w; x++) peak = Math.max(peak, Math.abs(ys[x]))
    const amp = (h / 2 - 6) / Math.max(peak, 0.35)
    const th = Math.max(3, Math.round(h / 40))
    let prev = h / 2
    for (let x = 0; x < w; x++) {
      const y = h / 2 - ys[x] * amp
      const a = Math.round(Math.min(prev, y)), z = Math.round(Math.max(prev, y))
      for (let yy = a - th; yy <= z + th; yy++) this.px(buf, x, yy)
      prev = y
    }
  }

  // ---------------------------------------------------------------- shared helpers
  private rnd(): number { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 }

  private band(from: number, to: number): number {
    const a = Math.floor(this.bars * from), z = Math.max(a + 1, Math.ceil(this.bars * to))
    let s = 0
    for (let i = a; i < z && i < this.bars; i++) s += this.level[i]
    return s / (z - a)
  }

  /** Follows the low end and flags kicks: `hit` jumps on a transient and decays. */
  private tick(): void {
    // flux of the raw (unclipped) low end: a kick is a sudden rise, a held bass note is not
    this.lowPeak = Math.max(this.lowPeak * 0.995, this.low)
    const flux = Math.max(0, this.low - this.lowPrev) / this.lowPeak
    this.lowPrev = this.low
    this.hit = Math.max(this.hit * 0.84, Math.min(1, flux * 3.2))
    if (this.cool > 0) this.cool--
  }

  /** Brightest-wins plot so glows and shapes can overlap without darkening each other. */
  private plot(buf: Buffer, x: number, y: number, k: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || k <= 0) return
    const o = (y * this.w + x) * 3
    const r = this.rgb[0] * Math.min(1, k), g = this.rgb[1] * Math.min(1, k), b = this.rgb[2] * Math.min(1, k)
    if (r > buf[o]) buf[o] = r
    if (g > buf[o + 1]) buf[o + 1] = g
    if (b > buf[o + 2]) buf[o + 2] = b
  }

  private disc(buf: Buffer, cx: number, cy: number, r: number, k = 1): void {
    const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1), y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cov = Math.min(1, Math.max(0, r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5))
      if (cov > 0) this.plot(buf, x, y, k * cov)
    }
  }

  /** Smooth value across the width, interpolating between the band levels. */
  private levelAt(x: number): number {
    const f = (x / this.w) * this.bars - 0.5
    const i = Math.floor(f), t = f - i
    const a = this.level[Math.min(this.bars - 1, Math.max(0, i))], b = this.level[Math.min(this.bars - 1, Math.max(0, i + 1))]
    const c = (1 - Math.cos(t * Math.PI)) / 2
    return a + (b - a) * c
  }

  // ---------------------------------------------------------------- styles
  /** Ribbon: a smooth glowing mountain range, mirrored around the middle. */
  private drawRibbon(buf: Buffer): void {
    const { w, h } = this
    const mid = h / 2
    for (let x = 0; x < w; x++) {
      const v = Math.pow(this.levelAt(x), 1.2)
      const half = Math.max(3, v * (h / 2 - 4))
      for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
        const e = 1 - Math.abs(dy) / half // 1 at the centre line, 0 at the edge
        const rim = Math.abs(dy) > half - 3 ? 1 : 0
        this.plot(buf, x, Math.round(mid + dy), rim ? 1 : 0.16 + 0.5 * e * e)
      }
    }
  }

  /** LED: stacked cells with falling peak caps, like a hi-fi analyser. */
  private drawLed(buf: Buffer): void {
    const { w, h, bars } = this
    const pitch = w / bars, bw = Math.max(4, Math.floor(pitch * 0.78))
    const cell = Math.max(7, Math.round(h / 16)), gap = Math.max(2, Math.round(cell * 0.22))
    const rows = Math.floor(h / (cell + gap))
    for (let b = 0; b < bars; b++) {
      const v = Math.pow(this.level[b], 1.1)
      this.capHold[b] = Math.max(v, this.capHold[b] - 0.014)
      const lit = Math.round(v * rows), cap = Math.min(rows - 1, Math.round(this.capHold[b] * rows))
      const x0 = Math.round(b * pitch + (pitch - bw) / 2)
      for (let r = 0; r < rows; r++) {
        const on = r < lit, isCap = r === cap && cap >= lit
        if (!on && !isCap) continue
        const k = isCap ? 1 : 0.4 + 0.6 * (r / rows)
        const y1 = h - r * (cell + gap), y0 = y1 - cell
        for (let y = y0; y < y1; y++) for (let x = x0; x < x0 + bw; x++) this.plot(buf, x, y, k)
      }
    }
  }

  /** Dots: columns of round beads that swell with the music. */
  private drawDots(buf: Buffer): void {
    const { w, h, bars } = this
    const pitch = w / bars
    const rows = 13, rowH = h / rows
    const base = Math.min(pitch * 0.34, rowH * 0.4)
    for (let b = 0; b < bars; b++) {
      const v = Math.pow(this.level[b], 1.1)
      const lit = Math.max(1, Math.round(v * rows))
      const cx = b * pitch + pitch / 2
      for (let r = 0; r < lit; r++) {
        const top = r === lit - 1
        const rad = base * (top ? 1.05 : 0.5 + 0.45 * ((lit - r) / lit))
        this.disc(buf, cx, h - rowH * (r + 0.5), rad, top ? 1 : 0.35 + 0.5 * (r / lit))
      }
    }
  }

  /** Sonar: every kick sends a ring across the frame from a pulsing core. */
  private drawSonar(buf: Buffer): void {
    const { w, h } = this
    const cx = w / 2, cy = h / 2
    if (this.hit > 0.45 && this.cool === 0) { this.rings.push({ t: 0 }); this.cool = 7 }
    if (this.rings.length === 0 && this.band(0, 1) > 0.05 && this.rnd() < 0.015) this.rings.push({ t: 0 }) // keep it alive on soft passages
    for (const ring of this.rings) ring.t += 0.022 + this.band(0.3, 0.9) * 0.012
    this.rings = this.rings.filter((r) => r.t < 1)
    for (const ring of this.rings) {
      const rx = ring.t * (w / 2), ry = ring.t * (h / 2) * 1.0
      const k = Math.pow(1 - ring.t, 1.4), th = 2.5 + 3 * (1 - ring.t)
      const n = Math.ceil(Math.PI * (rx + ry))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        this.disc(buf, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, th, k)
      }
    }
    const core = h * (0.07 + 0.07 * this.hit + 0.05 * this.band(0, 0.3))
    for (let r = core; r > 1; r -= 3) this.disc(buf, cx, cy, r, 0.25 + 0.75 * (1 - r / core))
  }

  /** Aurora: four drifting light ribbons that swell with the bass, mids and highs. */
  private drawAurora(buf: Buffer, frame: number): void {
    const { w, h } = this
    const t = frame / this.fps
    const groups = [this.band(0, 0.2), this.band(0.15, 0.45), this.band(0.4, 0.7), this.band(0.65, 1)]
    for (let l = 0; l < 4; l++) {
      const amp = h * (0.1 + 0.3 * groups[l]) + h * 0.05 * this.hit
      const f1 = (2.2 + l * 0.9) / w * Math.PI * 2, f2 = (0.8 + l * 0.3) / w * Math.PI * 2
      const th = h / 15, k0 = 1 - l * 0.2
      let prev = h / 2
      for (let x = 0; x < w; x++) {
        const y = h / 2 + amp * Math.sin(x * f1 + t * (1.3 + l * 0.45) + l * 1.7) * (0.65 + 0.35 * Math.sin(x * f2 - t * (0.7 + l * 0.2)))
        const a = Math.floor(Math.min(prev, y)), z = Math.ceil(Math.max(prev, y))
        for (let yy = a - Math.ceil(th); yy <= z + Math.ceil(th); yy++) {
          const d = yy < a ? a - yy : yy > z ? yy - z : 0
          const g = Math.exp(-Math.pow(d / (th * 0.55), 2))
          this.plot(buf, x, yy, k0 * g * (0.55 + 0.45 * groups[l]))
        }
        prev = y
      }
    }
  }

  /** Pulse: a heart-monitor line that spikes on every kick. */
  private drawPulse(buf: Buffer): void {
    const { w, h } = this
    const speed = Math.max(4, Math.round(w / (this.fps * 3.5)))
    if (this.hit > 0.4 && this.cool === 0 && this.ecgQueue.length === 0) {
      const a = 0.45 + 0.55 * this.hit
      const wave: number[] = []
      for (let i = 0; i < 6; i++) wave.push(0.1 * Math.sin((i / 5) * Math.PI)) // P
      for (let i = 0; i < 3; i++) wave.push(-0.12 * (i + 1) / 3) // Q
      for (let i = 0; i < 5; i++) wave.push(a * ((i + 1) / 5)) // R up
      for (let i = 0; i < 5; i++) wave.push(a * (1 - (i + 1) / 5) - 0.35 * a * ((i + 1) / 5)) // R down into S
      for (let i = 0; i < 4; i++) wave.push(-0.35 * a * (1 - (i + 1) / 4)) // S back
      for (let i = 0; i < 9; i++) wave.push(0.18 * Math.sin((i / 8) * Math.PI)) // T
      this.ecgQueue = wave
      this.cool = 6
    }
    this.ecg.copyWithin(0, speed)
    for (let i = w - speed; i < w; i++) this.ecg[i] = this.ecgQueue.length ? this.ecgQueue.shift()! : (this.rnd() - 0.5) * 0.006 + this.band(0, 1) * 0.012 * Math.sin(i * 0.25)
    const amp = h * 0.46, th = Math.max(3, Math.round(h / 38))
    let prev = h / 2 - this.ecg[0] * amp
    for (let x = 0; x < w; x++) {
      const y = h / 2 - this.ecg[x] * amp
      const k = 0.18 + 0.82 * Math.pow(x / w, 1.5)
      const a = Math.round(Math.min(prev, y)), z = Math.round(Math.max(prev, y))
      for (let yy = a - th; yy <= z + th; yy++) {
        const d = yy < a ? a - yy : yy > z ? yy - z : 0
        this.plot(buf, x, yy, k * Math.max(0, 1 - Math.pow(d / (th + 1), 2)))
      }
      prev = y
    }
    this.disc(buf, w - 3, h / 2 - this.ecg[w - 1] * amp, th * 2.2, 1)
  }

  /** Sparks: kicks throw glowing embers up from a low spectrum that fall back under gravity. */
  private drawSparks(buf: Buffer): void {
    const { w, h, bars } = this
    const pitch = w / bars
    for (let b = 0; b < bars; b++) {
      const v = Math.pow(this.level[b], 1.2)
      const bh = Math.max(3, v * h * 0.16)
      for (let y = Math.round(h - bh); y < h; y++) for (let x = Math.round(b * pitch + pitch * 0.2); x < Math.round(b * pitch + pitch * 0.8); x++) this.plot(buf, x, y, 0.5)
    }
    const energy = this.band(0, 1)
    const spawn = this.hit > 0.4 && this.cool === 0 ? 8 + Math.round(this.hit * 14) : energy > 0.12 ? 1 + Math.round(energy * 2) : 0
    if (this.hit > 0.4) this.cool = 5
    for (let i = 0; i < spawn; i++) {
      const bx = Math.floor(this.rnd() * this.rnd() * bars * 1.4) // weighted towards the bass side
      const x = Math.min(w - 1, (bx % bars) * pitch + pitch / 2)
      this.sparks.push({ x, y: h - 6, vx: (this.rnd() - 0.5) * w * 0.006, vy: -(h * 0.018 + this.rnd() * h * 0.03) * (0.6 + this.hit), life: 1, r: 2.5 + this.rnd() * 4.5 })
    }
    for (const p of this.sparks) {
      p.x += p.vx; p.y += p.vy; p.vy += h * 0.0016; p.life -= 0.011
    }
    this.sparks = this.sparks.filter((p) => p.life > 0 && p.y < h + 10 && this.sparks.length < 400)
    for (const p of this.sparks) {
      // short trail
      for (let t = 1; t <= 3; t++) this.disc(buf, p.x - p.vx * t * 1.4, p.y - p.vy * t * 1.4, p.r * (1 - t * 0.22), p.life * 0.4)
      this.disc(buf, p.x, p.y, p.r, Math.min(1, p.life * 1.3))
    }
  }
}
