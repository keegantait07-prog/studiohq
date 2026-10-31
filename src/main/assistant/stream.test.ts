import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLine, type AssistantEvent } from './stream'

const fixture = (n: string): AssistantEvent[] =>
  readFileSync(join(__dirname, 'fixtures', n), 'utf8').split('\n').flatMap(parseLine)

describe('parseLine', () => {
  it('parses a recorded read run', () => {
    const ev = fixture('stream-read.jsonl')
    expect(ev.some((e) => e.type === 'text')).toBe(true)
    const tool = ev.find((e) => e.type === 'tool')
    expect(tool).toMatchObject({ type: 'tool', name: 'mcp__studiohq__ping' })
    expect(ev.some((e) => e.type === 'tool-result')).toBe(true)
    const last = ev[ev.length - 1]
    expect(last.type).toBe('done')
    expect((last as { sessionId: string }).sessionId).not.toBe('')
    expect(ev.filter((e) => e.type === 'done')).toHaveLength(1)
  })

  it('orders tool, result, text and marks result ok', () => {
    const ev = fixture('stream-read.jsonl')
    expect(ev.map((e) => e.type)).toEqual(['tool', 'tool-result', 'text', 'done'])
    const t = ev[0] as { id: string }
    expect(ev[1]).toEqual({ type: 'tool-result', id: t.id, isError: false })
  })

  it('parses the error run', () => {
    const ev = fixture('stream-error.jsonl')
    expect(ev).toHaveLength(1)
    expect(ev[0].type).toBe('error')
    expect((ev[0] as { message: string }).message).toContain('No conversation found')
  })

  it('flags error tool results', () => {
    const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: [{ type: 'text', text: 'no' }] }] } })
    expect(parseLine(line)).toEqual([{ type: 'tool-result', id: 'x', isError: true }])
  })

  it('ignores noise, bad json and blanks', () => {
    expect(parseLine('not json')).toEqual([])
    expect(parseLine('')).toEqual([])
    expect(parseLine('   ')).toEqual([])
    expect(parseLine('null')).toEqual([])
    expect(parseLine('{"type":"system","subtype":"hook_response"}')).toEqual([])
    expect(parseLine('{"type":"rate_limit_event"}')).toEqual([])
    expect(parseLine('{"type":"whatever"}')).toEqual([])
  })

  it('treats is_error result without errors array as an error', () => {
    const ev = parseLine('{"type":"result","is_error":true,"result":"boom","session_id":"s"}')
    expect(ev).toEqual([{ type: 'error', message: 'boom' }])
  })
})
