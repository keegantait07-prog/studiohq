// Links a bounce to its FL Studio project by fuzzy name matching.
import { readdirSync, statSync } from 'fs'
import { join, basename, extname } from 'path'

export interface ProjectFile { path: string; tokens: Set<string>; mtime: number }

const norm = (s: string) =>
  s.toLowerCase().replace(/@[\w.]+/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const tokenize = (s: string) => new Set(norm(s).split(' ').filter((t) => t.length > 1 || /\d/.test(t)))

export function scanProjects(roots: string[]): ProjectFile[] {
  const out: ProjectFile[] = []
  const walk = (dir: string, depth: number) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'Backup') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1) }
      else if (extname(e.name).toLowerCase() === '.flp') {
        let mtime = 0
        try { mtime = statSync(p).mtimeMs } catch { /* ignore */ }
        // project name = file name plus its folder name, which FL users often name after the beat
        out.push({ path: p, tokens: tokenize(basename(e.name, '.flp') + ' ' + basename(dir)), mtime })
      }
    }
  }
  roots.forEach((r) => walk(r, 0))
  return out
}

export function matchProject(title: string, projects: ProjectFile[]): { path: string; score: number } | null {
  const t = tokenize(title)
  if (!t.size) return null
  let best: { path: string; score: number; mtime: number } | null = null
  for (const p of projects) {
    let hit = 0
    for (const tok of t) if (p.tokens.has(tok)) hit++
    if (!hit) continue
    // share of the bounce title found in the project, lightly penalising very long project names
    const score = hit / t.size - Math.max(0, p.tokens.size - t.size) * 0.03
    if (!best || score > best.score || (score === best.score && p.mtime > best.mtime)) best = { path: p.path, score, mtime: p.mtime }
  }
  return best && best.score >= 0.6 ? { path: best.path, score: Math.round(best.score * 100) / 100 } : null
}
