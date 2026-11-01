import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { applyFix, applyFixes, disablePlugin, listDisabled, localMove, previewFix, removeIniSection, restoreDisabled, type FixDeps } from './plugin-fix'
import { removeWith } from './plugin-remove'
import { openDb } from './db'
import type { FixKind, HealthFinding } from '../shared/types'

let tmp: string
let home: string
let db: ReturnType<typeof openDb>
let execCalls: { cmd: string; args: string[] }[]
let adminCalls: { cmd: string; args: string[] }[][]
let adminFailed: number[] = []
let flRunning = false

const deps = (): FixDeps => ({
  move: async (src, dest) => localMove(src, dest),
  exec: async (cmd, args) => { execCalls.push({ cmd, args }) },
  runAdmin: async (cmds) => { adminCalls.push(cmds); return adminFailed },
  needsAdmin: () => false,
  flRunning: () => flRunning,
  removePaths: (d, plugin, paths, h) => removeWith(d, { toTrash: async () => {}, adminTrashMany: async () => {}, needsAdmin: () => false, gone: () => true }, plugin, paths, h, [])
})
const finding = (over: Partial<HealthFinding>): HealthFinding => ({ id: 1, pluginId: 1, name: 'Serum', path: '', kind: 'duplicate', severity: 'warn', certainty: 'confirmed', detail: '', fix: 'disable', ...over })

