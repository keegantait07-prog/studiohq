// Offline audio analysis for the video visualizers. Runs once per clip and produces one compact
// timeline (per-frame bands, envelopes, onsets, beat phase) that both the live preview and the
// export read, so the picture is always driven by exactly the same numbers.

export const NB = 32 // log-spaced spectrum bands
export const WAVE = 192 // waveform points per frame
export const VEC = 64 // stereo sample pairs per frame, for the vectorscope

export interface VizFeatures {
  fps: number
  frames: number
  /** frames * NB, 0..255, per-band normalised over the clip and attack/release smoothed */
  bands: Uint8Array
  bass: Float32Array
  mid: Float32Array
  high: Float32Array
  rms: Float32Array
  /** 0..1, jumps on each kick and decays */
  kick: Float32Array
  /** 0..1, jumps on each snare / clap / hat transient and decays fast */
  snap: Float32Array
  /** beats elapsed since the clip start, locked to the detected kicks (floor = beat number, frac = phase) */
  beat: Float32Array
  /** cumulative "distance travelled": grows faster when the music is loud, surges on kicks */
  drive: Float32Array
  /** frames * WAVE, the waveform around each frame, -127..127 */
  wave: Int8Array
  /** frame index of every kick, and its strength 0..1 */
  kicks: Int32Array
  kickAmp: Float32Array
  /** same for the snare/hat layer */
  snaps: Int32Array
  snapAmp: Float32Array
  bpm: number
  /** transcribed notes, packed [startFrame, endFrame, midi, velocity 0..1] */
  notes: Float32Array
  /** frames * 12, pitch-class energy C..B, 0..255 relative to the frame's strongest class */
  chroma: Uint8Array
  /** frames * VEC * 2, interleaved left/right samples around the frame, -127..127 */
  vec: Int8Array
  /** VU needles (0 = -20 VU, 1 = +3 VU) with real meter ballistics */
  vuL: Float32Array
  vuR: Float32Array
  /** frames, the frame's sample peak 0..255, for the clip overview */
  peak: Uint8Array
}

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

function percentile(a: ArrayLike<number>, p: number): number {
  const s = Float64Array.from(a).sort()
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] : 0
}

/** Map a dB series onto 0..1 using its own clip-wide spread, so quiet mixes still move the picture. */
function normalise(db: Float64Array, minSpread: number): Float64Array {
  const hi = percentile(db, 0.97)
  const lo = Math.min(percentile(db, 0.08), hi - minSpread)
  return db.map((v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))))
}

function smooth(v: Float64Array, up: number, down: number): Float32Array {
  const out = new Float32Array(v.length)
  let cur = 0
  for (let i = 0; i < v.length; i++) { cur += (v[i] - cur) * (v[i] > cur ? up : down); out[i] = cur }
  return out
}

/** Peak-pick a flux curve with an adaptive threshold; returns onset frames and strengths. */
function pickOnsets(flux: Float64Array, fps: number, minGapS: number, floor: number): { at: number[]; amp: number[] } {
  const ref = Math.max(1e-9, percentile(flux, 0.96))
  const n = flux.map((v) => v / ref)
  const at: number[] = [], amp: number[] = []
  const half = Math.round(fps * 0.3), gap = Math.max(2, Math.round(fps * minGapS))
  for (let i = 1; i < n.length - 1; i++) {
    if (!(n[i] > n[i - 1] && n[i] >= n[i + 1] && n[i] > floor)) continue
    let s = 0, c = 0
    for (let k = Math.max(0, i - half); k <= Math.min(n.length - 1, i + half); k++) { s += n[k]; c++ }
    if (n[i] < s / c + 0.14) continue
    if (at.length && i - at[at.length - 1] < gap) {
      if (n[i] > amp[amp.length - 1]) { at[at.length - 1] = i; amp[amp.length - 1] = Math.min(1, n[i]) }
      continue
    }
    at.push(i); amp.push(Math.min(1, n[i]))
  }
  return { at, amp }
}

function envelope(frames: number, at: number[], amp: number[], decayS: number, fps: number): Float32Array {
  const out = new Float32Array(frames)
  const k = Math.exp(-1 / (decayS * fps))
  let cur = 0, j = 0
  for (let i = 0; i < frames; i++) {
    cur *= k
    while (j < at.length && at[j] === i) { cur = Math.max(cur, 0.35 + 0.65 * amp[j]); j++ }
    out[i] = cur
  }
  return out
}

