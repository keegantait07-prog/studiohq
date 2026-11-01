import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { adminTrashArgs, removeWith, trashDest, type RemoveDeps } from './plugin-remove'
import { openDb } from './db'

let tmp: string
let home: string
let db: ReturnType<typeof openDb>
const plugin = { id: 1, name: 'Serum' }

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-rm-')))
  home = join(tmp, 'home')
  mkdirSync(join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3'), { recursive: true })
  mkdirSync(join(home, 'Library/Application Support/Xfer/Serum'), { recursive: true })
  mkdirSync(join(home, 'Library/Application Support/Xfer/Serum "Beta" é'), { recursive: true })
  mkdirSync(join(home, 'Documents'), { recursive: true })
  writeFileSync(join(home, 'Library/Application Support/Xfer/Serum/a.fxp'), 'xx')
  db = openDb(join(tmp, 'db'))
})
afterAll(() => { db.close(); rmSync(tmp, { recursive: true, force: true }) })

function deps(over: Partial<RemoveDeps> = {}) {
  const calls = { trash: [] as string[], admin: [] as string[] }
  const d: RemoveDeps = {
    toTrash: async (p: string) => { calls.trash.push(p) },
    adminTrash: async (p) => { calls.admin.push(p) },
    needsAdmin: () => false,
    ...over
  }
  return { d, calls }
}

describe('removeWith', () => {
  test('moves allowed paths to the Trash and logs each removal', async () => {
    const { d, calls } = deps()
    const bundle = join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3')
    const r = await removeWith(db, d, plugin, [bundle], home, [])
    expect(calls.trash).toEqual([bundle])
    expect(r.removed).toBe(1)
    expect(r.skipped).toEqual([])
    const row = db.prepare("SELECT * FROM plugin_actions WHERE kind = 'remove' AND original_path = ?").get(bundle) as any
    expect(row.plugin_name).toBe('Serum')
  })
  test('refuses paths outside the allowlist without touching them', async () => {
    const { d, calls } = deps()
    const r = await removeWith(db, d, plugin, ['/System/Library/CoreServices', join(home, 'Documents')], home, [])
    expect(calls.trash).toEqual([])
    expect(calls.admin).toEqual([])
    expect(r.skipped).toHaveLength(2)
    expect(r.removed).toBe(0)
  })
  test('protected paths go through the admin prompt', async () => {
    const protectedPath = join(home, 'Library/Application Support/Xfer/Serum')
    const { d, calls } = deps({ needsAdmin: (p: string) => p === protectedPath })
    await removeWith(db, d, plugin, [protectedPath], home, [])
    expect(calls.admin).toEqual([protectedPath])
    expect(calls.trash).toEqual([])
  })
  test('declining the admin prompt skips that path but still removes the rest', async () => {
    const protectedPath = join(home, 'Library/Application Support/Xfer/Serum')
    const normal = join(home, 'Library/Application Support/Xfer/Serum "Beta" é')
    const { d, calls } = deps({ needsAdmin: (p: string) => p === protectedPath, adminTrash: async () => { throw new Error('User canceled. (-128)') } })
    const r = await removeWith(db, d, plugin, [protectedPath, normal], home, [])
    expect(r.skipped).toEqual([protectedPath])
    expect(calls.trash).toEqual([normal])
    expect(r.removed).toBe(1)
  })
  test('a Trash failure is reported as failed and does not stop the others', async () => {
    const a = join(home, 'Library/Application Support/Xfer/Serum')
    const b = join(home, 'Library/Application Support/Xfer/Serum "Beta" é')
    const { d, calls } = deps({ toTrash: async (p: string) => { if (p === a) throw new Error('nope'); calls.trash.push(p) } })
    const r = await removeWith(db, d, plugin, [a, b], home, [])
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]).toContain('nope')
    expect(calls.trash).toEqual([b])
  })
})

describe('removeWith robustness', () => {
  test('declining the admin prompt once does not prompt again for the remaining protected paths', async () => {
    const a = join(home, 'Library/Application Support/Xfer/Serum')
    const b = join(home, 'Library/Application Support/Xfer/Serum "Beta" é')
    const { d, calls } = deps({ needsAdmin: () => true, adminTrash: async (p: string) => { calls.admin.push(p); throw new Error('User canceled. (-128)') } })
    const r = await removeWith(db, d, plugin, [a, b], home, [])
    expect(calls.admin).toHaveLength(1)
    expect(r.skipped.sort()).toEqual([a, b].sort())
    expect(r.declined).toBe(true)
  })
  test('a path that is already gone (its folder was trashed earlier in the same batch) is not a failure', async () => {
    const gone = join(home, 'Library/Application Support/Xfer/Serum/never-there.fxp')
    const { d, calls } = deps()
    const r = await removeWith(db, d, plugin, [gone], home, [])
    expect(calls.trash).toEqual([])
    expect(r.failed).toEqual([])
    expect(r.removed).toBe(0)
  })
})

describe('admin trash helpers', () => {
  test('paths with spaces, quotes and unicode reach osascript as untouched arguments', () => {
    const src = '/Library/Audio/Plug-Ins/VST3/Soundtoys 5 "Beta" é.vst3'
    const args = adminTrashArgs(src, '/Users/k/.Trash/Soundtoys 5 "Beta" é.vst3')
    expect(args.slice(-2)).toEqual([src, '/Users/k/.Trash/Soundtoys 5 "Beta" é.vst3'])
    expect(args.slice(0, -2).join('\n')).not.toContain('Beta')
  })
  test('trashDest avoids overwriting something already in the Trash', () => {
    expect(trashDest('/Users/k', '/Library/X.vst3', () => false, 5)).toBe('/Users/k/.Trash/X.vst3')
    expect(trashDest('/Users/k', '/Library/X.vst3', (p: string) => p === '/Users/k/.Trash/X.vst3', 5)).toBe('/Users/k/.Trash/X 5.vst3')
  })
})
