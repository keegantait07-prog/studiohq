import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../db'
import { Threads } from './threads'
import { Approvals } from './approvals'
import { AssistantService } from './service'
import type { AssistantPush } from '../../shared/types'

let dir: string
let db: Database.Database
let threads: Threads
let pushes: AssistantPush[]
let svc: AssistantService | null

const line = (o: unknown): string => JSON.stringify(o)
const assistant = (...content: unknown[]) => line({ type: 'assistant', message: { content } })
const toolResult = (id: string, isError: boolean) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } })
const result = (sessionId: string) => line({ type: 'result', is_error: false, session_id: sessionId })

/** A fake claude that prints the given stream-json lines (or runs a custom body) and exits. */
function fake(body: string): string {
  const bin = join(dir, 'claude')
  writeFileSync(bin, `#!/bin/sh\n${body}\n`)
  chmodSync(bin, 0o755)
  return bin
}
const emits = (lines: string[]): string => lines.map((l) => `printf '%s\\n' '${l.replace(/'/g, "'\\''")}'`).join('\n')

function make(bin: string | null, extra: { approvals?: Approvals } = {}): AssistantService {
  svc = new AssistantService({
    threads, tools: [], claudePath: () => bin ?? '', userDataDir: dir, push: (p) => pushes.push(p),
    find: () => bin, ...extra
  })
  return svc
}
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 20))
  expect(cond()).toBe(true)
}
const finals = (): AssistantPush[] => pushes.filter((p) => 'event' in p && (p.event.type === 'done' || p.event.type === 'error'))

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'assistant-svc-')); db = openDb(dir); threads = new Threads(db); pushes = []; svc = null })
afterEach(async () => { await svc?.shutdown(); db.close(); rmSync(dir, { recursive: true, force: true }) })