/** `stereo` is interleaved left/right. */
export function analyse(stereo: Float32Array, sr: number, fps: number, bpmHint: number | null): VizFeatures {
  const len = stereo.length >> 1
  const samples = new Float32Array(len)
  for (let i = 0; i < len; i++) samples[i] = (stereo[2 * i] + stereo[2 * i + 1]) / 2
  const frames = Math.max(1, Math.floor((samples.length / sr) * fps))
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))
  const re = new Float64Array(N), im = new Float64Array(N)
  const bin = (hz: number) => Math.max(1, Math.min(N / 2 - 1, Math.round((hz / sr) * N)))
  const edges = Array.from({ length: NB + 1 }, (_, i) => 30 * Math.pow(16000 / 30, i / NB)).map(bin)
  const bandDb = Array.from({ length: NB }, () => new Float64Array(frames))
  const bassDb = new Float64Array(frames), midDb = new Float64Array(frames), highDb = new Float64Array(frames), rmsDb = new Float64Array(frames)
  const lowFlux = new Float64Array(frames), hiFlux = new Float64Array(frames)
  const prevLog = new Float64Array(N / 2)
  const [l0, l1, h0, h1] = [bin(40), bin(160), bin(1800), bin(11000)]
  const band = (a: number, z: number, mag: Float64Array) => { let s = 0; for (let k = a; k <= z; k++) s += mag[k] * mag[k]; return 10 * Math.log10(s / (z - a + 1) + 1e-12) }
  const mag = new Float64Array(N / 2)

  for (let f = 0; f < frames; f++) {
    const start = Math.floor((f / fps) * sr) - N / 2
    let sq = 0
    for (let i = 0; i < N; i++) {
      const s = samples[start + i] ?? 0
      sq += s * s
      re[i] = s * win[i]; im[i] = 0
    }
    rmsDb[f] = 10 * Math.log10(sq / N + 1e-12)
    fft(re, im)
    let lf = 0, hf = 0
    for (let k = 1; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k]) / (N / 4)
      mag[k] = m
      const lg = Math.log(1 + 1000 * m)
      const d = lg - prevLog[k]
      if (d > 0) { if (k >= l0 && k <= l1) lf += d; else if (k >= h0 && k <= h1) hf += d }
      prevLog[k] = lg
    }
    lowFlux[f] = lf; hiFlux[f] = hf
    for (let b = 0; b < NB; b++) bandDb[b][f] = band(edges[b], Math.max(edges[b], edges[b + 1] - 1), mag)
    bassDb[f] = band(bin(30), bin(150), mag)
    midDb[f] = band(bin(250), bin(2000), mag)
    highDb[f] = band(bin(4000), bin(14000), mag)
  }

  const bands = new Uint8Array(frames * NB)
  for (let b = 0; b < NB; b++) {
    const s = smooth(normalise(bandDb[b], 22), 0.7, 0.2)
    for (let f = 0; f < frames; f++) bands[f * NB + b] = Math.round(Math.pow(s[f], 1.15) * 255)
  }
  const bass = smooth(normalise(bassDb, 20), 0.75, 0.16)
  const mid = smooth(normalise(midDb, 20), 0.6, 0.15)
  const high = smooth(normalise(highDb, 20), 0.7, 0.22)
  const rms = smooth(normalise(rmsDb, 18), 0.5, 0.08)

  const k = pickOnsets(lowFlux, fps, 0.14, 0.28)
  const s = pickOnsets(hiFlux, fps, 0.09, 0.3)
  const kick = envelope(frames, k.at, k.amp, 0.16, fps)
  const snap = envelope(frames, s.at, s.amp, 0.09, fps)

  // beat grid: the tempo hint, phase-locked to where the kicks actually land
  const bpm = bpmHint && bpmHint > 50 && bpmHint < 220 ? bpmHint : 120
  const P = (fps * 60) / bpm
  let sx = 0, sy = 0
  for (let i = 0; i < k.at.length; i++) { const a = (2 * Math.PI * k.at[i]) / P; sx += k.amp[i] * Math.cos(a); sy += k.amp[i] * Math.sin(a) }
  const off = k.at.length ? ((Math.atan2(sy, sx) / (2 * Math.PI)) * P + P) % P : 0
  const beat = new Float32Array(frames).map((_, f) => (f - off) / P + 1)

  const drive = new Float32Array(frames)
  for (let f = 1; f < frames; f++) drive[f] = drive[f - 1] + (0.3 + 0.7 * rms[f] + 1.6 * kick[f] * kick[f]) / fps

  // waveform: ~25 ms around each frame, scaled by the clip's own loud level
  let pk = 0
  for (let i = 0; i < samples.length; i += 7) pk = Math.max(pk, Math.abs(samples[i]))
  const scale = 127 / Math.max(0.05, pk * 0.85)
  const wave = new Int8Array(frames * WAVE)
  const span = Math.round(sr * 0.025)
  for (let f = 0; f < frames; f++) {
    const c = Math.floor((f / fps) * sr) - (span >> 1)
    for (let x = 0; x < WAVE; x++) {
      const a = c + Math.floor((x / WAVE) * span), z = c + Math.floor(((x + 1) / WAVE) * span)
      let sum = 0, n = 0
      for (let i = a; i < Math.max(z, a + 1); i++) { sum += samples[i] ?? 0; n++ }
      wave[f * WAVE + x] = Math.max(-127, Math.min(127, Math.round((sum / n) * scale)))
    }
  }

  const tonal = transcribe(samples, sr, fps, frames)
  const st = stereoFeatures(stereo, sr, fps, frames)
  const peak = new Uint8Array(frames)
  const hop = sr / fps
  for (let f = 0; f < frames; f++) {
    let m = 0
    for (let i = Math.floor(f * hop); i < Math.min(len, Math.floor((f + 1) * hop)); i += 3) m = Math.max(m, Math.abs(samples[i]))
    peak[f] = Math.min(255, Math.round((m / Math.max(0.05, pk)) * 255))
  }

  return { ...tonal, ...st, peak, fps, frames, bands, bass, mid, high, rms, kick, snap, beat, drive, wave, kicks: Int32Array.from(k.at), kickAmp: Float32Array.from(k.amp), snaps: Int32Array.from(s.at), snapAmp: Float32Array.from(s.amp), bpm }
}

