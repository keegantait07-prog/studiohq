import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { removeBatchWith, removeWith, trashDest, uniqueTrashDests, type RemoveDeps } from './plugin-remove'
import { openDb } from './db'

let tmp: string
let home: string
let db: ReturnType<typeof openDb>
const plugin = { id: 1, name: 'Serum' }
const A = () => join(home, 'Library/Application Support/Xfer/Serum')
const B = () => join(home, 'Library/Application Support/Xfer/Serum "Beta" é')
const C = () => join(home, 'Library/Application Support/Xfer/Other')
const D = () => join(home, 'Library/Application Support/Xfer/Third')

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-rm-')))
  home = join(tmp, 'home')
  mkdirSync(join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3'), { recursive: true })
  for (const p of [A(), B(), C(), D()]) mkdirSync(p, { recursive: true })
  mkdirSync(join(home, 'Documents'), { recursive: true })
  writeFileSync(join(A(), 'a.fxp'), 'xx')
  db = openDb(join(tmp, 'db'))
})
afterAll(() => { db.close(); rmSync(tmp, { recursive: true, force: true }) })

function deps(over: Partial<RemoveDeps> = {}) {
  const calls = { trash: [] as string[], admin: [] as string[][] }
  const d: RemoveDeps = {
    toTrash: async (p: string) => { calls.trash.push(p) },
    adminTrashMany: async (ps: string[]) => { calls.admin.push(ps) },
    needsAdmin: () => false,
    gone: () => true,
    ...over
  }
  return { d, calls }
}

describe('removeWith (one plugin)', () => {
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
  test('a trash failure is reported and does not stop the others', async () => {
    const { d, calls } = deps({ toTrash: async (p: string) => { if (p === A()) throw new Error('nope'); calls.trash.push(p) } })
    const r = await removeWith(db, d, plugin, [A(), B()], home, [])
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]).toContain('nope')
    expect(calls.trash).toEqual([B()])
  })
  test('a path that is already gone is not a failure', async () => {
    const { d, calls } = deps()
    const r = await removeWith(db, d, plugin, [join(A(), 'never-there.fxp')], home, [])
    expect(calls.trash).toEqual([])
    expect(r.failed).toEqual([])
    expect(r.removed).toBe(0)
  })
  test('names with spaces, quotes and unicode reach the Trash call unchanged', async () => {
    const { d, calls } = deps()
    await removeWith(db, d, plugin, [B()], home, [])
    expect(calls.trash).toEqual([B()])
  })
})

describe('one password prompt', () => {
  test('every protected path of one plugin goes in a single admin call', async () => {
    const { d, calls } = deps({ needsAdmin: () => true })
    const r = await removeWith(db, d, plugin, [A(), B(), C()], home, [])
    expect(calls.admin).toHaveLength(1)
    expect(calls.admin[0].sort()).toEqual([A(), B(), C()].sort())
    expect(r.removed).toBe(3)
  })
  test('uninstalling several plugins is still one admin call', async () => {
    const { d, calls } = deps({ needsAdmin: () => true })
    const r = await removeBatchWith(db, d, [{ plugin: { id: 1, name: 'One' }, paths: [A(), B()] }, { plugin: { id: 2, name: 'Two' }, paths: [C()] }, { plugin: { id: 3, name: 'Three' }, paths: [D()] }], home, [])
    expect(calls.admin).toHaveLength(1)
    expect(calls.admin[0]).toHaveLength(4)
    expect(r.plugins).toBe(3)
    expect(r.removed).toBe(4)
  })
  test('user-owned files are trashed normally and only protected ones are batched', async () => {
    const { d, calls } = deps({ needsAdmin: (p: string) => p === A() || p === C() })
    const r = await removeBatchWith(db, d, [{ plugin, paths: [A(), B(), C(), D()] }], home, [])
    expect(calls.trash.sort()).toEqual([B(), D()].sort())
    expect(calls.admin).toEqual([[A(), C()].sort()].map((x) => expect.arrayContaining(x)))
    expect(r.removed).toBe(4)
  })
  test('declining the prompt skips every protected path, asks only once, and still removes the user-owned ones', async () => {
    const { d, calls } = deps({ needsAdmin: (p: string) => p === A() || p === C(), adminTrashMany: async (ps: string[]) => { calls.admin.push(ps); throw new Error('User canceled. (-128)') } })
    const r = await removeBatchWith(db, d, [{ plugin, paths: [A(), B(), C()] }], home, [])
    expect(calls.admin).toHaveLength(1)
    expect(r.declined).toBe(true)
    expect(r.skipped.sort()).toEqual([A(), C()].sort())
    expect(calls.trash).toEqual([B()])
    expect(r.removed).toBe(1)
  })
  test('an item still on disk after the admin step is reported as failed, not as removed', async () => {
    const { d } = deps({ needsAdmin: () => true, gone: (p: string) => p !== B() })
    const r = await removeBatchWith(db, d, [{ plugin, paths: [A(), B()] }], home, [])
    expect(r.removed).toBe(1)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]).toContain('Beta')
  })
  test('an error other than cancelling is a failure for those items, not a silent decline', async () => {
    const { d } = deps({ needsAdmin: () => true, adminTrashMany: async () => { throw new Error('Operation not permitted') } })
    const r = await removeBatchWith(db, d, [{ plugin, paths: [A()] }], home, [])
    expect(r.declined).toBe(false)
    expect(r.failed[0]).toContain('Operation not permitted')
  })
})

describe('trash destinations', () => {
  test('trashDest avoids overwriting something already in the Trash', () => {
    expect(trashDest('/Users/k', '/Library/X.vst3', () => false, 5)).toBe('/Users/k/.Trash/X.vst3')
    expect(trashDest('/Users/k', '/Library/X.vst3', (p: string) => p === '/Users/k/.Trash/X.vst3', 5)).toBe('/Users/k/.Trash/X 5.vst3')
  })
  test('two items with the same name in one batch get different Trash names', () => {
    const d = uniqueTrashDests('/Users/k', ['/Library/Audio/Plug-Ins/VST/Massive.vst', '/Users/k/Library/Audio/Plug-Ins/VST/Massive.vst'], () => false)
    expect(new Set(d).size).toBe(2)
    expect(d.every((x) => x.startsWith('/Users/k/.Trash/'))).toBe(true)
  })
})
