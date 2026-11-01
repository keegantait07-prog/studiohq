import { describe, expect, test } from 'vitest'
import { groupFindings } from './cleanup'
import type { FixKind, HealthFinding, HealthKind } from './types'

let n = 0
const f = (kind: HealthKind, fix: FixKind | null, name = `P${++n}`): HealthFinding =>
  ({ id: n, pluginId: n, name, path: `/p/${name}`, kind, severity: 'warn', detail: '', certainty: 'likely', fix })

describe('groupFindings', () => {
  test('puts findings of the same kind and fix in one group, with the count in the title', () => {
    const g = groupFindings([f('stale-fl-db', 'clear-fl-entry'), f('stale-fl-db', 'clear-fl-entry'), f('stale-fl-db', 'clear-fl-entry')])
    expect(g).toHaveLength(1)
    expect(g[0].findings).toHaveLength(3)
    expect(g[0].title).toMatch(/^3 plugins/)
  })
  test('uses the singular for one item', () => {
    expect(groupFindings([f('broken-bundle', 'remove-bundle')])[0].title).toMatch(/^1 broken install$/)
    expect(groupFindings([f('duplicate', 'disable')])[0].title).toMatch(/^1 duplicate copy$/)
  })
  test('orders groups by usefulness: crashes and FL problems before advisory checks', () => {
    const g = groupFindings([f('arch', 'disable'), f('quarantine', 'unquarantine'), f('stale-fl-db', 'clear-fl-entry'), f('fl-error', 'clear-fl-entry'), f('crash', 'disable')])
    expect(g.map((x) => x.kind)).toEqual(['crash', 'fl-error', 'stale-fl-db', 'quarantine', 'arch'])
  })
  test('marks only the reversible, low-risk groups as safe for "Clean up for me"', () => {
    const safe = (k: HealthKind, fix: FixKind) => groupFindings([f(k, fix)])[0].safe
    expect(safe('stale-fl-db', 'clear-fl-entry')).toBe(true)
    expect(safe('fl-error', 'clear-fl-entry')).toBe(true)
    expect(safe('broken-bundle', 'remove-bundle')).toBe(true)
    expect(safe('duplicate', 'disable')).toBe(true)
    expect(safe('quarantine', 'unquarantine')).toBe(false)
    expect(safe('signature', 'resign')).toBe(false)
    expect(safe('crash', 'disable')).toBe(false)
    expect(safe('arch', 'disable')).toBe(false)
  })
  test('findings with no automatic fix form their own group with no action', () => {
    const g = groupFindings([f('stale-fl-db', 'clear-fl-entry'), f('stale-fl-db', null)])
    expect(g).toHaveLength(2)
    const none = g.find((x) => x.fix === null)!
    expect(none.action).toBe('')
    expect(none.safe).toBe(false)
  })
  test('every group explains what applying it does', () => {
    for (const [k, fix] of [['crash', 'disable'], ['fl-error', 'clear-fl-entry'], ['stale-fl-db', 'clear-fl-entry'], ['broken-bundle', 'remove-bundle'], ['duplicate', 'disable'], ['quarantine', 'unquarantine'], ['signature', 'resign'], ['arch', 'disable']] as [HealthKind, FixKind][]) {
      expect(groupFindings([f(k, fix)])[0].action.length).toBeGreaterThan(10)
    }
  })
})
