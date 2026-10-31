// OAuth helpers for the installed-app flow (loopback redirect with PKCE). Main-process only: uses node:crypto.
import { createHash, randomBytes } from 'node:crypto'

export const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.search = new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    code_challenge: o.challenge, code_challenge_method: 'S256', state: o.state, access_type: 'offline', prompt: 'consent'
  }).toString()
  return u.toString()
}
