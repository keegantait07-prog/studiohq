export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; isError: boolean }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Parse one line of `claude -p --output-format stream-json` output. Unknown/noisy events and bad JSON yield []. */
export function parseLine(line: string): AssistantEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let ev: unknown
  try { ev = JSON.parse(trimmed) } catch { return [] }
  if (!isObj(ev)) return []

  const content = isObj(ev.message) && Array.isArray(ev.message.content) ? ev.message.content : []
  const out: AssistantEvent[] = []

  if (ev.type === 'assistant') {
    for (const b of content) {
      if (!isObj(b)) continue
      if (b.type === 'text' && str(b.text)) out.push({ type: 'text', text: str(b.text) })
      else if (b.type === 'tool_use') out.push({ type: 'tool', id: str(b.id), name: str(b.name), input: b.input ?? {} })
    }
  } else if (ev.type === 'user') {
    for (const b of content) {
      if (isObj(b) && b.type === 'tool_result') out.push({ type: 'tool-result', id: str(b.tool_use_id), isError: b.is_error === true })
    }
  } else if (ev.type === 'result') {
    if (ev.is_error === true) {
      const errs = Array.isArray(ev.errors) ? ev.errors.filter((e): e is string => typeof e === 'string') : []
      const message = errs.join('; ') || str(ev.result) || str(ev.subtype) || 'The assistant failed'
      out.push({ type: 'error', message })
    } else {
      out.push({ type: 'done', sessionId: str(ev.session_id) })
    }
  }
  return out
}
