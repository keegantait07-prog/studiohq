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

/** Worth trying again: Google's own errors and rate limits. Quota and permission errors are not. */
async function retryable(res: Response): Promise<boolean> {
  if (res.status >= 500 || res.status === 429) return true
  if (res.status !== 403) return false
  try {
    const j = (await res.clone().json()) as { error?: { errors?: { reason?: string }[] } }
    return /rateLimitExceeded/i.test(j.error?.errors?.[0]?.reason ?? '')
  } catch { return false }
}

const backoff = (n: number) => Math.min(1000 * 2 ** (n - 1), 30000)

export async function uploadVideo(
  o: {
    auth: YtAuth; videoPath: string; thumbPath: string; metadata: object; chunkSize?: number
    /** a session saved by an earlier run, so a crash resumes instead of starting again */
    session?: string | null
    /** called as soon as a new session exists, before any bytes are sent */
    onSession?: (uri: string) => void
    /** called the moment YouTube has the video, before the thumbnail */
    onUploaded?: (videoId: string) => void
    wait?: (ms: number) => Promise<void>
  },
  onProgress: (pct: number) => void,
  fetchFn: typeof fetch = fetch
): Promise<{ videoId: string; studioUrl: string; thumbnailError?: string }> {
  const size = statSync(o.videoPath).size
  const chunk = o.chunkSize ?? 8 * 1024 * 1024
  const wait = o.wait ?? sleep

  const begin = async (): Promise<string> => {
    const token = await o.auth.accessToken(fetchFn)
    for (let attempt = 1; ; attempt++) {
      let init: Response | null = null
      try {
        init = await fetchFn(INIT_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
          body: JSON.stringify(o.metadata)
        })
      } catch { /* network error: try again below */ }
      if (init?.ok) {
        const uri = init.headers.get('Location')
        if (!uri) throw new Error('YouTube did not start the upload.')
        o.onSession?.(uri)
        return uri
      }
      if (init && !(await retryable(init))) throw await apiError(init)
      if (attempt >= MAX_FAILURES) throw init ? await apiError(init) : new Error('Could not reach YouTube. Check your connection and try again.')
      await wait(backoff(attempt))
    }
  }

  const got = { id: null as string | null }
  const done = async (res: Response) => { got.id = ((await res.json()) as { id: string }).id }
  const askWhere = (uri: string) => fetchFn(uri, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` } })

  let session = o.session ?? null
  let offset = 0, failures = 0, restarts = 0
  if (session) {
    try {
      const q = await askWhere(session)
      if (q.status === 200 || q.status === 201) await done(q)
      else if (q.status === 308) offset = nextOffset(q)
      else session = null // expired: sessions last about a week
    } catch { session = null }
  }
  if (!got.id && !session) session = await begin()

  const fd = openSync(o.videoPath, 'r')
  try {
    while (!got.id) {
      const end = Math.min(offset + chunk, size)
      const buf = Buffer.alloc(end - offset)
      readSync(fd, buf, 0, buf.length, offset)
      let res: Response | null = null
      try {
        res = await fetchFn(session!, { method: 'PUT', headers: { 'Content-Length': String(buf.length), 'Content-Range': `bytes ${offset}-${end - 1}/${size}` }, body: buf })
      } catch { /* network error: ask the server where it got to */ }
      if (res && (res.status === 200 || res.status === 201)) { await done(res); break }
      if (res?.status === 308) { offset = nextOffset(res); failures = 0; onProgress(Math.min(0.95, (offset / size) * 0.95)); continue }
      if ((res?.status === 404 || res?.status === 410) && restarts++ < 1) { session = await begin(); offset = 0; continue }
      if (res && !(await retryable(res))) throw await apiError(res)
      if (++failures > MAX_FAILURES) throw new Error('The upload keeps failing. Check your connection and try again.')
      await wait(backoff(failures))
      try {
        const q = await askWhere(session!)
        if (q.status === 200 || q.status === 201) await done(q)
        else if (q.status === 308) offset = nextOffset(q)
      } catch { /* the next pass counts as another failure */ }
    }
  } finally {
    closeSync(fd)
  }

  const id = got.id as string
  o.onUploaded?.(id)
  onProgress(0.97)
  let thumbnailError: string | undefined
  try {
    const token = await o.auth.accessToken(fetchFn) // a long upload can outlive the first token
    const t = await fetchFn(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}&uploadType=media`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: readFileSync(o.thumbPath)
    })
    if (!t.ok) thumbnailError = (await apiError(t)).message
  } catch (e) { thumbnailError = (e as Error).message }
  onProgress(1)
  return { videoId: id, studioUrl: `https://studio.youtube.com/video/${id}/edit`, ...(thumbnailError ? { thumbnailError } : {}) }
}
