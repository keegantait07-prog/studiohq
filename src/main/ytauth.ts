import type Database from 'better-sqlite3'
import { shell } from 'electron'
import { createServer } from 'http'
import { randomBytes } from 'crypto'
import { buildAuthUrl, makePkce } from '../shared/ytAuth'
import { getKv, getSecret, setKv, setSecret } from './ytkv'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REFRESH = 'yt_refresh_token'
const SECRET = 'yt_client_secret'

export class YtAuth {
  private access: { token: string; expires: number } | null = null

  constructor(private db: Database.Database, private clientId: () => string) {}

  status(): { signedIn: boolean; hasClientId: boolean } {
    return { signedIn: !!getKv(this.db, REFRESH), hasClientId: !!this.clientId().trim() }
  }
  hasSecret(): boolean { return !!getKv(this.db, SECRET) }
  setClientSecret(s: string | null): void { setSecret(this.db, SECRET, s) }
  signOut(): void { setKv(this.db, REFRESH, null); this.access = null }

  private async token(body: Record<string, string>, fetchFn: typeof fetch): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
    const secret = getSecret(this.db, SECRET)
    const res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId().trim(), ...(secret ? { client_secret: secret } : {}), ...body })
    })
    const j = (await res.json()) as { error?: string; error_description?: string; access_token: string; expires_in: number; refresh_token?: string }
    if (!res.ok) {
      if (j.error === 'invalid_grant') { this.signOut(); throw new Error('Google sign-in expired. Sign in again.') }
      throw new Error(`Google sign-in failed: ${j.error_description ?? j.error ?? res.status}`)
    }
    return j
  }

  /** Opens the browser for Google's consent page and waits for the redirect to a one-off local server. */
  async signIn(fetchFn: typeof fetch = fetch): Promise<void> {
    if (!this.clientId().trim()) throw new Error('Add your Google client ID in Settings first.')
    const { verifier, challenge } = makePkce()
    const state = randomBytes(16).toString('base64url')
    const server = createServer()
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
    const port = (server.address() as { port: number }).port
    const redirectUri = `http://127.0.0.1:${port}/cb`
    try {
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Sign-in timed out after 3 minutes.')), 180_000)
        server.on('request', (req, res) => {
          const u = new URL(req.url ?? '/', redirectUri)
          if (u.pathname !== '/cb') { res.writeHead(404).end(); return }
          const err = u.searchParams.get('error')
          const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code')
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<body style="font:16px system-ui;padding:3em">${ok ? 'Signed in. You can close this tab and go back to Studio HQ.' : 'Sign-in was not completed. Go back to Studio HQ and try again.'}</body>`)
          clearTimeout(timer)
          if (ok) resolve(u.searchParams.get('code') as string)
          else reject(new Error(err ? `Google said: ${err}` : 'Sign-in did not match this request.'))
        })
        void shell.openExternal(buildAuthUrl({ clientId: this.clientId().trim(), redirectUri, challenge, state }))
      })
      const t = await this.token({ code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }, fetchFn)
      if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove Studio HQ at myaccount.google.com/permissions and sign in again.')
      setSecret(this.db, REFRESH, t.refresh_token)
      this.access = { token: t.access_token, expires: Date.now() + t.expires_in * 1000 }
    } finally {
      server.close()
    }
  }

  async accessToken(fetchFn: typeof fetch = fetch): Promise<string> {
    if (this.access && this.access.expires - 60_000 > Date.now()) return this.access.token
    const refresh = getSecret(this.db, REFRESH)
    if (!refresh) throw new Error('Sign in to Google in Settings first.')
    const t = await this.token({ refresh_token: refresh, grant_type: 'refresh_token' }, fetchFn)
    this.access = { token: t.access_token, expires: Date.now() + t.expires_in * 1000 }
    return t.access_token
  }
}
