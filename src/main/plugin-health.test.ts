import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { attributeCrash, checkArch, checkBundle, classifyCodesign, compareFlDatabase, findDuplicates, getFinding, listFindings, parseCrashReport, parseFlPluginDb, runHealthChecks } from './plugin-health'
import { openDb } from './db'
import type { PluginBundle, PluginInfo } from '../shared/types'

const bundle = (path: string, over: Partial<PluginBundle> = {}): PluginBundle => ({ path, format: 'vst3', size: 1, archs: ['arm64'], bundleId: 'com.x.Serum', version: '1.0', ...over })
const plugin = (id: number, name: string, bundles: PluginBundle[]): PluginInfo => ({ id, name, vendor: 'x', bundles, totalSize: 1, health: 'ok' })

// Same shape as a real macOS .ips report: a JSON header line, then the JSON body.
const ips = (proc: string, framePaths: string[], extraImages: string[] = []) => {
  const images = [...framePaths, ...extraImages].map((path) => ({ path, name: path.split('/').pop() }))
  const body = { procName: proc, faultingThread: 0, threads: [{ triggered: true, id: 1, frames: framePaths.map((_, i) => ({ imageIndex: i, imageOffset: 10 })) }], usedImages: images }
  return JSON.stringify({ app_name: proc, bug_type: '309' }) + '\n' + JSON.stringify(body, null, 2)
}
const SERUM = '/Library/Audio/Plug-Ins/VST3/Serum.vst3'

describe('crash reports', () => {
  test('a plugin in the crashed thread is a confirmed cause', () => {
    const r = parseCrashReport(ips('FL Studio 2026', [`${SERUM}/Contents/MacOS/Serum`, '/usr/lib/dyld']))!
    expect(r.app).toBe('FL Studio 2026')
    expect(attributeCrash(r, [plugin(1, 'Serum', [bundle(SERUM)])])).toEqual([{ pluginId: 1, certainty: 'confirmed' }])
  })
  test('a plugin that was only loaded is a likely cause', () => {
    const r = parseCrashReport(ips('FL Studio 2026', ['/usr/lib/dyld'], [`${SERUM}/Contents/MacOS/Serum`]))!
    expect(attributeCrash(r, [plugin(1, 'Serum', [bundle(SERUM)])])).toEqual([{ pluginId: 1, certainty: 'likely' }])
  })
  test('crashes of other apps are not attributed', () => {
    const r = parseCrashReport(ips('ffmpeg', [`${SERUM}/Contents/MacOS/Serum`]))!
    expect(attributeCrash(r, [plugin(1, 'Serum', [bundle(SERUM)])])).toEqual([])
  })
  test('malformed text gives null', () => {
    expect(parseCrashReport('not a crash report')).toBeNull()
    expect(parseCrashReport('{"a":1}\n{broken')).toBeNull()
  })
})

describe('checkArch', () => {
  test('an Intel-only plugin cannot load in a native Apple Silicon FL', () => {
    const f = checkArch(plugin(1, 'Old', [bundle('/a.vst3', { archs: ['x86_64'] })]), ['arm64'])!
    expect(f.kind).toBe('arch')
    expect(f.fix).toBe('disable')
    expect(f.path).toBe('/a.vst3')
  })
  test('an Intel-only plugin that FL itself scanned fine is not reported', () => {
    expect(checkArch(plugin(1, 'Old', [bundle('/a.vst3', { archs: ['x86_64'] })]), ['arm64'], new Set(['/a.vst3']))).toBeNull()
  })
  test('AU plugins are not judged against FL’s list, which only records file paths for VST and VST3', () => {
    const p = plugin(1, 'Old', [bundle('/a.component', { format: 'au', archs: ['x86_64'] })])
    expect(checkArch(p, ['arm64'], new Set(['/other.vst3']))).toBeNull()
  })
  test('universal and unknown architectures are fine', () => {
    expect(checkArch(plugin(1, 'U', [bundle('/a.vst3', { archs: ['x86_64', 'arm64'] })]), ['arm64'])).toBeNull()
    expect(checkArch(plugin(1, 'U', [bundle('/a.vst3', { archs: [] })]), ['arm64'])).toBeNull()
  })
})

