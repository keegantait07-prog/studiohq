import { describe, expect, test } from 'vitest'
import { bpmBucket, folderLabel, groupRows } from './loopGroups'

const row = (folder: string, bpm: number | null = null, key: string | null = null, id = 0) => ({ beat: { id, folder, bpm, key, mtime: 0 } })
const ROOTS = ['/Users/k/Loops']

describe('folderLabel', () => {
  test('is the path below your loop folder, with slashes made readable', () => {
    expect(folderLabel('/Users/k/Loops/Drums/Kicks', ROOTS)).toBe('Drums / Kicks')
    expect(folderLabel('/Users/k/Loops/Drums/Kicks/', ROOTS)).toBe('Drums / Kicks')
  })
  test('loops directly in the loop folder are named after that folder', () => {
    expect(folderLabel('/Users/k/Loops', ROOTS)).toBe('Loops')
    expect(folderLabel('/Users/k/Loops/', ROOTS)).toBe('Loops')
  })
  test('uses the most specific loop folder when they are nested', () => {
    expect(folderLabel('/Users/k/Loops/Packs/Trap/Hats', ['/Users/k/Loops', '/Users/k/Loops/Packs'])).toBe('Trap / Hats')
  })
  test('a folder that is not under any loop folder shows its last two parts', () => {
    expect(folderLabel('/Volumes/Drive/Samples/808s', ROOTS)).toBe('Samples / 808s')
  })
  test('does not mistake a sibling with the same prefix for a subfolder', () => {
    expect(folderLabel('/Users/k/Loops2/Kicks', ROOTS)).toBe('Loops2 / Kicks')
  })
})

describe('bpmBucket', () => {
  test('puts tempos in 20 BPM bands and unknown last', () => {
    expect(bpmBucket(75).label).toBe('Under 90 BPM')
    expect(bpmBucket(90).label).toBe('90–110 BPM')
    expect(bpmBucket(109.9).label).toBe('90–110 BPM')
    expect(bpmBucket(110).label).toBe('110–130 BPM')
    expect(bpmBucket(140).label).toBe('130–150 BPM')
    expect(bpmBucket(150).label).toBe('150+ BPM')
    expect(bpmBucket(null).label).toBe('Unknown BPM')
    expect(bpmBucket(null).order).toBeGreaterThan(bpmBucket(200).order)
  })
})

describe('groupRows', () => {
  test('by folder: one section per folder, sorted by name, rows kept in their given order', () => {
    const rows = [row('/Users/k/Loops/Melody', 0, null, 1), row('/Users/k/Loops/Drums', 0, null, 2), row('/Users/k/Loops/Melody', 0, null, 3)]
    const s = groupRows(rows, 'folder', ROOTS)
    expect(s.map((x) => x.label)).toEqual(['Drums', 'Melody'])
    expect(s[1].rows.map((r) => r.beat.id)).toEqual([1, 3])
  })
  test('folder names sort naturally ("Pack 2" before "Pack 10"), ignoring case', () => {
    const s = groupRows([row('/Users/k/Loops/Pack 10'), row('/Users/k/Loops/pack 2'), row('/Users/k/Loops/Pack 1')], 'folder', ROOTS)
    expect(s.map((x) => x.label)).toEqual(['Pack 1', 'pack 2', 'Pack 10'])
  })
  test('by bpm: bands in tempo order with unknown last', () => {
    const s = groupRows([row('/a', null), row('/a', 150), row('/a', 80), row('/a', 128)], 'bpm', ROOTS)
    expect(s.map((x) => x.label)).toEqual(['Under 90 BPM', '110–130 BPM', '150+ BPM', 'Unknown BPM'])
  })
  test('by key: one section per key, shown the way the app shows keys, no key last', () => {
    const s = groupRows([row('/a', null, null), row('/a', null, 'C# minor'), row('/a', null, 'E major'), row('/a', null, 'C# minor')], 'key', ROOTS)
    expect(s.map((x) => x.label)).toEqual(['C#m', 'E', 'No key'])
    expect(s[0].rows).toHaveLength(2)
  })
  test('none gives a single section with no label', () => {
    const s = groupRows([row('/a'), row('/b')], 'none', ROOTS)
    expect(s).toHaveLength(1)
    expect(s[0].label).toBe('')
    expect(s[0].rows).toHaveLength(2)
  })
  test('no rows gives no sections', () => {
    expect(groupRows([], 'folder', ROOTS)).toEqual([])
    expect(groupRows([], 'none', ROOTS)).toEqual([])
  })
  test('section keys are stable and distinct per grouping, so a collapsed folder stays collapsed', () => {
    const a = groupRows([row('/Users/k/Loops/Drums')], 'folder', ROOTS)[0].key
    const b = groupRows([row('/Users/k/Loops/Drums')], 'folder', ROOTS)[0].key
    expect(a).toBe(b)
    expect(groupRows([row('/a', 100)], 'bpm', ROOTS)[0].key).not.toBe(groupRows([row('/a', 100, 'C major')], 'key', ROOTS)[0].key)
  })
})
