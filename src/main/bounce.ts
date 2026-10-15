// Bounces from the FL plugin arrive as WAV; Studio HQ keeps MP3 only, so convert and remove the WAV.
import { spawn } from 'child_process'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { dirname, basename, extname, join } from 'path'
import ffmpegStatic from 'ffmpeg-static'

const ffmpeg = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked')

export function wavToMp3(wav: string): Promise<string | null> {
  if (!existsSync(wav)) return Promise.resolve(null)
  let out = join(dirname(wav), basename(wav, extname(wav)) + '.mp3')
  for (let i = 2; existsSync(out); i++) out = join(dirname(wav), `${basename(wav, extname(wav))} (${i}).mp3`)
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', wav, '-vn', '-codec:a', 'libmp3lame', '-b:a', '320k', out])
    p.on('error', () => resolve(null))
    p.on('close', (code) => {
      // only delete the WAV once the MP3 is really there
      if (code === 0 && existsSync(out) && statSync(out).size > 1000) { try { unlinkSync(wav) } catch { /* keep it */ } resolve(out) }
      else resolve(null)
    })
  })
}

/** A short loop for a beat that was never exported: small MP3 kept in the app's own folder, never in the vault. */
export function loopToMp3(wav: string, out: string): Promise<boolean> {
  mkdirSync(dirname(out), { recursive: true })
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', wav, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', out])
    p.on('error', () => resolve(false))
    p.on('close', (code) => {
      try { unlinkSync(wav) } catch { /* already gone */ }
      resolve(code === 0 && existsSync(out))
    })
  })
}