describe('findDuplicates', () => {
  test('two copies of the same format are reported, pointing at the older version', () => {
    const p = plugin(1, 'Serum', [bundle('/Library/Audio/Plug-Ins/VST3/Serum.vst3', { version: '1.3' }), bundle('/Users/k/Library/Audio/Plug-Ins/VST3/Serum.vst3', { version: '1.2' })])
    const [f] = findDuplicates([p])
    expect(f.kind).toBe('duplicate')
    expect(f.path).toBe('/Users/k/Library/Audio/Plug-Ins/VST3/Serum.vst3')
    expect(f.fix).toBe('disable')
  })
  test('different formats are not duplicates', () => {
    expect(findDuplicates([plugin(1, 'Serum', [bundle('/a.vst3'), bundle('/a.component', { format: 'au' })])])).toEqual([])
  })
})

describe('FL plugin database', () => {
  const ini = '﻿[Effects/VST3/Serum]\nps_name=Serum\nps_file_filename_0=/Library/Audio/Plug-Ins/VST3/Serum.vst3\nps_file_scanflags_0=1\n\n' +
    '[Effects/VST/Gone]\nps_name=Gone\nps_file_filename_0=/Library/Audio/Plug-Ins/VST/Gone.vst\n\n' +
    '[Effects/Fruity/Edison]\nps_file_filename_0=%FLPath%/Plugins/Fruity/Edison_x64.dylib\n\n' +
    '[Effects/AudioUnit/Au]\nps_name=Au\n'
  test('parses sections that point at real files and ignores FL-internal and AU entries', () => {
    expect(parseFlPluginDb(ini)).toEqual([
      { section: 'Effects/VST3/Serum', name: 'Serum', path: '/Library/Audio/Plug-Ins/VST3/Serum.vst3', flag: '1' },
      { section: 'Effects/VST/Gone', name: 'Gone', path: '/Library/Audio/Plug-Ins/VST/Gone.vst', flag: '' }
    ])
  })
  test('an entry whose file is gone is stale, and an installed plugin FL has never scanned is flagged', () => {
    const entries = parseFlPluginDb(ini)
    const exists = (p: string) => p.endsWith('Serum.vst3')
    const installed = [plugin(1, 'Serum', [bundle(SERUM)]), plugin(2, 'Massive', [bundle('/Library/Audio/Plug-Ins/VST3/Massive.vst3')])]
    const f = compareFlDatabase(entries, installed, exists)
    const stale = f.find((x) => x.name === 'Gone')!
    expect(stale.kind).toBe('stale-fl-db')
    expect(stale.fix).toBe('clear-fl-entry')
    expect(stale.pluginId).toBeNull()
    expect(stale.path).toBe('/Library/Audio/Plug-Ins/VST/Gone.vst')
    const unscanned = f.find((x) => x.pluginId === 2)!
    expect(unscanned.fix).toBeNull()
    expect(f.some((x) => x.pluginId === 1)).toBe(false)
  })
})