const NP = 8192

/**
 * A light transcription for the piano roll: the strongest spectral peaks per frame (harmonics
 * folded onto their fundamentals), tracked into notes; plus a chroma vector per frame.
 */
function transcribe(x: Float32Array, sr: number, fps: number, frames: number): { notes: Float32Array; chroma: Uint8Array } {
  const win = new Float64Array(NP).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NP - 1)))
  const re = new Float64Array(NP), im = new Float64Array(NP), mag = new Float64Array(NP / 2)
  const hz = (k: number) => (k * sr) / NP
  const kLo = Math.ceil((55 / sr) * NP), kHi = Math.floor((1800 / sr) * NP), cLo = Math.ceil((100 / sr) * NP), cHi = Math.floor((4000 / sr) * NP)
  const pc = new Int8Array(NP / 2)
  for (let k = cLo; k <= cHi; k++) pc[k] = (((Math.round(69 + 12 * Math.log2(hz(k) / 440)) % 12) + 12) % 12)
  const chroma = new Uint8Array(frames * 12)
  const cand: { midi: number; m: number }[][] = []
  const maxima = new Float64Array(frames)
  const c12 = new Float64Array(12)
  for (let f = 0; f < frames; f++) {
    const start = Math.floor((f / fps) * sr) - NP / 2
    for (let i = 0; i < NP; i++) { re[i] = (x[start + i] ?? 0) * win[i]; im[i] = 0 }
    fft(re, im)
    let fm = 0
    for (let k = 1; k < NP / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); if (k >= kLo && k <= kHi && mag[k] > fm) fm = mag[k] }
    maxima[f] = fm
    c12.fill(0)
    for (let k = cLo; k <= cHi; k++) c12[pc[k]] += mag[k] * mag[k]
    const cm = Math.max(...c12) || 1
    for (let p = 0; p < 12; p++) chroma[f * 12 + p] = Math.round(Math.sqrt(c12[p] / cm) * 255)
    const peaks: { hz: number; m: number }[] = []
    for (let k = kLo; k <= kHi; k++) {
      const b = mag[k]
      if (b > fm * 0.14 && b > mag[k - 1] && b >= mag[k + 1]) {
        const a = mag[k - 1], c = mag[k + 1], d = a - 2 * b + c
        peaks.push({ hz: hz(k + (d ? (0.5 * (a - c)) / d : 0)), m: b })
      }
    }
    peaks.sort((p, q) => q.m - p.m)
    const kept: { hz: number; m: number }[] = []
    for (const p of peaks) {
      if (kept.length >= 4) break
      if (kept.some((q) => { const r = p.hz / q.hz, n = Math.round(r); return n >= 2 && Math.abs(r - n) < 0.035 * n })) continue
      kept.push(p)
    }
    cand.push(kept.map((p) => ({ midi: Math.round(69 + 12 * Math.log2(p.hz / 440)), m: p.m })))
  }
  const loud = percentile(maxima, 0.9) || 1, floor = loud * 0.06
  const notes: number[] = []
  const active = new Map<number, { s: number; last: number; v: number }>()
  const close = (midi: number, n: { s: number; last: number; v: number }) => { if (n.last - n.s >= 2) notes.push(n.s, n.last + 1, midi, n.v) }
  for (let f = 0; f < frames; f++) {
    for (const c of cand[f]) {
      if (c.m < floor) continue
      const v = Math.min(1, c.m / loud)
      const n = active.get(c.midi)
      if (n) { n.last = f; n.v = Math.max(n.v, v) } else active.set(c.midi, { s: f, last: f, v })
    }
    for (const [midi, n] of active) if (f - n.last > 2) { close(midi, n); active.delete(midi) }
  }
  for (const [midi, n] of active) close(midi, n)
  // sort by start frame
  const idx = Array.from({ length: notes.length / 4 }, (_, i) => i).sort((a, b) => notes[a * 4] - notes[b * 4])
  return { notes: Float32Array.from(idx.flatMap((i) => notes.slice(i * 4, i * 4 + 4))), chroma }
}

