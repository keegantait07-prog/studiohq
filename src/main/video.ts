import type Database from 'better-sqlite3'
import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { once } from 'events'
import { parseFile } from 'music-metadata'
import ffmpegStatic from 'ffmpeg-static'
import { LAYOUT, videoHtml } from '../shared/videoTemplate'
import { Visualizer } from './visualizer'
import type { VideoFormat, VideoOptions, VideoProgress } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ffmpeg = (ffmpegStatic as unknown as string).replace('app.asar', 'app.asar.unpacked')
const FPS = 30

export async function coverData(db: Database.Database, beatId: number, max = 1400): Promise<string | null> {
  const b = db.prepare('SELECT path, cover_path FROM beats WHERE id=?').get(beatId) as Row | undefined
  if (!b) return null
  let img = b.cover_path && existsSync(b.cover_path) ? nativeImage.createFromPath(b.cover_path) : null
  if (!img || img.isEmpty()) {
    try {
      const meta = await parseFile(b.path, { skipPostHeaders: true })
      const pic = meta.common.picture?.[0]
      img = pic ? nativeImage.createFromBuffer(Buffer.from(pic.data)) : null
    } catch { img = null }
  }
  if (!img || img.isEmpty()) return null
  const { width, height } = img.getSize()
  if (Math.max(width, height) > max) img = img.resize(width >= height ? { width: max } : { height: max })
  return 'data:image/jpeg;base64,' + img.toJPEG(88).toString('base64')
}

export async function pickCover(db: Database.Database, win: BrowserWindow, beatId: number): Promise<boolean> {
  const r = await dialog.showOpenDialog(win, { title: 'Choose cover art', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] })
  if (r.canceled || !r.filePaths[0]) return false
  db.prepare('UPDATE beats SET cover_path=? WHERE id=?').run(r.filePaths[0], beatId)
  return true
}

async function renderStill(html: string, W: number, H: number, dir: string): Promise<Buffer> {
  const file = join(dir, `frame-${W}x${H}.html`)
  writeFileSync(file, html)
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, enableLargerThanScreen: true, frame: false, webPreferences: { sandbox: true, backgroundThrottling: false } })
  try {
    win.setContentSize(W, H)
    await win.loadFile(file)
    await win.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
    await new Promise((r) => setTimeout(r, 250))
    let img = await win.webContents.capturePage()
    const s = img.getSize()
    if (s.width !== W || s.height !== H) img = img.resize({ width: W, height: H, quality: 'best' })
    return img.toPNG()
  } finally {
    win.destroy()
  }
}

function decodeMono(path: string, start: number, dur: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-ss', String(start), '-t', String(dur), '-i', path, '-vn', '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'])
    const chunks: Buffer[] = []
    let err = ''
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.stderr.on('data', (c: Buffer) => (err += c))
    p.on('error', reject)
    p.on('close', (code) => {
      const b = Buffer.concat(chunks)
      if (code !== 0 && !b.length) return reject(new Error(err.trim() || 'Could not read the audio.'))
      resolve(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4))))
    })
  })
}

let previewDir: string | null = null
export async function previewStill(db: Database.Database, o: Omit<VideoOptions, 'formats'> & { format: VideoFormat }): Promise<string> {
  const beat = db.prepare('SELECT peaks FROM beats WHERE id=?').get(o.beatId) as Row | undefined
  if (!beat) throw new Error('Beat not found.')
  previewDir ??= mkdtempSync(join(tmpdir(), 'studio-hq-preview-'))
  const L = LAYOUT[o.format]
  const html = videoHtml({ format: o.format, look: o.look, viz: o.viz, accent: o.accent, title: o.title, tagline: o.tagline, footer: o.footer, cover: await coverData(db, o.beatId, 900), peaks: [], preview: false })
  const png = await renderStill(html, L.W, L.H, previewDir)
  const img = nativeImage.createFromBuffer(png).resize({ width: o.format === 'vertical' ? 540 : 960, quality: 'good' })
  return 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64')
}

export class VideoExporter {
  private proc: ChildProcess | null = null
  private cancelled = false
  busy = false

  constructor(private db: Database.Database, private exportDir: () => string) {}

  cancel(): void {
    this.cancelled = true
    this.proc?.kill('SIGKILL')
  }

