// Removing plugin files. Safety rules: only paths strictly inside known plugin/library locations, never Apple's own files,
// symlinks that leave those locations are refused, and everything goes to the macOS Trash (recoverable).
import { realpathSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'

/** Where plugin bundles live (VST2, VST3, AU, AAX), for the user and the whole system. */
export function pluginRoots(home: string): string[] {
  const out: string[] = []
  for (const base of ['/Library/Audio/Plug-Ins', join(home, 'Library/Audio/Plug-Ins')]) {
    for (const d of ['VST', 'VST3', 'Components']) out.push(join(base, d))
  }
  out.push('/Library/Application Support/Avid/Audio/Plug-Ins', join(home, 'Library/Application Support/Avid/Audio/Plug-Ins'))
  return out
}

/** Folders where plugins keep presets, caches and licenses. Anything inside is a candidate; the folders themselves are not. */
function supportRoots(home: string): string[] {
  const lib = join(home, 'Library')
  return [
    join(lib, 'Application Support'), join(lib, 'Preferences'), join(lib, 'Caches'), join(lib, 'Logs'), join(lib, 'Saved Application State'),
    '/Library/Application Support', '/Library/Preferences', '/Users/Shared', '/Applications'
  ]
}

function real(p: string): string {
  try { return realpathSync(p) } catch { return p }
}

/** realpath of the nearest existing ancestor plus the not-yet-existing remainder, so symlinks anywhere on the way are resolved. */
function resolveLoose(p: string): string {
  let rest = ''
  let cur = p
  for (;;) {
    try { return join(realpathSync(cur), rest) } catch {
      const up = dirname(cur)
      if (up === cur) return p
      rest = join(basename(cur), rest)
      cur = up
    }
  }
}

export function isRemovable(path: string, home: string, extraRoots: string[] = []): boolean {
  if (!isAbsolute(path) || path.split(sep).includes('..')) return false
  const target = resolveLoose(path)
  if (basename(target).startsWith('com.apple.')) return false
  const roots = [...pluginRoots(home), ...supportRoots(home), ...extraRoots]
  return roots.some((r) => {
    const rel = relative(real(r), target)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}
