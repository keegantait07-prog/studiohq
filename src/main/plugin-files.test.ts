import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { collapseCovered, findPluginFiles, matchConfidence, parseReceiptFiles } from './plugin-files'
import type { PluginInfo } from '../shared/types'

const serum = { name: 'Serum', vendor: 'xferrecords', bundleIds: ['com.xferrecords.Serum', 'com.xferrecords.Serum.au'] }
const delay = { name: 'Delay', vendor: 'acme', bundleIds: ['com.acme.Delay'] }

describe('matchConfidence', () => {
  test('product name match is likely', () => {
    expect(matchConfidence(serum, 'Serum')).toBe('likely')
    expect(matchConfidence(serum, 'Serum Presets.fxp')).toBe('likely')
  })
  test('bundle id inside a file name is likely', () => {
    expect(matchConfidence(serum, 'com.xferrecords.Serum.plist')).toBe('likely')
    expect(matchConfidence(serum, 'com.xferrecords.Serum.savedState')).toBe('likely')
  })
  test('a different product that merely starts with the same letters does not match', () => {
    expect(matchConfidence(serum, 'Serum2')).toBeNull()
    expect(matchConfidence(serum, 'Serumania')).toBeNull()
  })
  test('vendor-only match is maybe', () => {
    expect(matchConfidence(serum, 'Xfer')).toBe('maybe')
    expect(matchConfidence(serum, 'xferrecords')).toBe('maybe')
  })
  test('a generic product name never matches on its own', () => {
    expect(matchConfidence(delay, 'Delay')).toBeNull()
    expect(matchConfidence({ name: 'Pro', vendor: 'acme', bundleIds: [] }, 'Pro')).toBeNull()
    expect(matchConfidence({ name: 'Free', vendor: 'acme', bundleIds: [] }, 'Free Reverb')).toBeNull()
  })
  test('a generic product name matches together with its vendor', () => {
    expect(matchConfidence(delay, 'Acme Delay')).toBe('likely')
    expect(matchConfidence(delay, 'acme')).toBe('maybe')
  })
  test('unrelated names do not match', () => {
    expect(matchConfidence(serum, 'Spotify')).toBeNull()
  })
})

describe('parseReceiptFiles', () => {
  test('joins relative receipt paths to the install location', () => {
    expect(parseReceiptFiles('Library/Audio/Plug-Ins/VST3/Serum.vst3\nLibrary/Application Support/Xfer/Serum\n', '/'))
      .toEqual(['/Library/Audio/Plug-Ins/VST3/Serum.vst3', '/Library/Application Support/Xfer/Serum'])
    expect(parseReceiptFiles('Serum.app/Contents/Info.plist', '/Applications')).toEqual(['/Applications/Serum.app/Contents/Info.plist'])
  })
  test('drops blanks, "." and traversal', () => {
    expect(parseReceiptFiles('\n.\n../../etc/passwd\nok/file\n', '/Library')).toEqual(['/Library/ok/file'])
  })
})

describe('collapseCovered', () => {
  let tmp: string
  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-collapse-')))
    mkdirSync(join(tmp, 'Vendor/Serum/Presets'), { recursive: true })
    writeFileSync(join(tmp, 'Vendor/Serum/Presets/a.fxp'), 'x')
    writeFileSync(join(tmp, 'Vendor/Serum/lic.txt'), 'x')
    mkdirSync(join(tmp, 'Shared'), { recursive: true })
    writeFileSync(join(tmp, 'Shared/mine.dat'), 'x')
    writeFileSync(join(tmp, 'Shared/someone-elses.dat'), 'x')
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  test('a folder whose contents are all in the receipt collapses to one item', () => {
    const all = [join(tmp, 'Vendor'), join(tmp, 'Vendor/Serum'), join(tmp, 'Vendor/Serum/Presets'), join(tmp, 'Vendor/Serum/Presets/a.fxp'), join(tmp, 'Vendor/Serum/lic.txt')]
    expect(collapseCovered(all)).toEqual([join(tmp, 'Vendor')])
  })
  test('a shared folder with files the receipt does not list is not taken whole', () => {
    expect(collapseCovered([join(tmp, 'Shared'), join(tmp, 'Shared/mine.dat')])).toEqual([join(tmp, 'Shared/mine.dat')])
  })
})

