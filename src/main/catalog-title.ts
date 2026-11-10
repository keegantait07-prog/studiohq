// Turns a Vault file title into the name shown on the public site. Kept apart from catalog.ts so it needs no Electron.
export function siteTitle(t: string): string {
  let s = t.replace(/\[\s*\]/g, '').replace(/\(.*?\)/g, '').replace(/@\S+/g, '').trim()
  s = s.replace(/\s+\d{2,3}$/, '').replace(/\s+[A-G][#b]?m$/, '').replace(/^\d+\s+/, '').replace(/\s{2,}/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : t
}
