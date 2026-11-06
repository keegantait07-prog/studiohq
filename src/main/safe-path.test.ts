import { describe, expect, test } from 'vitest'
import { isAppUrl, isExternalUrl, isInside, isKnownPath } from './safe-path'

describe('safe-path', () => {
  test('isInside compares whole segments and resolves ..', () => {
    expect(isInside('/a/b/c.wav', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/bc/c.wav', '/a/b')).toBe(false)
    expect(isInside('/a/b/../x.wav', '/a/b')).toBe(false)
    expect(isInside('relative/x', '/a/b')).toBe(false)
    expect(isInside('/a/b/x', '')).toBe(false)
  })
  test('isKnownPath rejects non-strings and unknown folders', () => {
    expect(isKnownPath('/Users/me/Movies/x.mp4', ['/Users/me/Movies'])).toBe(true)
    expect(isKnownPath('/etc/passwd', ['/Users/me/Movies'])).toBe(false)
    expect(isKnownPath(42, ['/Users/me'])).toBe(false)
  })
  test('isExternalUrl allows only http(s) and mailto', () => {
    expect(isExternalUrl('https://example.com')).toBe(true)
    expect(isExternalUrl('mailto:a@b.c')).toBe(true)
    expect(isExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalUrl('javascript:alert(1)')).toBe(false)
  })
  test('isAppUrl pins navigation to the dev server or bundled files', () => {
    expect(isAppUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(isAppUrl('http://localhost:51730/', 'http://localhost:5173')).toBe(false)
    expect(isAppUrl('https://evil.test/', 'http://localhost:5173')).toBe(false)
    const index = 'file:///app/out/renderer/index.html'
    expect(isAppUrl(index, undefined, index)).toBe(true)
    expect(isAppUrl(index + '#/vault', undefined, index)).toBe(true)
    expect(isAppUrl('file:///Users/me/Desktop/kit/readme.html', undefined, index)).toBe(false)
    expect(isAppUrl(index, undefined)).toBe(false)
    expect(isAppUrl('https://evil.test/', undefined)).toBe(false)
  })
})
