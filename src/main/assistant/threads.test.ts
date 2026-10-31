import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../db'
import { Threads } from './threads'

let dir: string
let db: Database.Database
let t: Threads
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'threads-')); db = openDb(dir); t = new Threads(db) })
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

describe('Threads', () => {
  it('creates a thread titled New chat', () => {
    const id = t.create()
    expect(t.list()).toEqual([expect.objectContaining({ id, title: 'New chat' })])
  })
  it('appends messages in order and returns them from get', () => {
    const id = t.create()
    t.append(id, { role: 'user', text: 'hi' })
    t.append(id, { role: 'assistant', text: 'hello' })
    t.append(id, { role: 'tool', name: 'list_beats', input: {}, isError: false })
    expect(t.get(id)!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
  })
  it('titles the thread from the first user message, 40 chars', () => {
    const id = t.create()
    t.append(id, { role: 'user', text: 'x'.repeat(60) })
    t.append(id, { role: 'user', text: 'second' })
    expect(t.get(id)!.title).toBe('x'.repeat(40))
  })
  it('round-trips the session id', () => {
    const id = t.create()
    expect(t.sessionId(id)).toBeNull()
    t.setSessionId(id, 'abc')
    expect(t.sessionId(id)).toBe('abc')
  })
  it('returns null for unknown threads and lists newest first', () => {
    expect(t.get(999)).toBeNull()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    const a = t.create(); const b = t.create()
    now.mockReturnValue(2000)
    t.append(a, { role: 'user', text: 'later' })
    now.mockRestore()
    expect(t.list()[0].id).toBe(a)
    expect(b).not.toBe(a)
  })
})