function stereoFeatures(st: Float32Array, sr: number, fps: number, frames: number): { vec: Int8Array; vuL: Float32Array; vuR: Float32Array } {
  const len = st.length >> 1, hop = sr / fps
  let pk = 0
  for (let i = 0; i < st.length; i += 9) pk = Math.max(pk, Math.abs(st[i]))
  const scale = 127 / Math.max(0.05, pk * 0.9)
  const vec = new Int8Array(frames * VEC * 2)
  const span = Math.round(sr * 0.02)
  const dbL = new Float64Array(frames), dbR = new Float64Array(frames)
  for (let f = 0; f < frames; f++) {
    const c = Math.floor(f * hop)
    for (let j = 0; j < VEC; j++) {
      const i = Math.min(len - 1, Math.max(0, c - (span >> 1) + Math.floor((j / VEC) * span)))
      vec[(f * VEC + j) * 2] = Math.max(-127, Math.min(127, Math.round(st[2 * i] * scale)))
      vec[(f * VEC + j) * 2 + 1] = Math.max(-127, Math.min(127, Math.round(st[2 * i + 1] * scale)))
    }
    let l = 0, r = 0, n = 0
    for (let i = c; i < Math.min(len, c + hop); i++) { l += st[2 * i] ** 2; r += st[2 * i + 1] ** 2; n++ }
    dbL[f] = 10 * Math.log10(l / Math.max(1, n) + 1e-12); dbR[f] = 10 * Math.log10(r / Math.max(1, n) + 1e-12)
  }
  // 0 VU sits at the clip's loud passages; the needle integrates over ~300 ms like a real VU meter
  const ref = percentile(Float64Array.from([...dbL, ...dbR]), 0.9)
  const needle = (db: Float64Array) => {
    const out = new Float32Array(frames), k = 1 - Math.exp(-1 / (0.3 * fps / 2.2))
    let cur = 0
    for (let f = 0; f < frames; f++) { const tgt = Math.min(1.08, Math.max(0, (db[f] - ref + 20) / 23)); cur += (tgt - cur) * k; out[f] = cur }
    return out
  }
  return { vec, vuL: needle(dbL), vuR: needle(dbR) }
}