describe('AssistantService', () => {
  it('persists the conversation, streams text and stores the session id', async () => {
    const bin = fake(emits([
      assistant({ type: 'text', text: 'Looking. ' }, { type: 'text', text: 'One sec.' }),
      assistant({ type: 'tool_use', id: 't1', name: 'mcp__studiohq__list_beats', input: { q: 'dark' } }),
      toolResult('t1', true),
      assistant({ type: 'text', text: 'Found none.' }),
      result('sess-1')
    ]))
    const s = make(bin)
    await s.start()
    const id = threads.create()
    expect(await s.send(id, 'find dark beats')).toEqual({})
    await until(() => finals().length === 1)
    expect(pushes.filter((p) => 'event' in p && p.event.type === 'text')).toHaveLength(3)
    const t = threads.get(id)!
    expect(t.messages).toEqual([
      { role: 'user', text: 'find dark beats' },
      { role: 'assistant', text: 'Looking. One sec.' },
      { role: 'tool', name: 'list_beats', input: { q: 'dark' }, isError: true },
      { role: 'assistant', text: 'Found none.' }
    ])
    expect(t.title).toBe('find dark beats')
    expect(threads.sessionId(id)).toBe('sess-1')
    expect(finals()[0]).toEqual({ threadId: id, event: { type: 'done', sessionId: 'sess-1' } })
  })

  it('writes an mcp config into the assistant cwd and resumes the stored session', async () => {
    const argsFile = join(dir, 'args.txt')
    const bin = fake(`printf '%s\\n' "$@" > '${argsFile}'\n${emits([result('s2')])}`)
    const s = make(bin)
    await s.start()
    const id = threads.create()
    threads.setSessionId(id, 'old-session')
    await s.send(id, 'hi')
    await until(() => finals().length === 1)
    const args = readFileSync(argsFile, 'utf8').split('\n')
    expect(args[args.indexOf('--resume') + 1]).toBe('old-session')
    const cfg = JSON.parse(readFileSync(join(dir, 'assistant-cwd', 'mcp.json'), 'utf8'))
    expect(cfg.mcpServers.studiohq.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(cfg.mcpServers.studiohq.headers.Authorization).toMatch(/^Bearer /)
  })

  it('rejects a second send while a run is in progress, then accepts one after it ends', async () => {
    const bin = fake('sleep 30')
    const s = make(bin)
    await s.start()
    const a = threads.create(); const b = threads.create()
    expect(await s.send(a, 'one')).toEqual({})
    const second = await s.send(a, 'two')
    expect(second.error).toMatch(/still working/i)
    expect((await s.send(b, 'other')).error).toMatch(/still working/i)
    expect(threads.get(a)!.messages).toEqual([{ role: 'user', text: 'one' }])
    s.stop(a)
    await until(() => finals().length === 1)
    fake(emits([result('s')]))
    expect(await s.send(a, 'three')).toEqual({})
    await until(() => finals().length === 2)
  })

  it('returns a how-to error when the CLI is not found, without persisting anything', async () => {
    const s = make(null)
    await s.start()
    const id = threads.create()
    const r = await s.send(id, 'hi')
    expect(r.error).toMatch(/install claude code/i)
    expect(r.error).toMatch(/log in/i)
    expect(threads.get(id)!.messages).toEqual([])
  })

  it('stop kills the run, declines pending approvals, keeps what streamed and frees the thread', async () => {
    const bin = fake(`${emits([assistant({ type: 'text', text: 'partial' })])}\nsleep 30`)
    const approvals = new Approvals()
    const s = make(bin, { approvals })
    await s.start()
    const id = threads.create()
    await s.send(id, 'go')
    await until(() => pushes.some((p) => 'event' in p && p.event.type === 'text'))
    const answer = approvals.request('save_contact', 'Add Sam')
    expect(pushes.some((p) => 'approval' in p && p.approval.tool === 'save_contact' && p.threadId === id)).toBe(true)
    s.stop(id)
    expect(await answer).toBe(false)
    await until(() => finals().length === 1)
    expect(finals()[0]).toMatchObject({ threadId: id, event: { type: 'done' } })
    expect(threads.get(id)!.messages).toEqual([{ role: 'user', text: 'go' }, { role: 'assistant', text: 'partial' }])
    fake(emits([result('s')]))
    expect(await s.send(id, 'again')).toEqual({})
    await until(() => finals().length === 2)
  })

  it('persists an error event as the final push and keeps the thread usable', async () => {
    const bin = fake(emits([line({ type: 'result', is_error: true, errors: ['boom'] })]))
    const s = make(bin)
    await s.start()
    const id = threads.create()
    await s.send(id, 'x')
    await until(() => finals().length === 1)
    expect(finals()[0]).toEqual({ threadId: id, event: { type: 'error', message: 'boom' } })
    expect(threads.sessionId(id)).toBeNull()
  })

  it('declines a pending approval when the run ends, so approving later is a no-op', async () => {
    const bin = fake('sleep 0.6')
    const approvals = new Approvals()
    const s = make(bin, { approvals })
    await s.start()
    const id = threads.create()
    await s.send(id, 'go')
    const answer = approvals.request('save_contact', 'Add Sam')
    const card = pushes.find((p) => 'approval' in p) as { approval: { id: string } }
    await until(() => finals().length === 1)
    expect(await answer).toBe(false)
    s.approve(card.approval.id, true) // already settled
    expect(await answer).toBe(false)
  })

  it('declines and never pushes approvals requested after stop()', async () => {
    const bin = fake('sleep 30')
    const approvals = new Approvals()
    const s = make(bin, { approvals })
    await s.start()
    const id = threads.create()
    await s.send(id, 'go')
    s.stop(id)
    const late = approvals.request('save_contact', 'late')
    expect(pushes.some((p) => 'approval' in p)).toBe(false)
    expect(await late).toBe(false)
    await until(() => finals().length === 1)
  })

  it('send reports a start failure instead of crashing', async () => {
    writeFileSync(join(dir, 'blocker'), 'x') // a file where the assistant dir's parent should be
    svc = new AssistantService({ threads, tools: [], claudePath: () => '', userDataDir: join(dir, 'blocker'), push: () => {}, find: () => '/bin/true' })
    await expect(svc.start()).rejects.toThrow()
    const id = threads.create()
    expect((await svc.send(id, 'hi')).error).toMatch(/failed to start/i)
  })

  it('send to an unknown thread returns an error', async () => {
    const s = make(fake('true'))
    await s.start()
    expect((await s.send(999, 'hi')).error).toBeTruthy()
  })

  it('shutdown declines approvals, stops the run and closes the MCP server', async () => {
    const bin = fake('sleep 30')
    const approvals = new Approvals()
    const s = make(bin, { approvals })
    await s.start()
    const id = threads.create()
    await s.send(id, 'go')
    const cfgPath = join(dir, 'assistant-cwd', 'mcp.json')
    expect(existsSync(cfgPath)).toBe(true)
    const url = JSON.parse(readFileSync(cfgPath, 'utf8')).mcpServers.studiohq.url as string
    const answer = approvals.request('x', 'y')
    await s.shutdown()
    expect(await answer).toBe(false)
    await expect(fetch(url, { method: 'POST' })).rejects.toThrow()
    await s.shutdown() // idempotent
  })
})
