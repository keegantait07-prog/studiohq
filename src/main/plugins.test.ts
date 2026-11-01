import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { groupBundles, listPlugins, parseBundleMeta, scanPlugins } from './plugins'
import { openDb } from './db'

const plist = (id: string, name: string, exe = name) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleName</key><string>${name}</string>
<key>CFBundleExecutable</key><string>${exe}</string>
<key>CFBundleShortVersionString</key><string>1.2.3</string>
</dict></plist>`

function bundle(dir: string, file: string, id: string, name: string) {
  const c = join(dir, file, 'Contents')
  mkdirSync(join(c, 'MacOS'), { recursive: true })
  writeFileSync(join(c, 'Info.plist'), plist(id, name))
  writeFileSync(join(c, 'MacOS', name), 'not a real binary')
}

let tmp: string
let home: string
let roots: string[]
beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-scan-')))
  home = join(tmp, 'home')
  const vst3 = join(tmp, 'VST3'); const au = join(tmp, 'Components'); const aax = join(tmp, 'AAX')
  for (const d of [vst3, au, aax]) mkdirSync(d, { recursive: true })
  bundle(vst3, 'Serum.vst3', 'com.xferrecords.Serum', 'Serum')
  bundle(au, 'Serum.component', 'com.xferrecords.Serum.au', 'Serum')
  bundle(aax, 'Serum.aaxplugin', 'com.xferrecords.Serum.aax', 'Serum')
  bundle(vst3, 'Massive.vst3', 'com.native-instruments.Massive', 'Massive')
  mkdirSync(join(vst3, 'Broken.vst3', 'Contents'), { recursive: true })
  writeFileSync(join(vst3, 'Broken.vst3', 'Contents', 'Info.plist'), 'this is not a plist')
  mkdirSync(join(vst3, 'Empty.vst3'), { recursive: true })
  roots = [vst3, au, aax]
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('parseBundleMeta', () => {
  test('reads name, bundle id and version, and derives the vendor from the bundle id', () => {
    const m = parseBundleMeta({ CFBundleName: 'Serum', CFBundleIdentifier: 'com.xferrecords.Serum', CFBundleShortVersionString: '1.3' }, '/x/Serum.vst3')
    expect(m).toEqual({ name: 'Serum', vendor: 'xferrecords', bundleId: 'com.xferrecords.Serum', version: '1.3' })
  })
  test('falls back to the file name when the plist has no name', () => {
    expect(parseBundleMeta({ CFBundleIdentifier: 'com.a.b' }, '/x/My Synth.vst3')?.name).toBe('My Synth')
  })
  test('returns null for an empty plist', () => {
    expect(parseBundleMeta({}, '/x/Nope.vst3')).toBeNull()
  })
})

describe('groupBundles', () => {
  const b = (path: string, format: any, name: string, vendor: string) => ({ path, format, size: 1, archs: [], bundleId: '', version: '', name, vendor })
  test('merges VST3, AU and AAX of the same plugin into one entry', () => {
    const g = groupBundles([b('/a.vst3', 'vst3', 'Serum', 'xfer'), b('/a.component', 'au', 'Serum', 'xfer'), b('/a.aaxplugin', 'aax', 'serum', 'xfer')])
    expect(g).toHaveLength(1)
    expect(g[0].bundles).toHaveLength(3)
  })
  test('keeps different plugins, and same-named plugins from different vendors, apart', () => {
    expect(groupBundles([b('/a', 'vst3', 'Delay', 'acme'), b('/b', 'vst3', 'Delay', 'zed'), b('/c', 'vst3', 'Massive', 'ni')])).toHaveLength(3)
  })
})

describe('scanPlugins', () => {
  test('finds, merges and persists plugins, skipping a corrupt bundle without failing', async () => {
    const db = openDb(join(tmp, 'db'))
    const found = await scanPlugins(db, home, roots)
    expect(found.map((p) => p.name).sort()).toEqual(['Massive', 'Serum'])
    const serum = found.find((p) => p.name === 'Serum')!
    expect(serum.bundles.map((x) => x.format).sort()).toEqual(['aax', 'au', 'vst3'])
    expect(serum.totalSize).toBeGreaterThan(0)
    expect(listPlugins(db).map((p) => p.name).sort()).toEqual(['Massive', 'Serum'])
    db.close()
  })
  test('a rescan after a bundle is deleted drops that plugin', async () => {
    const db = openDb(join(tmp, 'db2'))
    await scanPlugins(db, home, roots)
    rmSync(join(roots[0], 'Massive.vst3'), { recursive: true })
    const found = await scanPlugins(db, home, roots)
    expect(found.map((p) => p.name)).toEqual(['Serum'])
    expect(listPlugins(db).map((p) => p.name)).toEqual(['Serum'])
    db.close()
  })
})
