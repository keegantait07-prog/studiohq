// Groups the findings from "Check for problems" so they can be fixed in one go instead of one by one.
import type { FixKind, HealthFinding, HealthKind } from './types'

export interface FindingGroup {
  key: string
  kind: HealthKind
  fix: FixKind | null
  title: string
  /** Why these matter, in plain words. */
  blurb: string
  /** Exactly what applying the group does ('' when there is nothing to apply). */
  action: string
  /** Reversible and low-risk: included in "Clean up for me". */
  safe: boolean
  findings: HealthFinding[]
}

// Most useful first: what makes FL crash or say "not found" comes before the advisory checks.
const ORDER: HealthKind[] = ['crash', 'fl-error', 'stale-fl-db', 'broken-bundle', 'duplicate', 'quarantine', 'signature', 'arch', 'missing-content']

const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`
const plugins = (n: number) => many(n, 'plugin', 'plugins')

interface Copy { title: (n: number) => string; blurb: string; action: string; safe: boolean }
const COPY: Record<HealthKind, Copy> = {
  crash: { title: (n) => `${plugins(n)} named in FL crash reports`, safe: false,
    blurb: 'FL crashed with these loaded. Turning one off is the quickest way to test it.',
    action: 'Move them to the Disabled folder so FL stops loading them. Restore any of them later.' },
  'fl-error': { title: (n) => `${plugins(n)} with an unusual result in FL's list`, safe: true,
    blurb: 'FL recorded a scan flag it does not document. It matches plugins that fail to load, so these are the first to check.',
    action: "Back up FL's plugin list and reset these entries so FL re-scans them. Close FL Studio first." },
  'stale-fl-db': { title: (n) => `${plugins(n)} FL lists but you no longer have`, safe: true,
    blurb: 'FL still points at files that are gone. This is what produces "plugin not found".',
    action: "Back up FL's plugin list, then remove these entries. Close FL Studio first." },
  'broken-bundle': { title: (n) => many(n, 'broken install', 'broken installs'), safe: true,
    blurb: 'The plugin files are incomplete, so no host can load them.',
    action: 'Move them to the Trash.' },
  duplicate: { title: (n) => many(n, 'duplicate copy', 'duplicate copies'), safe: true,
    blurb: 'The same plugin is installed twice and FL may load the wrong one.',
    action: 'Move the older copy to the Disabled folder.' },
  quarantine: { title: (n) => `${plugins(n)} macOS has blocked`, safe: false,
    blurb: 'Downloaded plugins that macOS never approved can fail to load.',
    action: 'Remove the quarantine flag. Only do this for plugins you installed yourself.' },
  signature: { title: (n) => `${plugins(n)} with a signature problem`, safe: false,
    blurb: 'Apple Silicon can refuse to load plugins whose signature is invalid.',
    action: 'Re-sign them on this Mac. This changes the plugin files.' },
  arch: { title: (n) => `${plugins(n)} built for Intel only`, safe: false,
    blurb: "FL's plugin list does not show these as scanned OK.",
    action: 'Move them to the Disabled folder so FL stops trying to load them.' },
  'missing-content': { title: (n) => `${plugins(n)} missing content`, safe: false, blurb: 'The plugin is installed but its content is gone.', action: '' }
}

export function groupFindings(findings: HealthFinding[]): FindingGroup[] {
  const map = new Map<string, FindingGroup>()
  for (const f of findings) {
    const key = `${f.kind}:${f.fix ?? 'none'}`
    let g = map.get(key)
    if (!g) {
      const c = COPY[f.kind]
      // With no automatic fix there is nothing to apply, so the group says what to do by hand.
      g = f.fix
        ? { key, kind: f.kind, fix: f.fix, title: '', blurb: c.blurb, action: c.action, safe: c.safe, findings: [] }
        : { key, kind: f.kind, fix: null, title: '', blurb: f.kind === 'stale-fl-db' ? 'In FL: Options > Manage plugins > Find installed plugins, then refresh.' : c.blurb, action: '', safe: false, findings: [] }
      map.set(key, g)
    }
    g.findings.push(f)
  }
  for (const g of map.values()) {
    g.title = g.fix === null && g.kind === 'stale-fl-db' ? `${plugins(g.findings.length)} FL has not scanned yet` : COPY[g.kind].title(g.findings.length)
  }
  return [...map.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || Number(a.fix === null) - Number(b.fix === null))
}
