import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, expect, test } from 'vitest'
import { writeLog } from './filelog'

const tmp = mkdtempSync(join(tmpdir(), 'shq-log-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

test('appends timestamped lines, including errors with their stack', () => {
  writeLog(tmp, 'ERROR', ['reindex failed', new Error('boom')])
  const text = readFileSync(join(tmp, 'studio-hq.log'), 'utf8')
  expect(text).toMatch(/^\d{4}-\d\d-\d\dT.* ERROR reindex failed Error: boom/)
})

test('rotates once the file passes 1 MB', () => {
  writeFileSync(join(tmp, 'studio-hq.log'), 'x'.repeat(1024 * 1024 + 1))
  writeLog(tmp, 'WARN', ['fresh'])
  expect(existsSync(join(tmp, 'studio-hq.log.1'))).toBe(true)
  expect(readFileSync(join(tmp, 'studio-hq.log'), 'utf8')).toContain('WARN fresh')
})
