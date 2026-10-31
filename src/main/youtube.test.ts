import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { uploadVideo } from './youtube'
import type { YtAuth } from './ytauth'

const dir = mkdtempSync(join(tmpdir(), 'shq-yt-'))
const video = join(dir, 'v.mp4'), thumb = join(dir, 't.jpg')
writeFileSync(video, Buffer.alloc(10, 7))
writeFileSync(thumb, Buffer.alloc(5, 1))
const auth = { accessToken: async () => 'tok' } as unknown as YtAuth
const SESSION = 'https://upload.example/session/1'

interface Call { url: string; method: string; headers: Record<string, string>; len: number }

/** A fake YouTube. `failOnce` makes the nth chunk PUT throw a network error after the server has kept it. */
function fake(opts: { failOnce?: number; initStatus?: number; initReason?: string } = {}) {
  const calls: Call[] = []
  let received = 0, puts = 0, failed = false
  const f = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const len = init.body ? (init.body as Buffer).length : 0
    calls.push({ url, method: init.method ?? 'GET', headers, len })
    if (url.includes('uploadType=resumable')) {
      if (opts.initStatus) return new Response(JSON.stringify({ error: { errors: [{ reason: opts.initReason }], message: 'nope' } }), { status: opts.initStatus })
      return new Response('{}', { status: 200, headers: { Location: SESSION } })
    }
    if (url === SESSION) {
      const range = headers['Content-Range']
      if (range.startsWith('bytes */')) return received >= 10 ? new Response(JSON.stringify({ id: 'abc' }), { status: 200 }) : new Response(null, { status: 308, headers: received ? { Range: `bytes=0-${received - 1}` } : {} })
      puts++
      received += len
      if (opts.failOnce === puts && !failed) { failed = true; throw new TypeError('network down') }
      return received >= 10 ? new Response(JSON.stringify({ id: 'abc' }), { status: 200 }) : new Response(null, { status: 308, headers: { Range: `bytes=0-${received - 1}` } })
    }
    if (url.includes('thumbnails/set')) return new Response('{}', { status: 200 })
    throw new Error('unexpected ' + url)
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('uploadVideo', () => {
  it('uploads in chunks, sets the thumbnail and returns the Studio link', async () => {
    const { f, calls } = fake()
    const seen: number[] = []
    const r = await uploadVideo({ auth, videoPath: video, thumbPath: thumb, metadata: { a: 1 }, chunkSize: 4 }, (p) => seen.push(p), f)
    expect(r).toEqual({ videoId: 'abc', studioUrl: 'https://studio.youtube.com/video/abc/edit' })
    const puts = calls.filter((c) => c.url === SESSION)
    expect(puts.map((c) => c.headers['Content-Range'])).toEqual(['bytes 0-3/10', 'bytes 4-7/10', 'bytes 8-9/10'])
    expect(calls[0].headers['X-Upload-Content-Length']).toBe('10')
    expect(calls[0].headers.Authorization).toBe('Bearer tok')
    expect(calls.at(-1)!.url).toContain('thumbnails/set?videoId=abc')
    expect(seen.at(-1)).toBe(1)
  })
  it('resumes from what the server kept after a network error', async () => {
    const { f, calls } = fake({ failOnce: 2 })
    const r = await uploadVideo({ auth, videoPath: video, thumbPath: thumb, metadata: {}, chunkSize: 4 }, () => {}, f)
    expect(r.videoId).toBe('abc')
    const ranges = calls.filter((c) => c.url === SESSION).map((c) => c.headers['Content-Range'])
    expect(ranges).toContain('bytes */10')
    expect(ranges.at(-1)).toBe('bytes 8-9/10')
  })
  it('explains an exhausted daily quota in plain words', async () => {
    const { f } = fake({ initStatus: 403, initReason: 'quotaExceeded' })
    await expect(uploadVideo({ auth, videoPath: video, thumbPath: thumb, metadata: {} }, () => {}, f)).rejects.toThrow(/daily upload quota/)
  })
  it('asks to sign in again on a 401', async () => {
    const { f } = fake({ initStatus: 401 })
    await expect(uploadVideo({ auth, videoPath: video, thumbPath: thumb, metadata: {} }, () => {}, f)).rejects.toThrow(/Sign in again/)
  })
})
