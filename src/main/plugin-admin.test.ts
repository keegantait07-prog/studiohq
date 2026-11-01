import { describe, expect, test } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { adminBatchArgs, parseFailed } from './plugin-admin'

describe('adminBatchArgs', () => {
  const cmds = [
    { cmd: '/bin/mv', args: ['/Library/Audio/Plug-Ins/VST3/Soundtoys 5 "Beta" é.vst3', '/Users/k/.Trash/x'] },
    { cmd: '/usr/bin/xattr', args: ['-dr', 'com.apple.quarantine', '/p/a b'] },
    { cmd: '/bin/sync', args: [] as string[] }
  ]
  test('every command and argument reaches osascript as its own argument, each command preceded by its argument count', () => {
    const args = adminBatchArgs(cmds)
    const tail = ['/bin/mv', '2', '/Library/Audio/Plug-Ins/VST3/Soundtoys 5 "Beta" é.vst3', '/Users/k/.Trash/x', '/usr/bin/xattr', '3', '-dr', 'com.apple.quarantine', '/p/a b', '/bin/sync', '0']
    expect(args.slice(-tail.length)).toEqual(tail)
  })
  test('file names never appear in the script text itself, so nothing in a name can change what runs', () => {
    const script = adminBatchArgs(cmds).slice(0, -11).join('\n')
    expect(script).not.toContain('Beta')
    expect(script).not.toContain('é')
    expect(script).toContain('administrator privileges')
  })
  test('is one osascript script however many commands there are', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ cmd: '/bin/mv', args: [`/a/${i}`, `/b/${i}`] }))
    const args = adminBatchArgs(many)
    expect(args.filter((a) => a === 'on run argv')).toHaveLength(1)
    expect(args.filter((a) => a === 'do shell script c with administrator privileges').length + args.filter((a) => /administrator privileges/.test(a)).length).toBeGreaterThan(0)
  })
  test('refuses a command that is not an absolute path', () => {
    expect(() => adminBatchArgs([{ cmd: 'mv', args: ['a', 'b'] }])).toThrow(/absolute/)
  })
})

describe('parseFailed', () => {
  test('turns the FAILED markers into zero-based positions of the commands that failed', () => {
    expect(parseFailed('FAILED 2\nFAILED 5\n')).toEqual([1, 4])
    expect(parseFailed('')).toEqual([])
  })
})

// The real script, run without the "administrator privileges" clause so no password is needed, on files with awkward names.
describe.skipIf(process.platform !== 'darwin')('the batch script really runs', () => {
  test('moves files with spaces, quotes and unicode, and reports only the command that failed', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'plug-admin-')))
    try {
      const names = ['Soundtoys 5 "Beta" é.vst3', "it's $HOME `x`.vst", 'plain']
      names.forEach((n) => writeFileSync(join(dir, n), n))
      mkdirSync(join(dir, 'out'))
      const cmds = [
        { cmd: '/bin/mv', args: [join(dir, names[0]), join(dir, 'out', names[0])] },
        { cmd: '/bin/mv', args: [join(dir, 'does not exist'), join(dir, 'out', 'x')] }, // fails
        { cmd: '/bin/mv', args: [join(dir, names[1]), join(dir, 'out', names[1])] },
        { cmd: '/bin/mv', args: [join(dir, names[2]), join(dir, 'out', names[2])] }
      ]
      const args = adminBatchArgs(cmds).map((a) => a.replace(' with administrator privileges', ''))
      const out = execFileSync('osascript', args, { encoding: 'utf8' })
      expect(parseFailed(out)).toEqual([1])
      for (const n of names) { expect(existsSync(join(dir, n))).toBe(false); expect(readFileSync(join(dir, 'out', n), 'utf8')).toBe(n) }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
