import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from '../db'
import { Crm } from '../crm'
import { Sales } from '../sales'
import { Content } from '../content'
import { buildTools, type ToolDeps, type ToolDef } from './tools'
import type { Beat } from '../../shared/types'

const beat = (id: number, o: Partial<Beat> = {}): Beat => ({
  id, path: `/x/${id}.wav`, filename: `${id}.wav`, title: `Beat ${id}`, folder: '/x', ext: 'wav', size: 1, mtime: Date.now(), duration: 100,
  bpm: 140, bpmSource: 'user', bpmConfidence: 'high', key: 'Am', keySource: 'user', status: 'finished', notes: '', credits: '', groupId: id,
  versionLabel: '', projectPath: null, projectConfidence: null, missing: false, analyzed: true, hasPreview: false,
  tags: { vibe: ['dark'], genre: [], artist: [] },
  ...o
} as Beat)

let beats: Beat[] = []
let db: ReturnType<typeof openDb>
let tools: Record<string, ToolDef>
const noop = (): never => { throw new Error('not used') }

beforeAll(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'assistant-tools-')))
  const deps: ToolDeps = {
    store: { listBeats: () => beats, getBeat: (id: number) => { const b = beats.find((x) => x.id === id); return b ? { ...b, peaks: [], versions: [] } : null }, updateBeat: noop, setTags: noop } as unknown as ToolDeps['store'],
    crm: new Crm(db, () => 7, () => {}),
    sales: new Sales(db),
    content: new Content(db),
    feedback: { all: () => ({ links: [], comments: [] }) },
    yt: { status: async () => ({ signedIn: true, hasClientId: true, hasAnthropicKey: true, encryptionOk: true, imagesLeft: 3, quotaToday: 0 }), prepare: noop } as unknown as ToolDeps['yt'],
    afterWrite: () => {}
  }
  tools = Object.fromEntries(buildTools(deps).map((t) => [t.name, t]))
})

describe('read tools', () => {
  it('marks all eleven read tools as read', () => {
    const names = ['search_beats', 'get_beat', 'list_contacts', 'list_pitches', 'pitches_due', 'sales_summary', 'list_sales', 'list_posts', 'feedback_inbox', 'youtube_status', 'list_videos']
    for (const n of names) expect(tools[n]?.kind, n).toBe('read')
  })

  it('search_beats filters with the Vault syntax', async () => {
    beats = [
      beat(1, { bpm: 145 }),
      beat(2, { bpm: 120 }),
      beat(3, { bpm: 150, status: 'sold' }),
      beat(4, { bpm: 142, tags: { vibe: ['bright'], genre: [], artist: [] } })
    ]
    const r = (await tools.search_beats.run({ query: 'dark, 140+ bpm, unsold' })) as { total: number; beats: { id: number }[] }
    expect(r.beats.map((b) => b.id)).toEqual([1])
    expect(r.total).toBe(1)
  })

  it('search_beats caps at 50 rows and reports the total', async () => {
    beats = Array.from({ length: 120 }, (_, i) => beat(i + 1))
    const r = (await tools.search_beats.run({ query: 'dark' })) as { total: number; beats: unknown[] }
    expect(r.beats).toHaveLength(50)
    expect(r.total).toBe(120)
  })

  it('get_beat reports an unknown id', async () => {
    beats = [beat(1)]
    expect(await tools.get_beat.run({ id: 99 })).toEqual({ error: 'No beat with id 99' })
  })

  it('pitches_due returns exactly crm.due(), with a real due pitch', async () => {
    const crm = new Crm(db, () => 7, () => {})
    const cid = crm.saveContact({ name: 'Due Dan' })
    const pid = crm.logPitch({ contactId: cid, beatIds: [], channel: 'email', subject: 's', link: '', packId: null })
    db.prepare('UPDATE pitches SET next_followup_at=? WHERE id=?').run(Date.now() - 1000, pid)
    const due = crm.due()
    expect(due.length).toBeGreaterThanOrEqual(1)
    expect(await tools.pitches_due.run({})).toEqual(due)
  })

  it('does not leak paths or secrets', async () => {
    beats = [beat(1, { projectPath: '/secret/p.flp' })]
    const b = (await tools.get_beat.run({ id: 1 })) as Record<string, unknown>
    expect(b).not.toHaveProperty('path')
    expect(b).not.toHaveProperty('projectPath')
    expect(await tools.youtube_status.run({})).not.toHaveProperty('encryptionOk')
    db.prepare(`INSERT OR IGNORE INTO groups(id,key,name) VALUES(1,'k','g')`).run()
    db.prepare(`INSERT OR IGNORE INTO beats(id,path,filename,title,folder,ext,size,mtime,group_id,created_at) VALUES(1,'/a.wav','a.wav','A','/','wav',1,1,1,1)`).run()
    db.prepare(`INSERT INTO videos(beat_id,format,path,created_at) VALUES(1,'youtube','/secret/v.mp4',1)`).run()
    const vids = (await tools.list_videos.run({})) as Record<string, unknown>[]
    expect(vids.length).toBeGreaterThan(0)
    for (const v of vids) expect(v).not.toHaveProperty('path')
  })

  it('sales_summary sums net as price minus fee', async () => {
    db.prepare(`INSERT OR IGNORE INTO groups(id,key,name) VALUES(1,'k','g')`).run()
    db.prepare(`INSERT OR IGNORE INTO beats(id,path,filename,title,folder,ext,size,mtime,group_id,created_at) VALUES(1,'/a.wav','a.wav','A','/','wav',1,1,1,1)`).run()
    const ins = db.prepare(`INSERT INTO sales(beat_id,group_id,buyer,buyer_email,license_name,exclusive,price,fee,source,sold_at,notes,created_at) VALUES(1,1,?,?,'Lease',0,?,?,'beatstars',?,'',1)`)
    ins.run('A', '', 30, 3, 1000)
    ins.run('B', '', 50, 5, 2000)
    const r = (await tools.sales_summary.run({})) as { count: number; gross: number; net: number; recent: unknown[] }
    expect(r.count).toBe(2)
    expect(r.gross).toBe(80)
    expect(r.net).toBe(72)
    expect(r.recent).toHaveLength(2)
  })
})

