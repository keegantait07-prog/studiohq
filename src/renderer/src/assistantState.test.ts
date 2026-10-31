import { describe, expect, it } from 'vitest'
import { answerApproval, initialState, loadThread, reduce, startRun, toolLabel, type ViewState } from './assistantState'

const ev = (threadId: number, event: any) => ({ threadId, event })
const base = (): ViewState => ({ ...initialState(), threadId: 1 })

describe('assistantState', () => {
  it('accumulates streamed text into one assistant message', () => {
    let s = startRun(base(), 'hi')
    s = reduce(s, ev(1, { type: 'text', text: 'Hel' }))
    s = reduce(s, ev(1, { type: 'text', text: 'lo\nworld' }))
    expect(s.items).toEqual([{ kind: 'user', text: 'hi' }, { kind: 'assistant', text: 'Hello\nworld' }])
    expect(s.running).toBe(true)
  })
  it('starts a new assistant message after a tool call', () => {
    let s = startRun(base(), 'hi')
    s = reduce(s, ev(1, { type: 'text', text: 'a' }))
    s = reduce(s, ev(1, { type: 'tool', id: 't', name: 'x', input: {} }))
    s = reduce(s, ev(1, { type: 'text', text: 'b' }))
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })
  it('marks a tool line as errored by its result', () => {
    let s = reduce(base(), ev(1, { type: 'tool', id: 't', name: 'mcp__studiohq__search_beats', input: { q: 1 } }))
    s = reduce(s, ev(1, { type: 'tool-result', id: 't', isError: true }))
    expect(s.items[0]).toMatchObject({ kind: 'tool', isError: true })
  })
  it('shortens and humanises tool names', () => {
    expect(toolLabel('mcp__studiohq__search_beats')).toBe('Searched beats')
    expect(toolLabel('search_beats')).toBe('Searched beats')
    expect(toolLabel('mcp__studiohq__set_beat_status')).toBe('Set beat status')
  })
  it('tracks approval answers', () => {
    let s = reduce({ ...base(), running: true }, { threadId: 1, approval: { id: 'a', tool: 'set', summary: 'Do it' } })
    expect(s.items[0]).toMatchObject({ kind: 'approval', outcome: 'pending' })
    s = answerApproval(s, 'a', true)
    expect(s.items[0]).toMatchObject({ outcome: 'approved' })
  })
  it('terminal events clear running and expire pending approvals', () => {
    let s = reduce({ ...base(), running: true }, { threadId: 1, approval: { id: 'a', tool: 'set', summary: 's' } })
    s = reduce(s, ev(1, { type: 'done', sessionId: 'x' }))
    expect(s.running).toBe(false)
    expect(s.items[0]).toMatchObject({ outcome: 'expired' })
    const e = reduce({ ...base(), running: true }, ev(1, { type: 'error', message: 'boom' }))
    expect(e.running).toBe(false)
    expect(e.items[0]).toEqual({ kind: 'error', message: 'boom' })
  })
  it('ignores events for other threads', () => {
    const s = base()
    expect(reduce(s, ev(2, { type: 'text', text: 'x' }))).toBe(s)
  })
  it('loads persisted messages', () => {
    const s = loadThread({ id: 3, title: 't', updatedAt: 0, messages: [{ role: 'user', text: 'q' }, { role: 'tool', name: 'n', input: {}, isError: true }, { role: 'assistant', text: 'a' }] })
    expect(s.threadId).toBe(3)
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(s.running).toBe(false)
  })
})

describe('assistantState purity', () => {
  it('ignores approval pushes for another thread', () => {
    const s = base()
    expect(reduce(s, { threadId: 2, approval: { id: 'a', tool: 't', summary: 's' } })).toBe(s)
  })
  it('tool-result with unknown id is a no-op', () => {
    const s = reduce(base(), ev(1, { type: 'tool', id: 't', name: 'x', input: {} }))
    expect(reduce(s, ev(1, { type: 'tool-result', id: 'zzz', isError: true })).items).toEqual(s.items)
  })
  it('does not mutate its input', () => {
    const s = startRun(base(), 'q')
    const snap = JSON.stringify(s)
    reduce(s, ev(1, { type: 'text', text: 'x' }))
    reduce(s, ev(1, { type: 'done', sessionId: 's' }))
    answerApproval(s, 'a', true)
    expect(JSON.stringify(s)).toBe(snap)
  })
})
