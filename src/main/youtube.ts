// Resumable YouTube upload plus the thumbnail. The caller keeps the quota ledger.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'fs'
import type { YtAuth } from './ytauth'

const INIT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'
const MAX_FAILURES = 5
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function apiError(res: Response): Promise<Error> {
  let reason = '', message = ''
  try {
    const j = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } }
    reason = j.error?.errors?.[0]?.reason ?? ''
    message = j.error?.message ?? ''
  } catch { /* no JSON body */ }
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') return new Error("YouTube's daily upload quota is used up. Try again after midnight Pacific time.")
  if (res.status === 401) return new Error('Google sign-in expired. Sign in again.')
  return new Error(`YouTube said: ${message || res.status}`)
}

/** The first byte the server does not have yet, from a 308 response's Range header. */
const nextOffset = (res: Response): number => {
  const m = res.headers.get('Range')?.match(/bytes=0-(\d+)/)
  return m ? Number(m[1]) + 1 : 0
}

export async function uploadVideo(
  o: { auth: YtAuth; videoPath: string; thumbPath: string; metadata: object; chunkSize?: number },
  onProgress: (pct: number) => void,
  fetchFn: typeof fetch = fetch
): Promise<{ videoId: string; studioUrl: string; thumbnailError?: string }> {
  const token = await o.auth.accessToken(fetchFn)
  const size = statSync(o.videoPath).size
  const chunk = o.chunkSize ?? 8 * 1024 * 1024
  const init = await fetchFn(INIT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
    body: JSON.stringify(o.metadata)
  })
  if (!init.ok) throw await apiError(init)
  const session = init.headers.get('Location')
  if (!session) throw new Error('YouTube did not start the upload.')

  const fd = openSync(o.videoPath, 'r')
  let offset = 0, failures = 0
  const got = { id: null as string | null }
  const done = async (res: Response) => { got.id = ((await res.json()) as { id: string }).id }
  try {
    while (!got.id) {
      const end = Math.min(offset + chunk, size)
      const buf = Buffer.alloc(end - offset)
      readSync(fd, buf, 0, buf.length, offset)
      let res: Response | null = null
      try {
        res = await fetchFn(session, { method: 'PUT', headers: { 'Content-Length': String(buf.length), 'Content-Range': `bytes ${offset}-${end - 1}/${size}` }, body: buf })
      } catch { /* network error: ask the server where it got to */ }
      if (res && (res.status === 200 || res.status === 201)) { await done(res); break }
      if (res?.status === 308) { offset = nextOffset(res); failures = 0; onProgress(Math.min(0.95, (offset / size) * 0.95)); continue }
      if (res && res.status < 500) throw await apiError(res)
      if (++failures > MAX_FAILURES) throw new Error('The upload keeps failing. Check your connection and try again.')
      try {
        const q = await fetchFn(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` } })
        if (q.status === 200 || q.status === 201) await done(q)
        else if (q.status === 308) offset = nextOffset(q)
      } catch { await sleep(Math.min(1000 * failures, 5000)) }
    }
  } finally {
    closeSync(fd)
  }

  const id = got.id as string
  onProgress(0.97)
  let thumbnailError: string | undefined
  try {
    const t = await fetchFn(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}&uploadType=media`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: readFileSync(o.thumbPath)
    })
    if (!t.ok) thumbnailError = (await apiError(t)).message
  } catch (e) { thumbnailError = (e as Error).message }
  onProgress(1)
  return { videoId: id, studioUrl: `https://studio.youtube.com/video/${id}/edit`, ...(thumbnailError ? { thumbnailError } : {}) }
}
