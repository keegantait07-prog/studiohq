import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AssistantPush, ThreadMessage } from '../../shared/types'
import type { AssistantEvent } from '../../shared/assistantTypes'
import { Approvals } from './approvals'
import { startMcpServer, type McpHandle } from './mcpServer'
import { buildArgs, findClaude, runClaude, type Run } from './runner'
import { systemPrompt } from './prompt'
import type { Threads } from './threads'
import type { ToolDef } from './tools'

export interface AssistantDeps {
  threads: Threads
  tools: ToolDef[]
  claudePath: () => string
  userDataDir: string
  push: (p: AssistantPush) => void
  producerName?: () => string
  /** Test seams. */
  approvals?: Approvals
  find?: (override: string) => string | null
}

const NO_CLI = 'The Claude Code CLI was not found. Install Claude Code and run `claude` once in a terminal to log in, or set its path in Settings.'
const BUSY = 'The assistant is still working on the previous message. Wait for it to finish, or stop it.'
const TOOL_PREFIX = /^mcp__studiohq__/

/** Runs the claude CLI against the app's tools, one run at a time, and keeps each chat thread in the database. */
export class AssistantService {
  private approvals: Approvals
  private mcp: McpHandle | null = null
  private cwd: string
  private active: { threadId: number; run: Run } | null = null
  private stopping = false

  constructor(private d: AssistantDeps) {
    this.approvals = d.approvals ?? new Approvals()
    this.cwd = join(d.userDataDir, 'assistant-cwd')
  }

  async start(): Promise<void> {
    mkdirSync(this.cwd, { recursive: true })
    this.approvals.onRequest = (approval) => {
      if (this.active && !this.stopping) this.d.push({ threadId: this.active.threadId, approval })
      else this.approvals.resolve(approval.id, false) // nobody is listening to this chat
    }
    const mcp = await startMcpServer(this.d.tools, this.approvals, () => {})
    try {
      const config = { mcpServers: { studiohq: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } }
      writeFileSync(join(this.cwd, 'mcp.json'), JSON.stringify(config), { mode: 0o600 })
    } catch (e) {
      await mcp.close()
      throw e
    }
    this.mcp = mcp
  }

  async send(threadId: number, text: string): Promise<{ error?: string }> {
    if (this.active) return { error: BUSY }
    if (!this.mcp) return { error: 'The assistant failed to start. Restart Studio HQ and try again.' }
    const { threads } = this.d
    if (!threads.get(threadId)) return { error: 'That chat no longer exists.' }
    const bin = (this.d.find ?? findClaude)(this.d.claudePath())
    if (!bin) return { error: NO_CLI }

    threads.append(threadId, { role: 'user', text })

    // Persist what streams: consecutive text becomes one assistant message; tool calls are marked failed when their result says so.
    let pending = ''
    let terminal: AssistantEvent | null = null
    let retried = false
    const toolIndex = new Map<string, number>()
    const flush = (): void => {
      if (pending) { threads.append(threadId, { role: 'assistant', text: pending }); pending = '' }
    }
    const onEvent = (e: AssistantEvent): void => {
      if (e.type === 'done' || e.type === 'error') { terminal = e; return } // pushed once the run has fully ended
      if (e.type === 'text') pending += e.text
      else if (e.type === 'tool') {
        flush()
        toolIndex.set(e.id, threads.get(threadId)?.messages.length ?? 0)
        threads.append(threadId, { role: 'tool', name: e.name.replace(TOOL_PREFIX, ''), input: e.input, isError: false })
      } else if (e.type === 'tool-result' && e.isError) {
        const i = toolIndex.get(e.id)
        if (i !== undefined) threads.update(threadId, (ms) => { const m: ThreadMessage | undefined = ms[i]; if (m?.role === 'tool') m.isError = true })
      }
      this.d.push({ threadId, event: e })
    }

    const launch = (): void => {
      terminal = null
      const sessionId = threads.sessionId(threadId)
      const args = buildArgs({ mcpConfigPath: join(this.cwd, 'mcp.json'), sessionId, systemPrompt: systemPrompt(this.d.producerName?.() ?? '') })
      const run = runClaude({ bin, cwd: this.cwd, prompt: text, args, onEvent })
      this.active = { threadId, run }
      void run.done.then(() => {
        const t = terminal as AssistantEvent | null
        // Claude Code deletes old transcripts; a chat whose session is gone would fail every time, so start it afresh once.
        if (sessionId && !retried && !this.stopping && t?.type === 'error' && /No conversation found/i.test(t.message)) {
          retried = true
          try { threads.setSessionId(threadId, null) } catch { /* fall through to surfacing the error */ }
          if (threads.sessionId(threadId) === null) { launch(); return }
        }
        finish()
      })
    }
    const finish = (): void => {
      let final = terminal as AssistantEvent | null
      try {
        flush()
        if (final?.type === 'done' && final.sessionId) threads.setSessionId(threadId, final.sessionId)
        // A stopped run ends with no terminal event; tell the UI so it stops showing "working".
        if (!final) final = { type: 'done', sessionId: threads.sessionId(threadId) ?? '' }
      } catch (e) {
        final = { type: 'error', message: e instanceof Error ? e.message : String(e) }
      }
      this.approvals.rejectAll() // nothing left to approve once the run is over
      this.active = null
      this.stopping = false
      this.d.push({ threadId, event: final })
    }
    launch()
    return {}
  }

  stop(threadId: number): void {
    if (this.active?.threadId !== threadId) return
    this.stopping = true
    this.active.run.stop()
    this.approvals.rejectAll()
  }

  approve(id: string, ok: boolean): void {
    this.approvals.resolve(id, ok)
  }

  async shutdown(): Promise<void> {
    this.approvals.rejectAll()
    const a = this.active
    if (a) { this.stopping = true; a.run.stop(); await a.run.done }
    const mcp = this.mcp
    this.mcp = null
    if (mcp) await mcp.close()
  }
}
