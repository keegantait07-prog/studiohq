import { spawnSync } from 'child_process'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import { exportStill } from './stillvideo'

const ffmpeg = ffmpegStatic as unknown as string
const run = (...a: string[]) => spawnSync(ffmpeg, ['-hide_banner', '-y', ...a], { encoding: 'utf8' })

describe('exportStill', () => {
  it('makes a 1920x1080 H.264 + AAC video as long as the audio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shq-still-'))
    const audio = join(dir, 'a.wav'), img = join(dir, 'i.jpg'), out = join(dir, 'o.mp4')
    run('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', audio)
    run('-f', 'lavfi', '-i', 'color=c=blue:s=1280x720', '-frames:v', '1', img)
    const seen: number[] = []
    await exportStill({ audioPath: audio, framePath: img, outPath: out, durationSec: 3 }, (p) => seen.push(p))
    expect(existsSync(out)).toBe(true)
    const info = run('-i', out).stderr
    expect(info).toMatch(/Video: h264.*1920x1080/)
    expect(info).toMatch(/Audio: aac/)
    const m = info.match(/Duration: 00:00:0(\d\.\d+)/)
    expect(Number(m![1])).toBeGreaterThan(2.9)
    expect(Number(m![1])).toBeLessThan(3.2)
    expect(seen.at(-1)).toBe(1)
  })
  it('rejects with a plain message when the image is missing', async () => {
    await expect(exportStill({ audioPath: 'nope.wav', framePath: 'nope.jpg', outPath: join(tmpdir(), 'x.mp4'), durationSec: 1 }, () => {})).rejects.toThrow()
  })
})
