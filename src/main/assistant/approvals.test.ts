import { describe, it, expect, vi, afterEach } from 'vitest'
import { Approvals, type ApprovalRequest } from './approvals'

afterEach(() => { vi.useRealTimers() })

describe('Approvals', () => {
  it('fires onRequest and stays pending', async () => {
    const a = new Approvals()
    const seen: ApprovalRequest[] = []
    a.onRequest = (r) => seen.push(r)
    let settled = false
    const p = a.request('save_contact', 'Save X').then((v) => { settled = true; return v })
    await Promise.resolve()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ tool: 'save_contact', summary: 'Save X' })
    expect(settled).toBe(false)
    a.resolve(seen[0].id, true)
    expect(await p).toBe(true)
  })

  it('resolve(false) resolves false', async () => {
    const a = new Approvals()
    let id = ''
    a.onRequest = (r) => { id = r.id }
    const p = a.request('t', 's')
    a.resolve(id, false)
    expect(await p).toBe(false)
  })

  it('times out to false', async () => {
    vi.useFakeTimers()
    const a = new Approvals(1000)
    a.onRequest = () => {}
    const p = a.request('t', 's')
    vi.advanceTimersByTime(1001)
    expect(await p).toBe(false)
  })

  it('rejectAll resolves every pending request false', async () => {
    const a = new Approvals()
    a.onRequest = () => {}
    const ps = [a.request('a', '1'), a.request('b', '2')]
    a.rejectAll()
    expect(await Promise.all(ps)).toEqual([false, false])
  })

  it('unknown id is a no-op', () => {
    const a = new Approvals()
    expect(() => a.resolve('nope', true)).not.toThrow()
  })
})
