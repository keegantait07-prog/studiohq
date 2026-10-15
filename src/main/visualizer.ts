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

  constructor(private samples: Float32Array, private w: number, private h: number, private bars: number, private style: VizStyle, accent: string, private fps = 30) {
    this.level = new Float32Array(bars)
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
    if (this.style === 'line') this.drawLine(buf, i)
    else {
      this.analyse(i)
      this.drawBars(buf)
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
}