  async run(o: VideoOptions, onProgress: (p: VideoProgress) => void): Promise<string[]> {
    if (this.busy) throw new Error('An export is already running.')
    const beat = this.db.prepare('SELECT * FROM beats WHERE id=?').get(o.beatId) as Row | undefined
    if (!beat) throw new Error('Beat not found.')
    this.busy = true
    this.cancelled = false
    const tmp = mkdtempSync(join(tmpdir(), 'studio-hq-video-'))
    const outDir = process.env.SHQ_TEST_EXPORT_DIR ?? this.exportDir()
    mkdirSync(outDir, { recursive: true })
    const out: string[] = []
    try {
      const cover = await coverData(this.db, o.beatId)
      const peaks: number[] = beat.peaks ? JSON.parse(beat.peaks) : []
      for (let fi = 0; fi < o.formats.length; fi++) {
        const format = o.formats[fi]
        const label = `${format === 'vertical' ? 'Vertical' : 'Horizontal'}${o.formats.length > 1 ? ` (${fi + 1}/${o.formats.length})` : ''}`
        onProgress({ label: `${label}: designing frame`, pct: 0 })
        const L = LAYOUT[format]
        const html = videoHtml({ format, look: o.look, viz: o.viz, accent: o.accent, title: o.title, tagline: o.tagline, footer: o.footer, cover, peaks, preview: false })
        const png = await renderStill(html, L.W, L.H, tmp)
        const bgPath = join(tmp, `bg-${format}.png`)
        writeFileSync(bgPath, png)
        if (this.cancelled) throw new Error('Export cancelled.')

        const total = beat.duration ?? 0
        const start = Math.min(Math.max(0, o.start), Math.max(0, total - 3))
        const dur = o.length > 0 ? Math.min(o.length, total - start) : total - start
        if (!(dur > 1)) throw new Error('The clip is too short.')
        onProgress({ label: `${label}: reading audio`, pct: 0 })
        const samples = await decodeMono(beat.path, start, dur)
        const frames = Math.round(dur * FPS)
        const wv = L.wave
        const viz = new Visualizer(samples, wv.w, wv.h, format === 'vertical' ? 48 : 80, o.viz, o.accent, FPS)

        const path = uniquePath(outDir, `${beat.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Beat'} - ${format}.mp4`)
        const fade = Math.min(0.6, dur / 4)
        const graph =
          `[1:v]format=rgb24,split[wa][wb];[wb]gblur=sigma=16[wg];[wa][wg]blend=all_mode=screen,pad=${L.W}:${L.H}:${wv.x}:${wv.y}:black,format=gbrp[w];` +
          `[0:v]${motionFilter(o.motion ?? 'still', L.W, L.H, dur, beat.bpm as number | null)}format=gbrp[b];[b][w]blend=all_mode=screen:shortest=1,format=yuv420p[v];` +
          `[2:a]afade=t=in:d=0.03,afade=t=out:st=${(dur - fade).toFixed(2)}:d=${fade.toFixed(2)}[a]`
        const args = [
          '-y', '-hide_banner', '-v', 'error', '-progress', 'pipe:1', '-nostats',
          '-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(3), '-i', bgPath,
          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${wv.w}x${wv.h}`, '-framerate', String(FPS), '-i', 'pipe:0',
          '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', beat.path,
          '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS),
          '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', path
        ]
        const p = spawn(ffmpeg, args)
        this.proc = p
        let err = ''
        p.stderr.on('data', (c) => (err += c))
        p.stdout.on('data', (c: Buffer) => {
          const m = /out_time_us=(\d+)/.exec(c.toString())
          if (m) onProgress({ label: `${label}: encoding`, pct: Math.min(0.99, +m[1] / 1e6 / dur) })
        })
        const done = new Promise<number>((res) => p.on('close', (code) => res(code ?? 1)))
        p.stdin.on('error', () => { /* ffmpeg exited early; the exit code explains why */ })
        for (let i = 0; i < frames && !this.cancelled; i++) {
          if (!p.stdin.write(viz.frame(i))) await once(p.stdin, 'drain')
        }
        p.stdin.end()
        const code = await done
        this.proc = null
        if (this.cancelled) { try { unlinkSync(path) } catch { /* partial file may not exist */ } throw new Error('Export cancelled.') }
        if (code !== 0) throw new Error(`ffmpeg failed: ${err.trim().slice(-300) || 'exit ' + code}`)
        this.db.prepare('INSERT INTO videos(beat_id,format,path,created_at) VALUES(?,?,?,?)').run(o.beatId, format as VideoFormat, path, Date.now())
        out.push(path)
        onProgress({ label: `${label}: done`, pct: 1 })
      }
      return out
    } finally {
      this.busy = false
      this.proc = null
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

/** The frame itself can move: a slow push-in, a steady breath, or a bounce locked to the beat's tempo. */
function motionFilter(motion: string, W: number, H: number, dur: number, bpm: number | null): string {
  if (motion === 'still') return ''
  const frames = Math.max(1, Math.round(dur * FPS))
  let z: string
  if (motion === 'drift') z = `1+0.07*on/${frames}`
  else if (motion === 'beat' && bpm && bpm > 40 && bpm < 240) z = `1.015+0.04*pow(1-mod(on*${bpm}/${60 * FPS},1),3)`
  else z = `1.04+0.03*sin(2*PI*on/${FPS * 4})`
  // work from a 2x copy so the slow zoom doesn't shimmer
  return `scale=${W * 2}:${H * 2}:flags=bicubic,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},`
}

function uniquePath(dir: string, name: string): string {
  const base = name.replace(/\.mp4$/, '')
  let p = join(dir, name)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${base} (${i}).mp4`)
  return p
}
void app
