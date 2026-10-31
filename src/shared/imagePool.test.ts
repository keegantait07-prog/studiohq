import { describe, expect, it } from 'vitest'
import { cropTo169, dHash, hamming, isDuplicate, pickNext, unusedCount } from './imagePool'

const ramp = (f: (x: number) => number) => Uint8Array.from({ length: 72 }, (_, i) => f(i % 9))
const up = ramp((x) => x * 28)
const down = ramp((x) => 255 - x * 28)

describe('dHash', () => {
  it('is 16 hex characters and stable', () => {
    expect(dHash(up)).toMatch(/^[0-9a-f]{16}$/)
    expect(dHash(up)).toBe(dHash(up))
  })
  it('differs between a picture and its inverse', () => expect(dHash(up)).not.toBe(dHash(down)))
  it('survives a small brightness change', () => expect(hamming(dHash(up), dHash(ramp((x) => x * 28 + 3)))).toBeLessThanOrEqual(4))
  it('rejects a buffer that is not 9x8', () => expect(() => dHash(new Uint8Array(10))).toThrow())
})

describe('hamming and isDuplicate', () => {
  it('counts differing bits', () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64)
    expect(hamming('0000000000000001', '0000000000000000')).toBe(1)
  })
  it('treats a near copy as a duplicate and an unrelated picture as new', () => {
    expect(isDuplicate('0000000000000003', ['0000000000000000'])).toBe(true)
    expect(isDuplicate(dHash(down), [dHash(up)])).toBe(false)
  })
})

describe('pickNext', () => {
  const a = { path: 'a.jpg', mtime: 1, hash: dHash(up) }
  const b = { path: 'b.jpg', mtime: 2, hash: dHash(down) }
  const copyOfA = { path: 'a-copy.png', mtime: 3, hash: dHash(ramp((x) => x * 28 + 3)) }
  it('returns the oldest unused file', () => expect(pickNext([b, a], [])).toEqual({ path: 'a.jpg', hash: a.hash }))
  it('skips used pictures, including re-saved copies of them', () => {
    expect(pickNext([a, copyOfA, b], [a.hash])?.path).toBe('b.jpg')
    expect(pickNext([copyOfA], [a.hash])).toBeNull()
  })
  it('returns null when everything is used or the folder is empty', () => {
    expect(pickNext([a, b], [a.hash, b.hash])).toBeNull()
    expect(pickNext([], [])).toBeNull()
  })
  it('does not return both of two near-identical files on successive picks', () => {
    const first = pickNext([a, copyOfA], [])!
    expect(pickNext([a, copyOfA], [first.hash])).toBeNull()
  })
})

describe('unusedCount', () => {
  it('counts near-identical files in the folder once', () => {
    const a = { path: 'a', mtime: 1, hash: dHash(up) }
    const copy = { path: 'c', mtime: 2, hash: dHash(ramp((x) => x * 28 + 3)) }
    const b = { path: 'b', mtime: 3, hash: dHash(down) }
    expect(unusedCount([a, copy, b], [])).toBe(2)
    expect(unusedCount([a, copy, b], [a.hash])).toBe(1)
  })
})

describe('cropTo169', () => {
  it('trims the sides of a wide picture and the top and bottom of a tall one, centred', () => {
    expect(cropTo169(2000, 1000)).toEqual({ x: 111, y: 0, width: 1778, height: 1000 })
    expect(cropTo169(1000, 1000)).toEqual({ x: 0, y: 219, width: 1000, height: 563 })
  })
  it('leaves a 16:9 picture alone', () => expect(cropTo169(1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 }))
})
