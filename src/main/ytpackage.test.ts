import { describe, expect, it } from 'vitest'
import { packageBeat } from './ytpackage'
import { buildStyleProfile } from '../shared/styleProfile'
import { LINK_PLACEHOLDER, type BeatProfile } from '../shared/ytTypes'

const beat: BeatProfile = { title: 'Night Shift', bpm: 140, key: 'C# minor', genre: ['trap'], vibe: ['dark'], artist: ['future'], energy: 'high' }
const style = buildStyleProfile([], 'global')
const okBody = JSON.stringify({ titles: ['One Type Beat', 'Two Type Beat', 'Three Type Beat'], description: `Buy: ${LINK_PLACEHOLDER}`, tags: ['future type beat'], hashtags: ['#typebeat'] })
const reply = (text: string) => async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 })
const run = (apiKey: string | null, f: typeof fetch) => packageBeat({ beat, style, producer: 'Smalls', apiKey, year: 2026 }, f)

describe('packageBeat', () => {
  it('returns Claude\'s package when it is valid', async () => {
    const p = await run('k', reply(okBody) as typeof fetch)
    expect(p.source).toBe('claude')
    expect(p.titles[0]).toBe('One Type Beat')
  })
  it('sends the key, model and version headers', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    await run('secret', (async (url: string, init: RequestInit) => { seen = { url, init }; return reply(okBody)() }) as unknown as typeof fetch)
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages')
    const h = seen!.init.headers as Record<string, string>
    expect(h['x-api-key']).toBe('secret')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(JSON.parse(seen!.init.body as string).model).toBe('claude-sonnet-5-5')
  })
  it('retries once with the problems, then accepts a fixed answer', async () => {
    let calls = 0
    const f = (async (_u: string, init: RequestInit) => {
      calls++
      if (calls === 2) expect(JSON.parse(init.body as string).messages.at(-1).content).toContain('placeholder')
      return reply(calls === 1 ? JSON.stringify({ titles: ['a', 'b', 'c'], description: 'no link', tags: [], hashtags: [] }) : okBody)()
    }) as unknown as typeof fetch
    const p = await run('k', f)
    expect(calls).toBe(2)
    expect(p.source).toBe('claude')
  })
  it('falls back to templates after two bad answers', async () => {
    let calls = 0
    const p = await run('k', (async () => { calls++; return reply('Sure! Here are some titles')() }) as unknown as typeof fetch)
    expect(calls).toBe(2)
    expect(p.source).toBe('template')
    expect(p.description).toContain(LINK_PLACEHOLDER)
  })
  it('falls back without calling out when there is no key, and when the API errors', async () => {
    let calls = 0
    const never = (async () => { calls++; return reply(okBody)() }) as unknown as typeof fetch
    expect((await run(null, never)).source).toBe('template')
    expect(calls).toBe(0)
    expect((await run('k', (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch)).source).toBe('template')
  })

  it('shapes the template fallback with the researched style when there is no key', async () => {
    const vids = Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, channelId: 'c', channelTitle: 'C', title: `[FREE] Future Type Beat 2026 - "N${i}" | Dark Trap`, description: 'Buy: https://beatstars.com/x\n#typebeat', tags: ['future type beat'], publishedAt: '2026-10-01T00:00:00Z', views: 1 }))
    const p = await packageBeat({ beat, style: buildStyleProfile(vids, 'future'), producer: 'Smalls', apiKey: null, year: 2026 }, (async () => reply(okBody)()) as unknown as typeof fetch)
    expect(p.source).toBe('template')
    expect(p.titles.every((t) => t.startsWith('[FREE] '))).toBe(true)
  })
})
