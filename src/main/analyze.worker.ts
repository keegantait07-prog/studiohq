import { parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import { parseFile } from 'music-metadata'
import ffmpegStatic from 'ffmpeg-static'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Essentia, EssentiaWASM } = require('essentia.js')

const ffmpeg = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked')
const essentia = new Essentia(EssentiaWASM)

export interface AnalyzeRequest { id: number; path: string }
export interface AnalyzeResult {
  id: number
  ok: boolean
  error?: string
  duration?: number
  bpm?: number
  bpmConfidence?: 'high' | 'low'
  key?: string
  peaks?: number[]
  thumb?: number[]
}

function decode(path: string, rate: number, opts: string[] = []): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', ...opts, '-i', path, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'])
    const chunks: Buffer[] = []
    let err = ''
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.stderr.on('data', (c: Buffer) => (err += c))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0 && !chunks.length) return reject(new Error(err.trim() || `ffmpeg exited ${code}`))
      const buf = Buffer.concat(chunks)
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength - (buf.byteLength % 4))
      resolve(new Float32Array(ab))
    })
  })
}

function peaksOf(pcm: Float32Array, n: number): number[] {
  const out: number[] = new Array(n).fill(0)
  const step = pcm.length / n
  for (let i = 0; i < n; i++) {
    let max = 0
    const a = Math.floor(i * step)
    const b = Math.min(pcm.length, Math.floor((i + 1) * step))
    for (let j = a; j < b; j++) {
      const v = Math.abs(pcm[j])
      if (v > max) max = v
    }
    out[i] = max
  }
  const top = Math.max(...out, 1e-6)
  return out.map((v) => Math.round(Math.sqrt(v / top) * 255))
}

const fold = (b: number) => {
  while (b < 75) b *= 2
  while (b >= 180) b /= 2
  return b
}
const tidy = (b: number) => (Math.abs(b - Math.round(b)) < 0.15 ? Math.round(b) : Math.round(b * 10) / 10)

async function analyze(req: AnalyzeRequest): Promise<AnalyzeResult> {
  const meta = await parseFile(req.path, { duration: true }).catch(() => null)
  let duration = meta?.format.duration ?? 0

  const low = await decode(req.path, 8000, ['-t', '1200'])
  if (!duration) duration = low.length / 8000
  const peaks = peaksOf(low, 1000)
  const thumb = peaksOf(low, 48)

  // analyse a 2 minute window from the middle-ish of the beat
  const start = duration > 150 ? 15 : 0
  const pcm = await decode(req.path, 44100, ['-ss', String(start), '-t', '120'])
  if (pcm.length < 44100 * 3) return { id: req.id, ok: true, duration, peaks, thumb }

  const vec = essentia.arrayToVector(pcm)
  let bpm: number | undefined
  let bpmConfidence: 'high' | 'low' = 'low'
  try {
    const perc = essentia.PercivalBpmEstimator(vec).bpm as number
    const rhythm = essentia.RhythmExtractor2013(vec)
    const a = fold(perc)
    const b = fold(rhythm.bpm as number)
    if (Math.abs(a - b) / a < 0.03) {
      bpm = tidy(b)
      bpmConfidence = 'high'
    } else {
      bpm = tidy(a)
    }
  } catch { /* leave bpm unset */ }

  let key: string | undefined
  try {
    const k = essentia.KeyExtractor(vec)
    key = `${k.key} ${k.scale}`
  } catch { /* leave key unset */ }
  vec.delete?.()
  return { id: req.id, ok: true, duration, bpm, bpmConfidence, key, peaks, thumb }
}

parentPort!.on('message', async (req: AnalyzeRequest) => {
  try {
    parentPort!.postMessage(await analyze(req))
  } catch (e) {
    parentPort!.postMessage({ id: req.id, ok: false, error: (e as Error).message } satisfies AnalyzeResult)
  }
})
