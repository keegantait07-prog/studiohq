import type { Settings } from '../shared/types'

/** Paths and programs only ever change through a native dialog in the main process, so a compromised page can't point them anywhere. */
const DIALOG_ONLY = new Set<keyof Settings>(['claudePath', 'watchFolders', 'loopFolders', 'projectFolders', 'soundFolders', 'exportDir', 'ytImageFolder'])

/** Keeps only known settings of the right type from a renderer patch. */
export function cleanSettingsPatch(patch: unknown, current: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {}
  if (!patch || typeof patch !== 'object') return out
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in current) || DIALOG_ONLY.has(k as keyof Settings)) continue
    const was = current[k as keyof Settings]
    if (Array.isArray(was) ? Array.isArray(v) && v.every((x) => typeof x === 'string') : typeof v === typeof was) out[k] = v
  }
  return out as Partial<Settings>
}
