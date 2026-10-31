import http from 'http'
import type { AddressInfo } from 'net'
import { randomBytes, timingSafeEqual } from 'crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ToolDef } from './tools'
import type { Approvals } from './approvals'

export interface McpHandle { url: string; token: string; close(): Promise<void> }
type ToolEvent = { tool: string; args: unknown; ok: boolean }

const MAX_BODY = 1024 * 1024

function tokenOk(header: string | undefined, token: string): boolean {
  const a = Buffer.from(header ?? '')
  const b = Buffer.from(`Bearer ${token}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

const fail = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] })

export async function startMcpServer(tools: ToolDef[], approvals: Approvals, onToolEvent: (e: ToolEvent) => void): Promise<McpHandle> {
  const token = randomBytes(32).toString('hex')
  let closed = false
  const byName = new Map(tools.map((t) => [t.name, t]))

  const emit = (e: ToolEvent) => { try { onToolEvent(e) } catch { /* listener errors must not affect the tool result */ } }

  async function callTool(name: string, args: Record<string, unknown>) {
    const tool = byName.get(name)
    if (closed) return fail('server closed')
    if (!tool) return fail(`unknown tool: ${name}`)
    try {
      if (tool.kind !== 'read') {
        // Arguments that can only fail never reach the user. validate may only reject; every write still waits for approval below.
        const bad = tool.validate?.(args)
        if (bad) { emit({ tool: name, args, ok: false }); return fail(bad) }
        let card: string
        try { card = tool.describe(args) } catch { card = `Run ${tool.name}` }
        const ok = await approvals.request(tool.name, card)
        if (closed) return fail('server closed')
        if (!ok) { emit({ tool: name, args, ok: false }); return fail('user declined') }
      }
      const result = await tool.run(args)
      const failed = !!result && typeof result === 'object' && 'error' in result
      emit({ tool: name, args, ok: !failed })
      const res = { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null) }] }
      return failed ? { ...res, isError: true } : res
    } catch (e) {
      emit({ tool: name, args, ok: false })
      return fail(e instanceof Error ? e.message : String(e))
    }
  }

  function makeServer(): Server {
    const s = new Server({ name: 'studiohq', version: '1.0.0' }, { capabilities: { tools: {} } })
    s.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.kind === 'read' ? { annotations: { readOnlyHint: true } } : {})
      }))
    }))
    s.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>))
    return s
  }

  const http_ = http.createServer(async (req, res) => {
    try {
      if (!tokenOk(req.headers.authorization, token)) { res.writeHead(401).end(); return }
      if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') { res.writeHead(404).end(); return }
      let body: unknown
      if (req.method === 'POST') {
        const chunks: Buffer[] = []
        let size = 0
        for await (const c of req) {
          size += (c as Buffer).length
          if (size > MAX_BODY) { res.writeHead(413).end(); return }
          chunks.push(c as Buffer)
        }
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined } catch { res.writeHead(400).end(); return }
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const server = makeServer()
      res.on('close', () => { void transport.close(); void server.close() })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch {
      if (!res.headersSent) res.writeHead(500).end()
      else res.end()
    }
  })

  await new Promise<void>((resolve, reject) => {
    http_.once('error', reject)
    http_.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (http_.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () => new Promise<void>((resolve) => {
      closed = true
      approvals.rejectAll()
      http_.close(() => resolve())
      http_.closeAllConnections()
    })
  }
}
