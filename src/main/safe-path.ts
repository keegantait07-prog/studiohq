import { isAbsolute, resolve, sep } from 'path'

/** True when `path` is the root itself or sits inside it. Compares whole path segments, so "/a/bc" is not inside "/a/b". */
export function isInside(path: string, root: string): boolean {
  if (typeof path !== 'string' || typeof root !== 'string' || !root) return false
  if (!isAbsolute(path) || !isAbsolute(root)) return false
  const p = resolve(path)
  const r = resolve(root)
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep)
}

/** True when the renderer-supplied path is inside one of the folders the app already knows about. */
export function isKnownPath(path: unknown, roots: string[]): path is string {
  return typeof path === 'string' && roots.some((r) => isInside(path, r))
}

/** Only these URLs may be opened in an external browser; anything else the window tries to open is dropped. */
export function isExternalUrl(url: string): boolean {
  return /^(https?|mailto):/i.test(url)
}

/** The window may only ever show the app's own renderer (dev server or bundled file). */
export function isAppUrl(url: string, devUrl: string | undefined): boolean {
  if (devUrl) return url === devUrl || url.startsWith(devUrl.endsWith('/') ? devUrl : devUrl + '/')
  return url.startsWith('file://')
}
