import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildAuthUrl, makePkce } from './ytAuth'

describe('makePkce', () => {
  it('makes a URL-safe verifier and its S256 challenge', () => {
    const { verifier, challenge } = makePkce()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    for (const s of [verifier, challenge]) expect(s).not.toMatch(/[=+/]/)
  })
  it('makes a fresh verifier each time', () => expect(makePkce().verifier).not.toBe(makePkce().verifier))
})

describe('buildAuthUrl', () => {
  const u = new URL(buildAuthUrl({ clientId: 'id.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:5555/cb', challenge: 'abc', state: 'st8' }))
  it('asks for upload and read access, offline, with PKCE and the state', () => {
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const scope = u.searchParams.get('scope') ?? ''
    expect(scope).toContain('https://www.googleapis.com/auth/youtube.upload')
    expect(scope).toContain('https://www.googleapis.com/auth/youtube.readonly')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBe('abc')
    expect(u.searchParams.get('state')).toBe('st8')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555/cb')
  })
})
