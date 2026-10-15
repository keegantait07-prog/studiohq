// Deploys a folder to a Netlify site using the file-digest API, so unchanged files are never re-uploaded.
import { createHash } from 'crypto'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const API = process.env.STUDIO_HQ_NETLIFY_API ?? 'https://api.netlify.com/api/v1'

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  if (res.status === 401) throw new Error('Netlify rejected the access token (401). Paste a fresh personal access token in Settings.')
  if (!res.ok) throw new Error(`Netlify error ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (statSync(p).isFile()) out.push(p)
  }
  return out
}

export interface DeployResult { siteId: string; baseUrl: string }

export async function deployDir(dir: string, token: string, siteId: string | null, onStep?: (s: string) => void): Promise<DeployResult> {
  let site: { id: string; ssl_url?: string; url: string }
  if (siteId) {
    site = await (await call(token, `/sites/${siteId}`)).json()
  } else {
    onStep?.('Creating Netlify site')
    site = await (await call(token, '/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  }

  const files = walk(dir).map((abs) => {
    const buf = readFileSync(abs)
    return { path: '/' + relative(dir, abs).split(sep).join('/'), abs, sha: createHash('sha1').update(buf).digest('hex') }
  })
  const manifest: Record<string, string> = {}
  for (const f of files) manifest[f.path] = f.sha

  onStep?.('Preparing deploy')
  const deploy = await (await call(token, `/sites/${site.id}/deploys`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: manifest })
  })).json() as { id: string; required?: string[] }

  const need = new Set(deploy.required ?? [])
  const todo = files.filter((f) => need.has(f.sha))
  let done = 0
  for (const f of todo) {
    onStep?.(`Uploading ${++done}/${todo.length}`)
    const encoded = f.path.slice(1).split('/').map(encodeURIComponent).join('/')
    await call(token, `/deploys/${deploy.id}/files/${encoded}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: readFileSync(f.abs)
    })
  }

  onStep?.('Publishing')
  for (let i = 0; i < 90; i++) {
    const d = await (await call(token, `/deploys/${deploy.id}`)).json() as { state: string; error_message?: string }
    if (d.state === 'ready') return { siteId: site.id, baseUrl: (site.ssl_url || site.url).replace(/\/$/, '') }
    if (d.state === 'error') throw new Error('Netlify deploy failed: ' + (d.error_message ?? 'unknown error'))
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Netlify deploy timed out')
}
