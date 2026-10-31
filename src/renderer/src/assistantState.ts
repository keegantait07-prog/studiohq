import type { AssistantPush, ThreadDetail } from '@shared/types'

export type Outcome = 'pending' | 'approved' | 'denied' | 'expired'
export type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id?: string; name: string; input: unknown; isError: boolean }
  | { kind: 'approval'; id: string; tool: string; summary: string; outcome: Outcome }
  | { kind: 'error'; message: string }
export interface ViewState { threadId: number | null; items: Item[]; running: boolean }

export const initialState = (): ViewState => ({ threadId: null, items: [], running: false })

const PREFIX = 'mcp__studiohq__'
export const shortName = (name: string) => (name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name)

const LABELS: Record<string, string> = {
  search_beats: 'Searched beats',
  list_beats: 'Listed beats',
  get_beat: 'Looked up a beat',
}
export function toolLabel(name: string): string {
  const n = shortName(name)
  if (LABELS[n]) return LABELS[n]
  const h = n.replace(/[_-]+/g, ' ').trim()
  return h ? h[0].toUpperCase() + h.slice(1) : 'Tool'
}

export function loadThread(d: ThreadDetail): ViewState {
  const items: Item[] = d.messages.map((m) =>
    m.role === 'tool' ? { kind: 'tool', name: m.name, input: m.input, isError: m.isError } : { kind: m.role, text: m.text })
  return { threadId: d.id, items, running: false }
}

export const startRun = (s: ViewState, text: string): ViewState => ({ ...s, running: true, items: [...s.items, { kind: 'user', text }] })

const expire = (items: Item[]): Item[] =>
  items.map((i) => (i.kind === 'approval' && i.outcome === 'pending' ? { ...i, outcome: 'expired' as const } : i))

export function reduce(s: ViewState, p: AssistantPush): ViewState {
  if (p.threadId !== s.threadId) return s
  if ('approval' in p) return { ...s, items: [...s.items, { kind: 'approval', ...p.approval, outcome: 'pending' }] }
  const e = p.event
  switch (e.type) {
    case 'text': {
      const last = s.items[s.items.length - 1]
      if (last && last.kind === 'assistant') return { ...s, items: [...s.items.slice(0, -1), { kind: 'assistant', text: last.text + e.text }] }
      return { ...s, items: [...s.items, { kind: 'assistant', text: e.text }] }
    }
    case 'tool':
      return { ...s, items: [...s.items, { kind: 'tool', id: e.id, name: e.name, input: e.input, isError: false }] }
    case 'tool-result':
      return { ...s, items: s.items.map((i) => (i.kind === 'tool' && i.id === e.id ? { ...i, isError: e.isError } : i)) }
    case 'done':
      return { ...s, running: false, items: expire(s.items) }
    case 'error':
      return { ...s, running: false, items: [...expire(s.items), { kind: 'error', message: e.message }] }
  }
  return s
}

export const answerApproval = (s: ViewState, id: string, approved: boolean): ViewState => ({
  ...s,
  items: s.items.map((i) => (i.kind === 'approval' && i.id === id ? { ...i, outcome: approved ? 'approved' : 'denied' } : i)),
})

export const addError = (s: ViewState, message: string): ViewState => ({ ...s, running: false, items: [...s.items, { kind: 'error', message }] })
