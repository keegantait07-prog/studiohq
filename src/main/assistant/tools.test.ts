import { describe, it, expect, beforeAll } from 'vitest'
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

  it('pitches_due returns crm.due()', async () => {
    expect(await tools.pitches_due.run({})).toEqual([])
  })

  it('sales_summary sums net as price minus fee', async () => {
    db.prepare(`INSERT INTO groups(id,key,name) VALUES(1,'k','g')`).run()
    db.prepare(`INSERT INTO beats(id,path,filename,title,folder,ext,size,mtime,group_id,created_at) VALUES(1,'/a.wav','a.wav','A','/','wav',1,1,1,1)`).run()
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
