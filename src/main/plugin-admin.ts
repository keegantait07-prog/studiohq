// Run several commands as administrator behind ONE macOS password prompt.
// Every command and argument goes to osascript as its own argument (each command preceded by how many arguments it has),
// so nothing in a file name is ever part of the script text and nothing needs quoting by hand.
import { execFile } from 'child_process'

export interface AdminCmd { cmd: string; args: string[] }

export function adminBatchArgs(cmds: AdminCmd[]): string[] {
  for (const c of cmds) if (!c.cmd.startsWith('/')) throw new Error(`Administrator commands must use an absolute path, got "${c.cmd}"`)
  return [
    '-e', 'on run argv',
    '-e', 'set c to ""',
    '-e', 'set i to 1',
    '-e', 'set k to 0',
    '-e', 'repeat while i is less than or equal to (count of argv)',
    '-e', 'set k to k + 1',
    '-e', 'set n to (item (i + 1) of argv) as integer',
    '-e', 'set ln to quoted form of (item i of argv)',
    '-e', 'repeat with j from 1 to n',
    '-e', 'set ln to ln & " " & quoted form of (item (i + 1 + j) of argv)',
    '-e', 'end repeat',
    // a command that fails is reported by position and does not stop the rest
    '-e', 'set c to c & ln & " || echo FAILED " & k & "; "',
    '-e', 'set i to i + 2 + n',
    '-e', 'end repeat',
    '-e', 'return do shell script c with administrator privileges',
    '-e', 'end run',
    ...cmds.flatMap((c) => [c.cmd, String(c.args.length), ...c.args])
  ]
}

/** Zero-based positions of the commands that reported FAILED. */
export function parseFailed(out: string): number[] {
  return [...out.matchAll(/FAILED (\d+)/g)].map((m) => Number(m[1]) - 1)
}

/** One password prompt for the whole batch. Rejects if it is cancelled or cannot run; otherwise resolves with the positions that failed. */
export function runAdmin(cmds: AdminCmd[]): Promise<number[]> {
  if (!cmds.length) return Promise.resolve([])
  return new Promise((resolve, reject) => {
    execFile('osascript', adminBatchArgs(cmds), { timeout: 600000, maxBuffer: 4 * 1024 * 1024 }, (err, out, stderr) => {
      if (err) return reject(new Error(String(stderr).trim() || err.message))
      resolve(parseFailed(String(out)))
    })
  })
}