beforeAll(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-fix-'))); home = join(tmp, 'home'); db = openDb(join(tmp, 'db')) })
afterAll(() => { db.close(); rmSync(tmp, { recursive: true, force: true }) })
beforeEach(() => { execCalls = []; adminCalls = []; adminFailed = []; flRunning = false })

const mkBundle = (rel: string, body = 'binary') => {
  const p = join(home, 'Library/Audio/Plug-Ins/VST3', rel)
  mkdirSync(join(p, 'Contents'), { recursive: true })
  writeFileSync(join(p, 'Contents', 'data.bin'), body)
  return p
}

describe('disable and restore', () => {
  test('disabling moves the bundle to the Disabled folder and restoring puts it back byte for byte', async () => {
    const p = mkBundle('Round.vst3', 'ROUNDTRIP')
    await disablePlugin(db, deps(), { name: 'Round', bundles: [{ path: p, format: 'vst3' }] }, home)
    expect(existsSync(p)).toBe(false)
    const [d] = listDisabled(db).filter((x) => x.originalPath === p)
    expect(d.name).toBe('Round')
    const r = await restoreDisabled(db, deps(), [d.actionId])
    expect(r).toEqual({ restored: 1, failed: [] })
    expect(readFileSync(join(p, 'Contents/data.bin'), 'utf8')).toBe('ROUNDTRIP')
    expect(listDisabled(db).some((x) => x.originalPath === p)).toBe(false)
  })
  test('the Disabled folder is created by the user process, never by an elevated command', async () => {
    const p = mkBundle('Owner.vst3')
    const d = { ...deps(), move: async () => {}, needsAdmin: () => true }
    await disablePlugin(db, d, { name: 'Owner', bundles: [{ path: p, format: 'vst3' }] }, home)
    expect(existsSync(join(home, 'Library/Application Support/Studio HQ/Disabled Plugins/VST3'))).toBe(true)
  })
  test('restore refuses to overwrite something that now exists at the original location', async () => {
    const p = mkBundle('Clash.vst3', 'OLD')
    await disablePlugin(db, deps(), { name: 'Clash', bundles: [{ path: p, format: 'vst3' }] }, home)
    mkBundle('Clash.vst3', 'NEW')
    const [d] = listDisabled(db).filter((x) => x.originalPath === p)
    const r = await restoreDisabled(db, deps(), [d.actionId])
    expect(r.restored).toBe(0)
    expect(r.failed).toHaveLength(1)
    expect(readFileSync(join(p, 'Contents/data.bin'), 'utf8')).toBe('NEW')
  })
  test('two disabled copies with the same name do not overwrite each other', async () => {
    const a = mkBundle('Same.vst3', 'A')
    await disablePlugin(db, deps(), { name: 'Same', bundles: [{ path: a, format: 'vst3' }] }, home)
    const b = mkBundle('Same.vst3', 'B')
    await disablePlugin(db, deps(), { name: 'Same', bundles: [{ path: b, format: 'vst3' }] }, home)
    expect(readdirSync(join(home, 'Library/Application Support/Studio HQ/Disabled Plugins/VST3')).filter((n) => n.startsWith('Same'))).toHaveLength(2)
  })
})

describe('applyFix', () => {
  test('unquarantine runs xattr with the path as its own argument', async () => {
    const p = mkBundle('Quar "x" é.vst3')
    await applyFix(db, deps(), finding({ kind: 'quarantine', fix: 'unquarantine', path: p }), home)
    expect(execCalls).toEqual([{ cmd: 'xattr', args: ['-dr', 'com.apple.quarantine', p] }])
  })
  test('resign ad-hoc signs the bundle', async () => {
    const p = mkBundle('Sign.vst3')
    await applyFix(db, deps(), finding({ kind: 'signature', fix: 'resign', path: p }), home)
    expect(execCalls[0]).toEqual({ cmd: 'codesign', args: ['--force', '--deep', '--sign', '-', p] })
  })
  test('remove-bundle goes through the safe remover and is refused outside the allowlist', async () => {
    await expect(applyFix(db, deps(), finding({ kind: 'broken-bundle', fix: 'remove-bundle', path: '/System/Library/CoreServices' }), home)).rejects.toThrow(/refus|not allowed|skipped/i)
  })
  test('a fix with no action is rejected', async () => {
    await expect(applyFix(db, deps(), finding({ fix: null }), home)).rejects.toThrow()
  })
})

describe('clear-fl-entry', () => {
  const ini = '﻿[Effects/VST/Keep]\nps_name=Keep\nps_file_filename_0=/a\n\n[Effects/VST/Gone]\nps_name=Gone\nps_file_filename_0=/b\n\n[Generators/VST/Gone]\nps_name=Gone\n'
  let dbDir: string
  let file: string
  beforeEach(() => {
    dbDir = join(tmp, 'fl-db'); rmSync(dbDir, { recursive: true, force: true }); mkdirSync(dbDir, { recursive: true })
    file = join(dbDir, '.Plugins.ini'); writeFileSync(file, ini)
  })
  const f = () => finding({ pluginId: null, kind: 'stale-fl-db', fix: 'clear-fl-entry', path: 'Effects/VST/Gone', name: 'Gone' })

  test('removeIniSection drops only the named section and keeps the rest', () => {
    const out = removeIniSection(ini, 'Effects/VST/Gone')
    expect(out).toContain('[Effects/VST/Keep]')
    expect(out).toContain('[Generators/VST/Gone]')
    expect(out).not.toContain('[Effects/VST/Gone]')
    expect(out.startsWith('﻿')).toBe(true)
    expect(() => removeIniSection(ini, 'Nope')).toThrow()
  })
  test('backs up FL’s database first, then removes the entry', async () => {
    await applyFix(db, deps(), f(), home, file)
    expect(readFileSync(file, 'utf8')).not.toContain('[Effects/VST/Gone]')
    const backups = readdirSync(join(home, 'Library/Application Support/Studio HQ/FL Backups'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(home, 'Library/Application Support/Studio HQ/FL Backups', backups[0]), 'utf8')).toBe(ini)
  })
  test('a plugin file path clears every FL entry that points at it', async () => {
    writeFileSync(file, '[Effects/VST/Bad]\nps_file_filename_0=/p/Bad.vst\n\n[Generators/VST/Bad]\nps_file_filename_0=/p/Bad.vst\n\n[Effects/VST/Keep]\nps_file_filename_0=/p/Keep.vst\n')
    await applyFix(db, deps(), finding({ pluginId: null, kind: 'fl-error', fix: 'clear-fl-entry', path: '/p/Bad.vst', name: 'Bad' }), home, file)
    const out = readFileSync(file, 'utf8')
    expect(out).not.toContain('Bad.vst')
    expect(out).toContain('[Effects/VST/Keep]')
  })
  test('refuses while FL Studio is running', async () => {
    flRunning = true
    await expect(applyFix(db, deps(), f(), home, file)).rejects.toThrow(/FL Studio/)
    expect(readFileSync(file, 'utf8')).toBe(ini)
  })
  test('a failed write leaves the original file untouched', async () => {
    chmodSync(dbDir, 0o555)
    try {
      await expect(applyFix(db, deps(), f(), home, file)).rejects.toThrow()
      expect(readFileSync(file, 'utf8')).toBe(ini)
    } finally { chmodSync(dbDir, 0o755) }
  })
})

describe('applyFixes (many at once)', () => {
  test('clearing many FL entries is one backup and one write', async () => {
    const dir = join(tmp, 'fl-many'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    const file = join(dir, '.Plugins.ini')
    writeFileSync(file, ['A', 'B', 'C'].map((n) => `[Effects/VST/${n}]\nps_file_filename_0=/p/${n}.vst\n`).join('\n') + '\n[Effects/VST/Keep]\nps_file_filename_0=/p/Keep.vst\n')
    const fs = ['A', 'B', 'C'].map((n) => finding({ pluginId: null, kind: 'stale-fl-db', fix: 'clear-fl-entry', path: `/p/${n}.vst`, name: n }))
    const before = existsSync(join(home, 'Library/Application Support/Studio HQ/FL Backups')) ? readdirSync(join(home, 'Library/Application Support/Studio HQ/FL Backups')).length : 0
    const r = await applyFixes(db, deps(), fs, home, file)
    expect(r).toEqual({ applied: 3, failed: [] })
    const out = readFileSync(file, 'utf8')
    expect(out).toContain('[Effects/VST/Keep]')
    for (const n of ['A', 'B', 'C']) expect(out).not.toContain(`/p/${n}.vst`)
    expect(readdirSync(join(home, 'Library/Application Support/Studio HQ/FL Backups')).length).toBe(before + 1)
  })
  test('one failure does not stop the rest and is reported by name', async () => {
    const a = mkBundle('ManyA.vst3'); const b = mkBundle('ManyB.vst3')
    const d = { ...deps(), exec: async (_c: string, args: string[]) => { if (args.includes(a)) throw new Error('nope') } }
    const r = await applyFixes(db, d, [finding({ name: 'A', kind: 'quarantine', fix: 'unquarantine', path: a }), finding({ name: 'B', kind: 'quarantine', fix: 'unquarantine', path: b })], home)
    expect(r.applied).toBe(1)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]).toContain('A')
  })
  test('cancelling the password prompt applies nothing that needs it, and asks only once', async () => {
    const ps = ['C1', 'C2', 'C3'].map((n) => mkBundle(`${n}.vst3`))
    let asked = 0
    const d = { ...deps(), needsAdmin: () => true, runAdmin: async () => { asked++; throw new Error('User canceled. (-128)') } }
    const r = await applyFixes(db, d, ps.map((p, i) => finding({ name: `C${i}`, kind: 'signature', fix: 'resign', path: p })), home)
    expect(asked).toBe(1)
    expect(r.applied).toBe(0)
    expect(r.failed.join(' ')).toMatch(/cancel/i)
  })
  test('fixes that need administrator rights are all done in one admin call, however many plugins', async () => {
    const q = ['Q1', 'Q2', 'Q3'].map((n) => mkBundle(`${n}.vst3`))
    const dis = ['D1', 'D2'].map((n) => mkBundle(`${n}.vst3`))
    const d = { ...deps(), needsAdmin: () => true }
    const fs = [...q.map((p, i) => finding({ name: `Q${i}`, kind: 'quarantine', fix: 'unquarantine', path: p })), ...dis.map((p, i) => finding({ name: `D${i}`, kind: 'duplicate', fix: 'disable', path: p }))]
    const r = await applyFixes(db, d, fs, home)
    expect(adminCalls).toHaveLength(1)
    expect(adminCalls[0]).toHaveLength(5)
    expect(adminCalls[0].filter((c) => c.cmd === '/usr/bin/xattr')).toHaveLength(3)
    expect(adminCalls[0].filter((c) => c.cmd === '/bin/mv')).toHaveLength(2)
    expect(r).toEqual({ applied: 5, failed: [] })
    expect(execCalls).toEqual([]) // nothing ran un-elevated
  })
  test('only the operation that failed is reported, and only it is left un-logged', async () => {
    const ps = ['F1', 'F2', 'F3'].map((n) => mkBundle(`${n}.vst3`))
    adminFailed = [1]
    const d = { ...deps(), needsAdmin: () => true }
    const r = await applyFixes(db, d, ps.map((p, i) => finding({ name: `F${i + 1}`, kind: 'quarantine', fix: 'unquarantine', path: p })), home)
    expect(r.applied).toBe(2)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]).toContain('F2')
    const logged = (p: string) => db.prepare("SELECT 1 FROM plugin_actions WHERE kind = 'unquarantine' AND original_path = ?").get(p)
    expect(logged(ps[0])).toBeTruthy()
    expect(logged(ps[1])).toBeFalsy()
  })
  test('a broken bundle that needs administrator rights goes to the Trash inside the same admin call, owned by you', async () => {
    const b = mkBundle('Broken.vst3')
    const d = { ...deps(), needsAdmin: () => true }
    const r = await applyFixes(db, d, [finding({ name: 'Broken', kind: 'broken-bundle', fix: 'remove-bundle', path: b })], home)
    expect(r.applied).toBe(1)
    const cmds = adminCalls[0]
    expect(cmds[0].cmd).toBe('/bin/mv')
    expect(cmds[0].args[0]).toBe(b)
    expect(cmds[0].args[1].startsWith(join(home, '.Trash'))).toBe(true)
    expect(cmds.some((c) => c.cmd === '/usr/sbin/chown')).toBe(true)
  })
})

describe('restoring several plugins needing administrator rights', () => {
  test('is one admin call', async () => {
    const a = mkBundle('RestA.vst3'); const b = mkBundle('RestB.vst3')
    await disablePlugin(db, deps(), { name: 'RestA', bundles: [{ path: a, format: 'vst3' }] }, home)
    await disablePlugin(db, deps(), { name: 'RestB', bundles: [{ path: b, format: 'vst3' }] }, home)
    const ids = listDisabled(db).filter((x) => x.originalPath === a || x.originalPath === b).map((x) => x.actionId)
    adminCalls = []
    const r = await restoreDisabled(db, { ...deps(), needsAdmin: () => true }, ids)
    expect(adminCalls).toHaveLength(1)
    expect(adminCalls[0]).toHaveLength(2)
    expect(r.restored).toBe(2)
  })
})

describe('previews', () => {
  test.each(['disable', 'unquarantine', 'resign', 'remove-bundle', 'clear-fl-entry'] as FixKind[])('previewFix describes %s', (fix) => {
    expect(previewFix(finding({ fix, path: '/x/Y.vst3' })).length).toBeGreaterThan(10)
  })
})
