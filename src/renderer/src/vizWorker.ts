// Runs inside the hidden export window (#viz-worker): draws each frame with the same preset code
// as the live preview. When WebCodecs can encode H.264 here, Mediabunny encodes the frames straight
// off the canvas and streams the MP4 to main (no pixel readback); otherwise the RGBA pixels go to
// main, which pipes them into ffmpeg.
import { canEncodeVideo, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget, type StreamTargetChunk } from 'mediabunny'
import { createScene, loadSceneFonts, motionScale, type SceneDraw } from '@shared/vizScene'
import { drawOverlay } from '@shared/vizOverlay'
import type { VizJob } from '@shared/types'

/** Decoded through <img>: the page's CSP allows data: images but not fetch() of data: URLs. */
async function loadCover(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null
  const img = new Image()
  img.src = url
  try { await img.decode(); return img } catch { return null }
}

const canEncode = (W: number, H: number) =>
  typeof VideoEncoder === 'undefined' ? Promise.resolve(false) : canEncodeVideo('avc', { width: W, height: H, bitrate: QUALITY_HIGH }).catch(() => false)

export function startVizWorker(): void {
  const api = window.api.vizWorker
  let job: VizJob | null = null
  let draw: SceneDraw | null = null
  const out = document.createElement('canvas')
  const layer = document.createElement('canvas')
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  const lctx = layer.getContext('2d')!

  /** Paint frame i: the preset (moved by the frame motion), then the titles, which hold still. */
  const compose = (j: VizJob, c: CanvasRenderingContext2D, i: number) => {
    const { W, H } = j.layout
    draw!(lctx, j.features, i)
    const s = motionScale(j.motion, j.features, i)
    c.setTransform(s, 0, 0, s, (W - W * s) / 2, (H - H * s) / 2)
    c.drawImage(layer, 0, 0)
    c.setTransform(1, 0, 0, 1, 0, 0)
    drawOverlay(c, j.layout, j.style, j.accent, j.meta, j.titles, j.features, i)
  }

  api.onJob(async (j) => {
    try {
      job = j
      out.width = layer.width = j.layout.W
      out.height = layer.height = j.layout.H
      const [cover, , encoder] = await Promise.all([loadCover(j.meta.cover), loadSceneFonts(), canEncode(j.layout.W, j.layout.H)])
      draw = createScene(j.layout, j.style, j.accent, { ...j.meta, cover })
      api.ready(j.id, undefined, encoder)
    } catch (e) {
      api.ready(j.id, e instanceof Error ? e.message : String(e))
    }
  })

  api.onRender(({ id, from, to }) => {
    if (!job || job.id !== id || !draw) return
    const { W, H } = job.layout
    for (let i = from; i < to; i++) {
      compose(job, ctx, i)
      const px = ctx.getImageData(0, 0, W, H).data
      api.frame(id, i, new Uint8Array(px.buffer, px.byteOffset, px.byteLength))
    }
  })

  api.onEncode(async ({ id, frames }) => {
    if (!job || job.id !== id || !draw) return api.done(id, 'No job to encode.')
    const j = job
    try {
      // a canvas without willReadFrequently stays on the GPU, which is what the encoder reads from
      const enc = document.createElement('canvas')
      enc.width = j.layout.W; enc.height = j.layout.H
      const ec = enc.getContext('2d')!
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new StreamTarget(new WritableStream<StreamTargetChunk>({ write: (c) => api.chunk(id, c.position, c.data) }), { chunked: true, chunkSize: 4 * 1024 * 1024 })
      })
      const src = new CanvasSource(enc, { codec: 'avc', quality: QUALITY_HIGH, keyFrameInterval: 2, latencyMode: 'quality' })
      output.addVideoTrack(src, { frameRate: j.features.fps })
      await output.start()
      const fps = j.features.fps
      for (let i = 0; i < frames; i++) {
        if (job !== j) { await output.cancel(); return api.done(id, 'Export cancelled.') }
        compose(j, ec, i)
        await src.add(i / fps, 1 / fps)
        if (i % 15 === 0) api.progress(id, i)
      }
      await output.finalize()
      api.done(id)
    } catch (e) {
      api.done(id, e instanceof Error ? e.message : String(e))
    }
  })
}
