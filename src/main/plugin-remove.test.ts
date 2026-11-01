import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isRemovable, pluginRoots } from './plugin-remove'

let home: string
beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'plug-home-')))
  mkdirSync(join(home, 'Library/Audio/Plug-Ins/VST3/X.vst3'), { recursive: true })
  mkdirSync(join(home, 'Library/Application Support/Xfer/Serum'), { recursive: true })
  mkdirSync(join(home, 'Documents'), { recursive: true })
  symlinkSync('/usr', join(home, 'Library/Application Support/evil'))
  writeFileSync(join(home, 'Library/Application Support/Xfer/note.txt'), 'x')
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('isRemovable', () => {
  test('allows plugin bundles under the user plugin folders', () => {
    expect(isRemovable(join(home, 'Library/Audio/Plug-Ins/VST3/X.vst3'), home)).toBe(true)
  })
  test('allows vendor folders in the user Application Support', () => {
    expect(isRemovable(join(home, 'Library/Application Support/Xfer/Serum'), home)).toBe(true)
  })
  test('allows system plugin folders contents', () => {
    expect(isRemovable('/Library/Audio/Plug-Ins/Components/X.component', home)).toBe(true)
  })
  test.each(['/System/Library/x', '/usr/bin/x', '/Applications/Safari.app/../Safari.app'])('refuses %s', (p) => {
    expect(isRemovable(p, home)).toBe(false)
  })
  test('refuses the roots themselves', () => {
    expect(isRemovable(join(home, 'Library/Audio/Plug-Ins/VST3'), home)).toBe(false)
    expect(isRemovable(join(home, 'Library/Application Support'), home)).toBe(false)
  })
  test('refuses ordinary user folders', () => {
    expect(isRemovable(join(home, 'Documents'), home)).toBe(false)
  })
  test('refuses a symlink that escapes an allowed root', () => {
    expect(isRemovable(join(home, 'Library/Application Support/evil'), home)).toBe(false)
    expect(isRemovable(join(home, 'Library/Application Support/evil/bin'), home)).toBe(false)
  })
  test('refuses relative paths and ".." segments', () => {
    expect(isRemovable('Library/Audio/Plug-Ins/VST3/X.vst3', home)).toBe(false)
    expect(isRemovable(join(home, 'Library/Application Support/Xfer/../../../Documents'), home)).toBe(false)
  })
  test('extra roots (sample libraries) are allowed only when passed in', () => {
    const lib = join(home, 'Documents')
    expect(isRemovable(join(lib, 'Samples'), home)).toBe(false)
    expect(isRemovable(join(lib, 'Samples'), home, [lib])).toBe(true)
  })
})

test('pluginRoots lists user and system plugin folders for every format', () => {
  const roots = pluginRoots(home)
  expect(roots).toContain('/Library/Audio/Plug-Ins/VST3')
  expect(roots).toContain(join(home, 'Library/Audio/Plug-Ins/Components'))
  expect(roots).toContain('/Library/Application Support/Avid/Audio/Plug-Ins')
})
