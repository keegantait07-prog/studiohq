import type Database from 'better-sqlite3'
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync, existsSync, unlinkSync, openSync, writeSync, closeSync } from 'fs'
import { join } from 'path'
import { once } from 'events'
import { measureLoudness, videoAudioFilter } from './loudness'
import { parseFile } from 'music-metadata'
import ffmpegStatic from 'ffmpeg-static'
import { sceneLayout } from '../shared/videoTemplate'
import { analyse, type VizFeatures } from '../shared/vizFeatures'
import type { VideoFormat, VideoOptions, VideoProgress, VizJob } from '../shared/types'

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

/** Interleaved stereo float samples at 44.1 kHz. */
function decodeStereo(path: string, start: number, dur: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-ss', String(start), '-t', String(dur), '-i', path, '-vn', '-ac', '2', '-ar', '44100', '-f', 'f32le', '-'])
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

// ---- the analysed timeline, shared by the live preview and the export
const featureCache = new Map<string, VizFeatures>()
export async function vizFeatures(db: Database.Database, beatId: number, start: number, length: number): Promise<VizFeatures> {
  const beat = db.prepare('SELECT path, duration, bpm FROM beats WHERE id=?').get(beatId) as Row | undefined
  if (!beat) throw new Error('Beat not found.')
  const total = beat.duration ?? 0
  const s = Math.min(Math.max(0, start), Math.max(0, total - 3))
  const dur = length > 0 ? Math.min(length, total - s) : total - s
  const key = `${beat.path}|${s.toFixed(2)}|${dur.toFixed(2)}|${beat.bpm}`
  const hit = featureCache.get(key)
  if (hit) return hit
  const f = analyse(await decodeStereo(beat.path, s, Math.max(1, dur)), 44100, FPS, beat.bpm as number | null)
  featureCache.set(key, f)
  if (featureCache.size > 6) featureCache.delete(featureCache.keys().next().value!)
  return f
}

// ---- the hidden window that draws export frames with the same scene code as the preview
type JobHooks = {
  ready: (err?: string, encoder?: boolean) => void
  frame: (i: number, d: Uint8Array) => void
  chunk?: (pos: number, d: Uint8Array) => void
  progress?: (done: number) => void
  done?: (err?: string) => void
}
const jobs = new Map<number, JobHooks>()
let jobSeq = 0, wired = false
function wireWorker(): void {
  if (wired) return
  wired = true
  ipcMain.on('viz:ready', (_, id: number, err?: string, encoder?: boolean) => jobs.get(id)?.ready(err, encoder))
  ipcMain.on('viz:frame', (_, id: number, i: number, d: Uint8Array) => jobs.get(id)?.frame(i, d))
  ipcMain.on('viz:chunk', (_, id: number, pos: number, d: Uint8Array) => jobs.get(id)?.chunk?.(pos, d))
  ipcMain.on('viz:progress', (_, id: number, done: number) => jobs.get(id)?.progress?.(done))
  ipcMain.on('viz:done', (_, id: number, err?: string) => jobs.get(id)?.done?.(err))
}

async function openWorker(): Promise<BrowserWindow> {
  wireWorker()
  const w = new BrowserWindow({ show: false, width: 320, height: 240, webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  if (process.env['ELECTRON_RENDERER_URL']) await w.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#viz-worker')
  else await w.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'viz-worker' })
  return w
}

export class VideoExporter {
  private proc: ChildProcess | null = null
  private worker: BrowserWindow | null = null
  private wake: (() => void) | null = null
  private cancelled = false
  busy = false

  constructor(private db: Database.Database, private exportDir: () => string) {}

  cancel(): void {
    this.cancelled = true
    this.proc?.kill('SIGKILL')
    this.wake?.()
    this.abortEncode?.()
  }
  private abortEncode: (() => void) | null = null

  async run(o: VideoOptions, onProgress: (p: VideoProgress) => void): Promise<string[]> {
    if (this.busy) throw new Error('An export is already running.')
    const beat = this.db.prepare('SELECT * FROM beats WHERE id=?').get(o.beatId) as Row | undefined
    if (!beat) throw new Error('Beat not found.')
    this.busy = true
    this.cancelled = false
    const outDir = process.env.SHQ_TEST_EXPORT_DIR ?? this.exportDir()
    mkdirSync(outDir, { recursive: true })
    const out: string[] = []
    try {
      const cover = await coverData(this.db, o.beatId)
      for (let fi = 0; fi < o.formats.length; fi++) {
        const format = o.formats[fi]
        const label = `${format === 'vertical' ? 'Vertical' : 'Horizontal'}${o.formats.length > 1 ? ` (${fi + 1}/${o.formats.length})` : ''}`
        const L = sceneLayout(format)
        const total = beat.duration ?? 0
        const start = Math.min(Math.max(0, o.start), Math.max(0, total - 3))
        const dur = o.length > 0 ? Math.min(o.length, total - start) : total - start
        const levels = videoAudioFilter(await measureLoudness(beat.path, start, dur))
        if (!(dur > 1)) throw new Error('The clip is too short.')
        onProgress({ label: `${label}: listening to the beat`, pct: 0 })
        const features = await vizFeatures(this.db, o.beatId, start, dur)
        const frames = Math.min(features.frames, Math.round(dur * FPS))
        if (this.cancelled) throw new Error('Export cancelled.')

        this.worker ??= await openWorker()
        const worker = this.worker
        const id = ++jobSeq
        const got = new Map<number, Uint8Array>()
        let gone: string | null = null
        const hooks: JobHooks = { ready: () => {}, frame: (i, d) => { got.set(i, d); this.wake?.() } }
        jobs.set(id, hooks)
        const ready = new Promise<boolean>((res, rej) => {
          const t = setTimeout(() => rej(new Error('The frame renderer did not start.')), 20000)
          hooks.ready = (err, encoder) => { clearTimeout(t); if (err) rej(new Error(err)); else res(!!encoder && !process.env.SHQ_NO_WEBCODECS) }
        })
        const onGone = () => { gone = 'The frame renderer stopped unexpectedly.'; this.worker = null; this.wake?.(); this.abortEncode?.() }
        worker.webContents.once('render-process-gone', onGone)
        const job: VizJob = { id, style: o.viz, accent: o.accent, motion: o.motion ?? 'still', titles: o.titles ?? 'intro', layout: L, features, meta: { title: o.title, tagline: o.tagline, footer: o.footer, cta: o.cta ?? '', bpm: beat.bpm ?? null, key: beat.key ?? null, cover } }
        worker.webContents.send('viz:job', job)

        const path = uniquePath(outDir, `${beat.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Beat'} - ${format}.mp4`)
        const fade = Math.min(0.6, dur / 4)
        let encoder: boolean
        try { encoder = await ready } catch (e) { jobs.delete(id); worker.webContents.removeListener('render-process-gone', onGone); throw e }

        if (encoder) {
          // the window encodes H.264 itself; ffmpeg only adds the audio, copying the video stream
          const tmp = join(app.getPath('temp'), `shq-video-${process.pid}-${id}.mp4`)
          const fd = openSync(tmp, 'w')
          try {
            await new Promise<void>((res, rej) => {
              this.abortEncode = () => rej(new Error(gone ?? 'Export cancelled.'))
              hooks.chunk = (pos, d) => { writeSync(fd, d, 0, d.byteLength, pos) }
              hooks.progress = (n) => onProgress({ label: `${label}: rendering`, pct: Math.min(0.97, (n / frames) * 0.97) })
              hooks.done = (err) => (err ? rej(new Error(err)) : res())
              worker.webContents.send('viz:encode', { id, frames })
            })
          } catch (e) {
            // a cancelled encode is still running in the window; drop it so the next job starts clean
            this.worker?.destroy(); this.worker = null
            throw e
          } finally {
            closeSync(fd)
            this.abortEncode = null
            jobs.delete(id)
            if (this.cancelled || gone) try { unlinkSync(tmp) } catch { /* may not exist */ }
            if (!worker.isDestroyed()) worker.webContents.removeListener('render-process-gone', onGone)
          }
          onProgress({ label: `${label}: adding the audio`, pct: 0.98 })
          const mux = spawn(ffmpeg, [
            '-y', '-hide_banner', '-v', 'error', '-i', tmp, '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', beat.path,
            '-filter_complex', `[1:a]${levels},afade=t=in:d=0.03,afade=t=out:st=${(dur - fade).toFixed(2)}:d=${fade.toFixed(2)}[a]`,
            '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', path
          ])
          this.proc = mux
          let merr = ''
          mux.stderr.on('data', (c) => (merr += c))
          const code = await new Promise<number>((res) => { mux.on('error', () => res(1)); mux.on('close', (c) => res(c ?? 1)) })
          this.proc = null
          try { unlinkSync(tmp) } catch { /* already gone */ }
          if (this.cancelled) { try { unlinkSync(path) } catch { /* partial file may not exist */ } throw new Error('Export cancelled.') }
          if (code !== 0) throw new Error(`ffmpeg failed: ${merr.trim().slice(-300) || 'exit ' + code}`)
          this.db.prepare('INSERT INTO videos(beat_id,format,path,created_at) VALUES(?,?,?,?)').run(o.beatId, format as VideoFormat, path, Date.now())
          out.push(path)
          onProgress({ label: `${label}: done`, pct: 1 })
          continue
        }

        const args = [
          '-y', '-hide_banner', '-v', 'error', '-progress', 'pipe:1', '-nostats',
          '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${L.W}x${L.H}`, '-framerate', String(FPS), '-i', 'pipe:0',
          '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', beat.path,
          '-filter_complex', `[0:v]format=yuv420p[v];[1:a]${levels},afade=t=in:d=0.03,afade=t=out:st=${(dur - fade).toFixed(2)}:d=${fade.toFixed(2)}[a]`,
          '-map', '[v]', '-map', '[a]',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-r', String(FPS),
          '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', path
        ]
        const p = spawn(ffmpeg, args)
        this.proc = p
        let err = ''
        p.stderr.on('data', (c) => (err += c))
        p.stdout.on('data', (c: Buffer) => {
          const m = /out_time_us=(\d+)/.exec(c.toString())
          if (m) onProgress({ label: `${label}: rendering`, pct: Math.min(0.99, +m[1] / 1e6 / dur) })
        })
        const done = new Promise<number>((res) => p.on('close', (code) => res(code ?? 1)))
        p.stdin.on('error', () => { /* ffmpeg exited early; the exit code explains why */ })
        try {
          let asked = 0
          for (let i = 0; i < frames && !this.cancelled; i++) {
            while (asked < frames && asked < i + 16) { const to = Math.min(frames, asked + 8); worker.webContents.send('viz:render', { id, from: asked, to }); asked = to }
            while (!got.has(i) && !this.cancelled && !gone) await new Promise<void>((r) => (this.wake = r))
            if (gone) throw new Error(gone)
            const d = got.get(i)
            got.delete(i)
            if (d && !p.stdin.write(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) await once(p.stdin, 'drain')
          }
        } finally {
          jobs.delete(id)
          this.wake = null
          worker.webContents.removeListener('render-process-gone', onGone)
          p.stdin.end()
        }
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
      this.worker?.destroy()
      this.worker = null
    }
  }
}

function uniquePath(dir: string, name: string): string {
  const base = name.replace(/\.mp4$/, '')
  let p = join(dir, name)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${base} (${i}).mp4`)
  return p
}
void app
