import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { exportKit } from './kitmaker'

let root = ''
beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'kit-')); mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'a.wav'), 'AAAA'); writeFileSync(join(root, 'src', 'b.wav'), 'BB') })
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('exportKit', () => {
  const files = () => [
    { from: join(root, 'src', 'a.wav'), folder: 'Kicks', name: 'Kick 01 @me.wav' },
    { from: join(root, 'src', 'b.wav'), folder: 'Snares', name: 'Snare 01 @me.wav' },
    { from: join(root, 'src', 'missing.wav'), folder: 'Snares', name: 'Snare 02 @me.wav' }
  ]
  test('copies under new names, keeps originals, reports failures, writes the map', async () => {
    const map = join(root, 'map.json')
    const r = await exportKit(files(), join(root, 'out'), 'My Kit', map)
    expect(r.dir).toBe(join(root, 'out', 'My Kit'))
    expect(r.copied).toBe(2)
    expect(r.failed).toEqual(['Snare 02 @me.wav'])
    expect(readFileSync(join(r.dir, 'Kicks', 'Kick 01 @me.wav'), 'utf8')).toBe('AAAA')
    expect(existsSync(join(root, 'src', 'a.wav'))).toBe(true)
    expect(JSON.parse(readFileSync(map, 'utf8')).files['Kicks/Kick 01 @me.wav']).toBe(join(root, 'src', 'a.wav'))
  })
  test('a second export never overwrites the first', async () => {
    const r = await exportKit(files(), join(root, 'out'), 'My Kit', null)
    expect(r.dir).toBe(join(root, 'out', 'My Kit 2'))
    expect(readdirSync(join(root, 'out')).sort()).toEqual(['My Kit', 'My Kit 2'])
  })
  test('a kit name cannot escape the output folder', async () => {
    const r = await exportKit(files(), join(root, 'out'), '../../evil', null)
    expect(r.dir.startsWith(join(root, 'out'))).toBe(true)
  })
})
