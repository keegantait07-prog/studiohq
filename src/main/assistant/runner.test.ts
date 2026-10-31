import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findClaude, buildArgs, runClaude, type AssistantEvent } from './runner'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function script(body: string): { bin: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fakeclaude-'))
  dirs.push(dir)
  const bin = join(dir, 'claude')
  writeFileSync(bin, `#!/bin/sh\n${body}\n`)
  chmodSync(bin, 0o755)
  return { bin, dir }
}

describe('findClaude', () => {
  it('returns the override when it exists', () => {
    expect(findClaude('/x/claude', () => true)).toBe('/x/claude')
  })
  it('falls through the default paths in order', () => {
    const seen: string[] = []
    const r = findClaude('/x/claude', (p) => { seen.push(p); return p.endsWith('/opt/homebrew/bin/claude') })
    expect(r).toBe('/opt/homebrew/bin/claude')
    expect(seen[0]).toBe('/x/claude')
    expect(seen).toHaveLength(3)
    expect(seen[1].endsWith('/.local/bin/claude')).toBe(true)
  })
  it('tries the third default last', () => {
    expect(findClaude('', (p) => p === '/usr/local/bin/claude')).toBe('/usr/local/bin/claude')
  })
  it('returns null when nothing exists', () => {
    expect(findClaude('/x/claude', () => false)).toBeNull()
  })
})

describe('buildArgs', () => {
  const base = { mcpConfigPath: '/m.json', sessionId: null, systemPrompt: 'be nice' }
  const pair = (a: string[], flag: string) => a[a.indexOf(flag) + 1]
  it('contains the verified flag set', () => {
    const a = buildArgs(base)
    expect(a).toContain('-p')
    expect(pair(a, '--output-format')).toBe('stream-json')
    expect(a).toContain('--verbose')
    expect(a).toContain('--strict-mcp-config')
    expect(pair(a, '--mcp-config')).toBe('/m.json')
    expect(pair(a, '--tools')).toBe('')
    expect(pair(a, '--allowedTools')).toBe('mcp__studiohq__*')
    expect(pair(a, '--setting-sources')).toBe('')
    expect(a).toContain('--disable-slash-commands')
    expect(pair(a, '--append-system-prompt')).toBe('be nice')
    expect(a).not.toContain('--resume')
  })
  it('adds --resume only with a session id', () => {
    const a = buildArgs({ ...base, sessionId: 'abc' })
    expect(pair(a, '--resume')).toBe('abc')
  })
})

describe('runClaude', () => {
  const line = (o: object) => JSON.stringify(o).replace(/'/g, "'\\''")
  it('delivers events in order and resolves done', async () => {
    const t = line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
    const r = line({ type: 'result', is_error: false, session_id: 'sess1' })
    const { bin, dir } = script(`echo '${t}'\necho '${r}'`)
    const ev: AssistantEvent[] = []
    await runClaude({ bin, cwd: dir, prompt: 'p', args: [], onEvent: (e) => ev.push(e) }).done
    expect(ev).toEqual([{ type: 'text', text: 'hi' }, { type: 'done', sessionId: 'sess1' }])
  })
  it('passes args then the prompt after --', async () => {
    const { bin, dir } = script(`echo "$@" > "${'$'}0.args"; echo '${line({ type: 'result', session_id: 's' })}'`)
    await runClaude({ bin, cwd: dir, prompt: 'hello world', args: ['-p', '--verbose'], onEvent: () => {} }).done
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(bin + '.args', 'utf8').trim()).toBe('-p --verbose -- hello world')
  })
  it('emits one error on non-zero exit with stderr', async () => {
    const { bin, dir } = script(`echo 'bad thing' >&2\nexit 1`)
    const ev: AssistantEvent[] = []
    await runClaude({ bin, cwd: dir, prompt: 'p', args: [], onEvent: (e) => ev.push(e) }).done
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ type: 'error' })
    expect((ev[0] as { message: string }).message).toContain('bad thing')
  })
  it('emits one error on zero exit with no result', async () => {
    const { bin, dir } = script(`exit 0`)
    const ev: AssistantEvent[] = []
    await runClaude({ bin, cwd: dir, prompt: 'p', args: [], onEvent: (e) => ev.push(e) }).done
    expect(ev.map((e) => e.type)).toEqual(['error'])
  })
  it('does not add a second error after the CLI reported one', async () => {
    const { bin, dir } = script(`echo '${line({ type: 'result', is_error: true, errors: ['nope'], session_id: 's' })}'\nexit 1`)
    const ev: AssistantEvent[] = []
    await runClaude({ bin, cwd: dir, prompt: 'p', args: [], onEvent: (e) => ev.push(e) }).done
    expect(ev).toEqual([{ type: 'error', message: 'nope' }])
  })
  it('stop() kills a sleeping child and resolves done without events', async () => {
    const { bin, dir } = script(`echo $$ > "$0.pid"\nsleep 30`)
    const ev: AssistantEvent[] = []
    const run = runClaude({ bin, cwd: dir, prompt: 'p', args: [], onEvent: (e) => ev.push(e) })
    await new Promise((r) => setTimeout(r, 300))
    run.stop()
    await run.done
    expect(ev).toEqual([])
    const { readFileSync } = await import('node:fs')
    const pid = Number(readFileSync(bin + '.pid', 'utf8').trim())
    await new Promise((r) => setTimeout(r, 100))
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('reports a spawn failure as one error', async () => {
    const ev: AssistantEvent[] = []
    await runClaude({ bin: '/nonexistent/claude', cwd: tmpdir(), prompt: 'p', args: [], onEvent: (e) => ev.push(e) }).done
    expect(ev.map((e) => e.type)).toEqual(['error'])
  })
})
