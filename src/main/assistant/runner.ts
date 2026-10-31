import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseLine, type AssistantEvent } from './stream'

export type { AssistantEvent }

/** Look for the claude CLI: the user's override first, then the usual install locations. */
export function findClaude(override: string, exists: (p: string) => boolean = existsSync): string | null {
  const candidates = [
    override,
    join(homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ]
  for (const c of candidates) if (c && exists(c)) return c
  return null
}

export function buildArgs(o: { mcpConfigPath: string; sessionId: string | null; systemPrompt: string }): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--mcp-config', o.mcpConfigPath,
    '--tools', '',
    '--allowedTools', 'mcp__studiohq__*',
    // Keep the user's plugins, hooks and skills out of assistant runs (verified against the real CLI).
    '--setting-sources', '',
    '--disable-slash-commands',
    '--append-system-prompt', o.systemPrompt
  ]
  if (o.sessionId) args.push('--resume', o.sessionId)
  return args
}

export interface Run { stop(): void; done: Promise<void> }

export function runClaude(o: {
  bin: string
  cwd: string
  prompt: string
  args: string[]
  onEvent: (e: AssistantEvent) => void
}): Run {
  let terminal = false
  let stopped = false
  let stderr = ''
  let buf = ''
  const emit = (e: AssistantEvent): void => {
    if (e.type === 'done' || e.type === 'error') {
      if (terminal) return
      terminal = true
    }
    o.onEvent(e)
  }
  const feed = (line: string): void => { for (const e of parseLine(line)) emit(e) }

  // `--` ends variadic flags (--tools) and makes a prompt starting with "-" safe; no shell involved.
  const child = spawn(o.bin, [...o.args, '--', o.prompt], { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })

  const done = new Promise<void>((resolve) => {
    let finished = false
    const finish = (): void => { if (!finished) { finished = true; resolve() } }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) { feed(buf.slice(0, i)); buf = buf.slice(i + 1) }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => { stderr = (stderr + c).slice(-4000) })
    child.on('error', (err) => {
      emit({ type: 'error', message: `Could not start the claude CLI: ${err.message}` })
      finish()
    })
    child.on('close', (code) => {
      feed(buf); buf = ''
      if (!terminal && !stopped) {
        const tail = stderr.trim().split('\n').slice(-5).join('\n')
        emit({
          type: 'error',
          message: code === 0
            ? 'The assistant ended without a reply.'
            : tail || `The assistant exited with code ${code}.`
        })
      }
      finish()
    })
  })

  return {
    done,
    stop(): void {
      stopped = true
      if (child.exitCode !== null || child.pid === undefined) return
      // Own process group (detached) so grandchildren die too and release the pipes.
      try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    }
  }
}