describe('FL error flag', () => {
  const ini = ['Effects', 'Generators'].map((k) => `[${k}/VST/Bad]\nps_name=Bad\nps_file_filename_0=/Library/Audio/Plug-Ins/VST/Bad.vst\nps_file_scanflags_0=2\n`).join('\n') +
    '\n[Effects/VST/Fine]\nps_name=Fine\nps_file_filename_0=/Library/Audio/Plug-Ins/VST/Fine.vst\nps_file_scanflags_0=1\n'
  test('a plugin FL marked with the error flag is one finding, even though FL lists it twice, and resets its entry', () => {
    const p = plugin(7, 'Bad', [bundle('/Library/Audio/Plug-Ins/VST/Bad.vst', { format: 'vst2' })])
    const f = compareFlDatabase(parseFlPluginDb(ini), [p], () => true).filter((x) => x.kind === 'fl-error')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ pluginId: 7, fix: 'clear-fl-entry', path: '/Library/Audio/Plug-Ins/VST/Bad.vst', severity: 'bad', certainty: 'likely' })
  })
  test('plugins FL scanned fine are not flagged', () => {
    expect(compareFlDatabase(parseFlPluginDb(ini), [plugin(8, 'Fine', [bundle('/Library/Audio/Plug-Ins/VST/Fine.vst', { format: 'vst2' })])], () => true).some((x) => x.pluginId === 8)).toBe(false)
  })
})

describe('codesign', () => {
  test('classifies verify failures', () => {
    expect(classifyCodesign('/x.vst3: code object is not signed at all')?.severity).toBe('warn')
    expect(classifyCodesign('/x.vst3: a sealed resource is missing or invalid')?.severity).toBe('bad')
    expect(classifyCodesign('')).toBeNull()
  })
  test('stray Finder metadata is not a load problem', () => {
    expect(classifyCodesign('/x.vst3: resource fork, Finder information, or similar detritus not allowed')).toBeNull()
  })
})

describe('checkBundle', () => {
  let tmp: string
  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-health-')))
    mkdirSync(join(tmp, 'NoExe.vst3/Contents'), { recursive: true })
    writeFileSync(join(tmp, 'NoExe.vst3/Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Missing</string></dict></plist>')
    mkdirSync(join(tmp, 'Quar.vst3/Contents/MacOS'), { recursive: true })
    writeFileSync(join(tmp, 'Quar.vst3/Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Quar</string></dict></plist>')
    writeFileSync(join(tmp, 'Quar.vst3/Contents/MacOS/Quar'), 'x')
    execFileSync('xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Safari;', join(tmp, 'Quar.vst3')])
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  test('a bundle whose executable is missing is broken and can be removed', async () => {
    const f = await checkBundle(bundle(join(tmp, 'NoExe.vst3')), { codesign: false })
    expect(f.find((x) => x.kind === 'broken-bundle')?.fix).toBe('remove-bundle')
  })
  test('Intel-only bundles are not signature-checked (Rosetta does not need a valid arm64 signature)', async () => {
    const f = await checkBundle(bundle(join(tmp, 'Quar.vst3'), { archs: ['x86_64'] }))
    expect(f.some((x) => x.kind === 'signature')).toBe(false)
  })
  test('a quarantined bundle is flagged with the unquarantine fix', async () => {
    const f = await checkBundle(bundle(join(tmp, 'Quar.vst3')), { codesign: false })
    expect(f.find((x) => x.kind === 'quarantine')?.fix).toBe('unquarantine')
  })
})

describe('runHealthChecks', () => {
  test('an empty Mac (no FL, no crash reports, no database) gives no findings and no error', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-run-')))
    const db = openDb(join(tmp, 'db'))
    const r = await runHealthChecks(db, join(tmp, 'home'), { appsDir: join(tmp, 'Applications') })
    expect(r).toEqual([])
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  })
})

describe('stored findings', () => {
  test('findings written by a run can be listed and fetched by id, including ones with no plugin', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-store-')))
    const db = openDb(join(tmp, 'db'))
    const flDb = join(tmp, '.Plugins.ini')
    writeFileSync(flDb, '[Effects/VST/Gone]\nps_name=Gone\nps_file_filename_0=/nowhere/Gone.vst\n')
    const ran = await runHealthChecks(db, join(tmp, 'home'), { appsDir: join(tmp, 'Applications'), flDbPath: flDb })
    expect(ran).toHaveLength(1)
    expect(listFindings(db)).toEqual(ran)
    expect(getFinding(db, ran[0].id)).toEqual(ran[0])
    expect(getFinding(db, 9999)).toBeNull()
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  })
})
