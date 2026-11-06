import { describe, expect, it, vi } from 'vitest'
import { runContentPack, type PackDeps } from './contentpack'
import type { Beat, ContentPackRequest } from '../shared/types'

const beat = { id: 1, title: 'Night', ext: 'mp3' } as Beat
const req = (o: Partial<ContentPackRequest> = {}): ContentPackRequest => ({ beatId: 1, look: 'riso', accent: '#ff0000', clipStart: 20, clipLength: 30, vertical: true, full: true, draft: true, artists: ['future'], plan: [{ platform: 'tiktok', date: 5 }, { platform: 'shorts', date: 6 }], ...o })
const deps = (o: Partial<PackDeps> = {}): PackDeps => ({
  beat: () => beat,
  render: vi.fn(async (v) => [`/out/${v.formats[0]}.mp4`]),
  videoIdOf: () => 42,
  draftBlocker: async () => null,
  prepareDraft: vi.fn(async () => ({ videoId: 99 })),
  savePost: vi.fn(() => 1),
  footer: () => 'prod. smalls',
  ...o
})

describe('content pack', () => {
  it('makes both videos, plans the posts and drafts YouTube from the full video', async () => {
    const d = deps()
    const r = await runContentPack(d, req(), () => {})
    expect(r).toEqual({ files: ['/out/vertical.mp4', '/out/horizontal.mp4'], draftVideoId: 99, planned: 2, skipped: [] })
    expect(d.render).toHaveBeenNthCalledWith(1, expect.objectContaining({ formats: ['vertical'], start: 20, length: 30, viz: 'riso', footer: 'prod. smalls' }), expect.any(Function))
    expect(d.render).toHaveBeenNthCalledWith(2, expect.objectContaining({ formats: ['horizontal'], start: 0, length: 0 }), expect.any(Function))
    expect(d.prepareDraft).toHaveBeenCalledWith(1, ['future'], expect.any(Function), 42)
    expect(d.savePost).toHaveBeenCalledWith(expect.objectContaining({ platform: 'tiktok', status: 'planned', date: 5 }))
  })

  it('keeps the videos when the draft cannot be made, and says why', async () => {
    const r = await runContentPack(deps({ draftBlocker: async () => 'Sign in to Google first.' }), req(), () => {})
    expect(r.files.length).toBe(2)
    expect(r.skipped).toEqual(['Sign in to Google first.'])
    const failed = await runContentPack(deps({ prepareDraft: async () => { throw new Error('quota') } }), req(), () => {})
    expect(failed.files.length).toBe(2)
    expect(failed.skipped[0]).toContain('quota')
  })

  it('asks for an artist rather than drafting without one', async () => {
    const d = deps()
    const r = await runContentPack(d, req({ artists: [] }), () => {})
    expect(d.prepareDraft).not.toHaveBeenCalled()
    expect(r.skipped[0]).toMatch(/artist/)
  })

  it('only plans posts when there is a clip to post', async () => {
    const d = deps()
    const r = await runContentPack(d, req({ vertical: false }), () => {})
    expect(r.planned).toBe(0)
    expect(d.savePost).not.toHaveBeenCalled()
  })

  it('a cancelled render stops the pack, and nothing is planned for a clip that failed', async () => {
    const d = deps({ render: async () => { throw new Error('Export cancelled.') } })
    await expect(runContentPack(d, req(), () => {})).rejects.toThrow('cancelled')
    expect(d.savePost).not.toHaveBeenCalled()
  })

  it('refuses a beat with no audio', async () => {
    await expect(runContentPack(deps({ beat: () => ({ ...beat, ext: 'flp' }) }), req(), () => {})).rejects.toThrow(/bounce/)
  })

  it('progress only ever moves forward through the steps', async () => {
    const seen: number[] = []
    const d = deps({ render: async (_, p) => { p({ label: 'x', pct: 0 }); p({ label: 'x', pct: 1 }); return ['/o.mp4'] } })
    await runContentPack(d, req(), (p) => seen.push(p.pct))
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(seen.at(-1)).toBe(1)
  })
})
