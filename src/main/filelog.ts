import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

const MAX_BYTES = 1024 * 1024

function line(level: string, args: unknown[]): string {
  const text = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  return `${new Date().toISOString()} ${level} ${text}\n`
}

/** Appends to <dir>/studio-hq.log and keeps one rotated copy (studio-hq.log.1) once it passes 1 MB. Never throws. */
export function writeLog(dir: string, level: string, args: unknown[]): void {
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'studio-hq.log')
    try { if (statSync(file).size > MAX_BYTES) renameSync(file, file + '.1') } catch { /* no log yet */ }
    appendFileSync(file, line(level, args))
  } catch { /* logging must never break the app */ }
}

/** Mirrors console.error and console.warn into the log file so a problem on someone's machine can be looked at afterwards. */
export function installFileLog(dir: string): void {
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => { original(...args); writeLog(dir, level.toUpperCase(), args) }
  }
  process.on('uncaughtException', (e) => writeLog(dir, 'FATAL', ['uncaughtException', e]))
  process.on('unhandledRejection', (e) => writeLog(dir, 'ERROR', ['unhandledRejection', e]))
}
