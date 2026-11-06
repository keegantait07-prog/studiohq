// Bounces from the FL plugin arrive as WAV. The Vault stays MP3 only, so the WAV moves to an archive folder for WAV leases instead of being deleted.
import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { dirname, basename, extname, join } from 'path'
import ffmpegStatic from 'ffmpeg-static'

const ffmpeg = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked')

/** Moves a converted WAV out of the watched folder. Never overwrites, and copes with the archive being on another drive. */
export function archiveWav(wav: string, dir: string): string {
  mkdirSync(dir, { recursive: true })
  const stem = basename(wav, extname(wav))
  let dest = join(dir, stem + '.wav')
  for (let i = 2; existsSync(dest); i++) dest = join(dir, `${stem} (${i}).wav`)
  try { renameSync(wav, dest) } catch { copyFileSync(wav, dest); unlinkSync(wav) }
  return dest
}

export function wavToMp3(wav: string, archiveDir: string): Promise<string | null> {
  if (!existsSync(wav)) return Promise.resolve(null)
  let out = join(dirname(wav), basename(wav, extname(wav)) + '.mp3')
  for (let i = 2; existsSync(out); i++) out = join(dirname(wav), `${basename(wav, extname(wav))} (${i}).mp3`)
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', wav, '-vn', '-codec:a', 'libmp3lame', '-b:a', '320k', out])
    p.on('error', () => resolve(null))
    p.on('close', (code) => {
      // only move the WAV once the MP3 is really there
      if (code === 0 && existsSync(out) && statSync(out).size > 1000) { try { archiveWav(wav, archiveDir) } catch (e) { console.error('could not archive WAV', e) } resolve(out) }
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
      const ok = code === 0 && existsSync(out)
      if (ok) { try { unlinkSync(wav) } catch { /* already gone */ } } // a failed conversion keeps the source
      resolve(ok)
    })
  })
}