describe('write tools', () => {
  let wt: Record<string, ToolDef>
  let store: { updateBeat: ReturnType<typeof vi.fn>; setTags: ReturnType<typeof vi.fn> }
  let crm: { saveContact: ReturnType<typeof vi.fn>; logPitch: ReturnType<typeof vi.fn>; logFollowup: ReturnType<typeof vi.fn> }
  let sales: { log: ReturnType<typeof vi.fn> }
  let content: { savePost: ReturnType<typeof vi.fn> }
  let yt: { prepare: ReturnType<typeof vi.fn> }
  let afterWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    beats = [beat(1, { title: 'Midnight Run' })]
    store = { updateBeat: vi.fn(), setTags: vi.fn() }
    crm = { saveContact: vi.fn(() => 5), logPitch: vi.fn(() => 9), logFollowup: vi.fn() }
    sales = { log: vi.fn(() => 3) }
    content = { savePost: vi.fn(() => 4) }
    yt = { prepare: vi.fn(async () => ({ videoId: 12, beatId: 1, artists: ['A'], previewData: 'xxx' })) }
    afterWrite = vi.fn()
    const deps = {
      store: { listBeats: () => beats, getBeat: (id: number) => { const b = beats.find((x) => x.id === id); return b ? { ...b, peaks: [], versions: [] } : null }, ...store },
      crm: { all: () => ({ contacts: [{ id: 2 }, { id: 3, name: 'Dan', role: 'manager', email: 'd@x.com', sound: 'trap', links: [{ label: 'ig', url: 'u' }], notes: 'old', followupDays: 5 }], pitches: [{ id: 7 }] }), due: () => [], ...crm },
      sales: { all: () => ({ sales: [] }), ...sales },
      content: { all: () => ({ posts: [{ id: 8 }], videos: [] }), ...content },
      feedback: { all: () => ({ links: [], comments: [] }) },
      yt: { status: async () => ({}), ...yt },
      afterWrite
    } as unknown as ToolDeps
    wt = Object.fromEntries(buildTools(deps).map((t) => [t.name, t]))
  })

  it('marks all seven as write', () => {
    for (const n of ['update_beat', 'set_tags', 'save_contact', 'log_pitch', 'log_sale', 'save_post', 'prepare_youtube_draft']) expect(wt[n]?.kind, n).toBe('write')
  })

  it('update_beat writes the patch, calls afterWrite once and describes it', async () => {
    const r = await wt.update_beat.run({ id: 1, status: 'finished' })
    expect(r).toEqual({ ok: true })
    expect(store.updateBeat).toHaveBeenCalledWith(1, { status: 'finished' })
    expect(afterWrite).toHaveBeenCalledTimes(1)
    const d = wt.update_beat.describe({ id: 1, status: 'finished' })
    expect(d).toContain('Midnight Run')
    expect(d).toContain('finished')
  })

  it('update_beat rejects a bad status and an unknown id without writing', async () => {
    expect(await wt.update_beat.run({ id: 1, status: 'done' })).toHaveProperty('error')
    expect(await wt.update_beat.run({ id: 99, status: 'sold' })).toHaveProperty('error')
    expect(store.updateBeat).not.toHaveBeenCalled()
    expect(afterWrite).not.toHaveBeenCalled()
  })

  it('set_tags merges into existing tags instead of replacing other kinds', async () => {
    beats = [beat(1, { tags: { vibe: ['dark'], genre: ['trap'], artist: ['X'] } })]
    await wt.set_tags.run({ id: 1, tags: { vibe: ['sad'] } })
    expect(store.setTags).toHaveBeenCalledWith(1, { vibe: ['dark', 'sad'], genre: ['trap'], artist: ['X'] })
    expect(afterWrite).toHaveBeenCalledTimes(1)
  })

  it('set_tags merges { vibe: [dark] } without duplicating', async () => {
    await wt.set_tags.run({ id: 1, tags: { vibe: ['dark'] } })
    expect(store.setTags).toHaveBeenCalledWith(1, { vibe: ['dark'], genre: [], artist: [] })
  })

  it('set_tags rejects unknown kinds and unknown beats', async () => {
    expect(await wt.set_tags.run({ id: 1, tags: { mood: ['x'] } })).toHaveProperty('error')
    expect(await wt.set_tags.run({ id: 99, tags: { vibe: ['x'] } })).toHaveProperty('error')
    expect(store.setTags).not.toHaveBeenCalled()
    expect(afterWrite).not.toHaveBeenCalled()
  })

  it('save_contact saves and validates the role', async () => {
    expect(await wt.save_contact.run({ name: 'Dan', role: 'manager', email: 'd@x.com' })).toEqual({ ok: true, id: 5 })
    expect(crm.saveContact).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dan', role: 'manager', email: 'd@x.com' }))
    expect(afterWrite).toHaveBeenCalledTimes(1)
    expect(await wt.save_contact.run({ name: 'Dan', role: 'boss' })).toHaveProperty('error')
    expect(await wt.save_contact.run({ name: '  ' })).toHaveProperty('error')
    expect(crm.saveContact).toHaveBeenCalledTimes(1)
  })

  it('save_contact partial update keeps omitted fields', async () => {
    expect(await wt.save_contact.run({ id: 3, name: 'Dan', notes: 'x' })).toEqual({ ok: true, id: 5 })
    expect(crm.saveContact).toHaveBeenCalledWith({ id: 3, name: 'Dan', role: 'manager', email: 'd@x.com', sound: 'trap', notes: 'x', followupDays: 5, links: [{ label: 'ig', url: 'u' }] })
    expect(afterWrite).toHaveBeenCalledTimes(1)
  })

  it('save_contact with an unknown id errors and writes nothing', async () => {
    expect(await wt.save_contact.run({ id: 99, name: 'Zed' })).toEqual({ error: 'No contact with id 99' })
    expect(crm.saveContact).not.toHaveBeenCalled()
    expect(afterWrite).not.toHaveBeenCalled()
  })

  it('save_post with an unknown id errors and writes nothing', async () => {
    expect(await wt.save_post.run({ id: 99, beatId: 1, platform: 'tiktok', status: 'planned' })).toEqual({ error: 'No post with id 99' })
    expect(content.savePost).not.toHaveBeenCalled()
    expect(afterWrite).not.toHaveBeenCalled()
    expect(await wt.save_post.run({ id: 8, beatId: 1, platform: 'tiktok', status: 'posted' })).toEqual({ ok: true, postId: 4 })
  })

  it('log_pitch logs a new pitch', async () => {
    const r = await wt.log_pitch.run({ contactId: 2, beatIds: [1], subject: 'Hi' })
    expect(r).toEqual({ ok: true, pitchId: 9 })
    expect(crm.logPitch).toHaveBeenCalledWith({ contactId: 2, beatIds: [1], channel: 'email', subject: 'Hi', link: '', packId: null })
    expect(crm.logFollowup).not.toHaveBeenCalled()
    expect(afterWrite).toHaveBeenCalledTimes(1)
  })

  it('log_pitch with followUpPitchId calls logFollowup, not logPitch', async () => {
    const r = await wt.log_pitch.run({ followUpPitchId: 7 })
    expect(r).toEqual({ ok: true, pitchId: 7 })
    expect(crm.logFollowup).toHaveBeenCalledWith(7)
    expect(crm.logPitch).not.toHaveBeenCalled()
    expect(afterWrite).toHaveBeenCalledTimes(1)
  })

  it('log_pitch returns an error when the CRM refuses (nothing reported written)', async () => {
    crm.logPitch.mockImplementation(() => { throw new Error('Already sold: X.') })
    expect(await wt.log_pitch.run({ contactId: 2, beatIds: [1] })).toEqual({ error: 'Already sold: X.' })
    expect(afterWrite).not.toHaveBeenCalled()
  })

  it('log_sale fills defaults', async () => {
    const before = Date.now()
    const r = await wt.log_sale.run({ beatId: 1, buyer: 'Sam', price: 50 })
    expect(r).toEqual({ ok: true, saleId: 3 })
    const arg = sales.log.mock.calls[0][0]
    expect(arg).toMatchObject({ beatId: 1, buyer: 'Sam', price: 50, fee: 0, source: 'other', exclusive: false, contactId: null, licenseId: null })
    expect(arg.soldAt).toBeGreaterThanOrEqual(before)
    expect(arg.soldAt).toBeLessThanOrEqual(Date.now())
    expect(afterWrite).toHaveBeenCalledTimes(1)
  })

  it('log_sale rejects a bad source and surfaces Sales errors', async () => {
    expect(await wt.log_sale.run({ beatId: 1, buyer: 'Sam', price: 50, source: 'bitcoin' })).toHaveProperty('error')
    expect(sales.log).not.toHaveBeenCalled()
    sales.log.mockImplementation(() => { throw new Error('Enter who bought it.') })
    expect(await wt.log_sale.run({ beatId: 1, buyer: '', price: 50 })).toEqual({ error: 'Enter who bought it.' })
    expect(afterWrite).not.toHaveBeenCalled()
  })

  it('save_post validates platform and status', async () => {
    expect(await wt.save_post.run({ beatId: 1, platform: 'myspace', status: 'planned' })).toHaveProperty('error')
    expect(await wt.save_post.run({ beatId: 1, platform: 'tiktok', status: 'maybe' })).toHaveProperty('error')
    expect(await wt.save_post.run({ beatId: 99, platform: 'tiktok', status: 'planned' })).toHaveProperty('error')
    expect(content.savePost).not.toHaveBeenCalled()
    const r = await wt.save_post.run({ beatId: 1, platform: 'tiktok', status: 'planned', date: 1000, caption: 'c' })
    expect(r).toEqual({ ok: true, postId: 4 })
    expect(content.savePost).toHaveBeenCalledWith(expect.objectContaining({ beatId: 1, platform: 'tiktok', status: 'planned', date: 1000, caption: 'c' }))
    expect(afterWrite).toHaveBeenCalledTimes(1)
  })

  it('prepare_youtube_draft only calls yt.prepare(beatId, artists ?? [], noop)', async () => {
    const r = (await wt.prepare_youtube_draft.run({ beatId: 1 })) as Record<string, unknown>
    expect(yt.prepare).toHaveBeenCalledWith(1, [], expect.any(Function))
    expect(r).toMatchObject({ ok: true, videoId: 12 })
    expect(r).not.toHaveProperty('previewData')
    expect(afterWrite).toHaveBeenCalledTimes(1)
    await wt.prepare_youtube_draft.run({ beatId: 1, artists: ['A'] })
    expect(yt.prepare).toHaveBeenLastCalledWith(1, ['A'], expect.any(Function))
    expect(Object.keys(yt)).toEqual(['prepare'])
  })

  it('every write tool has a plain-text describe', () => {
    const samples: Record<string, Record<string, unknown>> = {
      update_beat: { id: 1, status: 'sold' }, set_tags: { id: 1, tags: { vibe: ['x'] } }, save_contact: { name: 'Dan' }, log_pitch: { contactId: 1, beatIds: [1] },
      log_sale: { beatId: 1, buyer: 'Sam', price: 5 }, save_post: { beatId: 1, platform: 'tiktok', status: 'planned' }, prepare_youtube_draft: { beatId: 1 }
    }
    for (const [n, a] of Object.entries(samples)) expect(typeof wt[n].describe(a), n).toBe('string')
  })
})
