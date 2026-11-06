// Masters arrive anywhere from -7 to -27 LUFS. Video audio is levelled on its way out; the beat's own file is never touched.
import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'

const ffmpeg = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked')

/** Where quiet beats are brought up to. YouTube turns loud audio down, but it leaves quiet audio quiet. */
const TARGET_LUFS = -14
const MAX_GAIN_DB = 12
/** Limiter ceiling as a linear level, about -3 dBFS. AAC overshoot on loud masters needs the room: 0.8 measured -0.15 dBTP in a real export. */
const CEILING = 0.7

export interface Loudness { lufs: number; truePeak: number }

/** Reads the JSON report ffmpeg's loudnorm filter prints. */
export function parseLoudness(text: string): Loudness | null {
  const i = text.lastIndexOf('{')
  if (i < 0) return null
  try {
    const j = JSON.parse(text.slice(i, text.indexOf('}', i) + 1)) as { input_i?: string; input_tp?: string }
    const lufs = Number(j.input_i), truePeak = Number(j.input_tp)
    return Number.isFinite(lufs) && Number.isFinite(truePeak) ? { lufs, truePeak } : null
  } catch { return null }
}

/** The ffmpeg filters for video audio: lift quiet beats, and always catch peaks. Loud beats are only limited. */
export function videoAudioFilter(m: Loudness | null): string {
  const gain = m && m.lufs < TARGET_LUFS ? Math.min(TARGET_LUFS - m.lufs, MAX_GAIN_DB) : 0
  const limit = `alimiter=limit=${CEILING}:attack=5:release=50:level=false`
  return gain > 0.1 ? `volume=${gain.toFixed(1)}dB,${limit}` : limit
}

export function measureLoudness(path: string, startSec = 0, durSec?: number): Promise<Loudness | null> {
  return new Promise((resolve) => {
    const window = [...(startSec > 0 ? ['-ss', startSec.toFixed(3)] : []), ...(durSec ? ['-t', durSec.toFixed(3)] : [])]
    const p = spawn(ffmpeg, ['-hide_banner', '-nostats', ...window, '-i', path, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'])
    let err = ''
    p.stderr.on('data', (c) => (err += c))
    p.on('error', () => resolve(null))
    p.on('close', () => resolve(parseLoudness(err)))
  })
}