describe('findPluginFiles', () => {
  let tmp: string
  let home: string
  const plugin = (p: typeof serum, bundlePath: string): PluginInfo => ({
    id: 1, name: p.name, vendor: p.vendor, totalSize: 1, health: 'ok',
    bundles: [{ path: bundlePath, format: 'vst3', size: 1, archs: [], bundleId: p.bundleIds[0], version: '1' }]
  })
  const none = { receipts: async () => [] as string[], systemRoots: [] as string[] }

  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'plug-find-')))
    home = join(tmp, 'home')
    const lib = join(home, 'Library')
    mkdirSync(join(lib, 'Audio/Plug-Ins/VST3/Serum.vst3/Contents'), { recursive: true })
    mkdirSync(join(lib, 'Audio/Plug-Ins/VST3/Other.vst3/Contents'), { recursive: true })
    mkdirSync(join(lib, 'Application Support/Xfer/Serum'), { recursive: true })
    mkdirSync(join(lib, 'Application Support/Xfer/Endless'), { recursive: true })
    writeFileSync(join(lib, 'Application Support/Xfer/Serum/a.fxp'), 'xx')
    mkdirSync(join(lib, 'Preferences'), { recursive: true })
    writeFileSync(join(lib, 'Preferences/com.xferrecords.Serum.plist'), 'x')
    mkdirSync(join(lib, 'Caches/Delay'), { recursive: true })
    mkdirSync(join(lib, 'Application Support/Spotify'), { recursive: true })
    mkdirSync(join(home, 'Documents/Serum'), { recursive: true })
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  test('includes the plugin bundle as exact and finds support files with their confidence', async () => {
    const files = await findPluginFiles(plugin(serum, join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3')), home, [], none)
    const by = (suffix: string) => files.find((f) => f.path.endsWith(suffix))
    expect(by('VST3/Serum.vst3')?.confidence).toBe('exact')
    expect(by('Xfer/Serum')?.confidence).toBe('likely')
    expect(by('com.xferrecords.Serum.plist')?.confidence).toBe('likely')
  })
  test('does not take another plugin, an unrelated app, or the vendor folder that only holds other products', async () => {
    const files = await findPluginFiles(plugin(serum, join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3')), home, [], none)
    const paths = files.map((f) => f.path)
    expect(paths.some((p) => p.includes('Other.vst3'))).toBe(false)
    expect(paths.some((p) => p.includes('Spotify'))).toBe(false)
    expect(paths.some((p) => p.endsWith('Application Support/Xfer'))).toBe(false)
    expect(paths.some((p) => p.includes('Endless'))).toBe(false)
  })
  test('matches in the user Documents folder are capped at maybe', async () => {
    const files = await findPluginFiles(plugin(serum, join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3')), home, [], none)
    expect(files.find((f) => f.path.endsWith('Documents/Serum'))?.confidence).toBe('maybe')
  })
  test('a generic-named plugin does not pull in other files of the same name', async () => {
    const files = await findPluginFiles(plugin(delay as any, join(home, 'Library/Audio/Plug-Ins/VST3/Delay.vst3')), home, [], none)
    expect(files.some((f) => f.path.includes('Caches/Delay'))).toBe(false)
  })
  test('receipt files are exact, but other plugins bundles from a shared installer are left out', async () => {
    const mine = join(home, 'Library/Application Support/Xfer/Serum/a.fxp')
    const otherBundle = join(home, 'Library/Audio/Plug-Ins/VST3/Other.vst3')
    const files = await findPluginFiles(plugin(serum, join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3')), home, [], {
      receipts: async () => [mine, otherBundle], systemRoots: []
    })
    expect(files.find((f) => f.path === mine)?.confidence).toBe('exact')
    expect(files.some((f) => f.path === otherBundle)).toBe(false)
  })
  test('receipt items that do not mention the plugin (shared vendor content) are only maybe', async () => {
    const shared = join(home, 'Library/Application Support/Xfer/Shared Content')
    mkdirSync(shared, { recursive: true }); writeFileSync(join(shared, 's.dat'), 'x')
    const files = await findPluginFiles(plugin(serum, join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3')), home, [], { receipts: async () => [shared, join(shared, 's.dat')], systemRoots: [] })
    expect(files.find((f) => f.path === shared)?.confidence).toBe('maybe')
  })
  test('a vendor-only name match on a loose file (a preferences plist) is ignored', async () => {
    writeFileSync(join(home, 'Library/Preferences/com.xferrecords.Other.plist'), 'x')
    const files = await findPluginFiles(plugin(serum, join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3')), home, [], none)
    expect(files.some((f) => f.path.endsWith('Other.plist'))).toBe(false)
  })
  test('nested matches collapse into the outermost folder', async () => {
    const files = await findPluginFiles(plugin(serum, join(home, 'Library/Audio/Plug-Ins/VST3/Serum.vst3')), home, [], none)
    expect(files.some((f) => f.path.endsWith('Xfer/Serum/a.fxp'))).toBe(false)
  })
})
