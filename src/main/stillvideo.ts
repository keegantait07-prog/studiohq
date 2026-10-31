// Beat audio over one still image, for the YouTube upload.
import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'

const ffmpeg = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked')

export function exportStill(
  o: { audioPath: string; framePath: string; outPath: string; durationSec: number },
  onProgress: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, [
      '-y', '-hide_banner', '-v', 'error', '-progress', 'pipe:1', '-nostats',
      '-loop', '1', '-framerate', '2', '-i', o.framePath, '-i', o.audioPath,
      '-vf', 'scale=1920:1080,format=yuv420p', '-c:v', 'libx264', '-tune', 'stillimage', '-preset', 'veryfast', '-crf', '20', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', o.outPath
    ])
    let err = ''
    p.stderr.on('data', (c) => (err += c))
    p.stdout.on('data', (c: Buffer) => {
      const m = String(c).match(/out_time_ms=(\d+)/g)?.pop()?.match(/(\d+)/)
      if (m && o.durationSec > 0) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / o.durationSec))
    })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) { onProgress(1); resolve(o.outPath) }
      else reject(new Error(err.trim().split('\n').pop() || 'The video could not be made.'))
    })
  })
}
