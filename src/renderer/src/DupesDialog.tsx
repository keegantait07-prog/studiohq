import { useEffect, useMemo, useState } from 'react'
import type { DupGroup } from '@shared/types'
import { errMsg } from './salesUtils'

const fmt = (n: number) => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB')

export function DupesDialog({ roots, onClose, onDone }: { roots: string[]; onClose: () => void; onDone: (m: string) => void }) {
  const [groups, setGroups] = useState<DupGroup[] | null>(null)
  const [error, setError] = useState('')
  const [trash, setTrash] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.soundsDuplicates().then(setGroups).catch((e) => setError(errMsg(e)))
  }, [])

  const rel = (p: string) => { const r = roots.find((x) => p.startsWith(x)); return r ? p.slice(r.length + 1) : p }
  const extra = useMemo(() => (groups ?? []).reduce((a, g) => a + g.files.length - 1, 0), [groups])
  const reclaim = useMemo(() => (groups ?? []).reduce((a, g) => a + g.files.filter((f) => trash.has(f.id)).length * g.size, 0), [groups, trash])
  /** Tick every copy except one per group. A favorite always wins; otherwise `rule` decides which copy stays. */
  const selectExtras = (rule: 'shortest' | 'oldest') => {
    const t = new Set<number>()
    for (const g of groups ?? []) {
      const pool = g.files.filter((f) => f.fav).length ? g.files.filter((f) => f.fav) : g.files
      const keep = [...pool].sort((a, b) => (rule === 'shortest' ? a.path.length - b.path.length : a.mtime - b.mtime))[0]
      g.files.forEach((f) => { if (f.id !== keep.id) t.add(f.id) })
    }
    setTrash(t)
  }
  const flip = (g: DupGroup, id: number) => setTrash((p) => {
    const n = new Set(p)
    if (n.has(id)) n.delete(id)
    else if (g.files.some((f) => f.id !== id && !n.has(f.id))) n.add(id) // never mark every copy: one must stay
    return n
  })

  const go = async () => {
    if (!trash.size) return
    if (!confirm(`Move ${trash.size} duplicate file${trash.size > 1 ? 's' : ''} (${fmt(reclaim)}) to the Trash?\n\nThey stay in the Trash until you empty it, so you can put them back.`)) return
    setBusy(true)
    try { const n = await window.api.soundsTrash([...trash]); onDone(`Moved ${n} duplicate${n === 1 ? '' : 's'} to the Trash`) } catch (e) { setError(errMsg(e)); setBusy(false) }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal splits" style={{ width: 'min(900px, 94vw)' }} onMouseDown={(e) => e.stopPropagation()}>
        <header><h2>Duplicate sounds</h2><button onClick={onClose}>Close</button></header>
        {!groups && !error && <p className="help">Comparing files that have the same size… this can take a few seconds on a big library.</p>}
        {error && <div className="notice err">{error}</div>}
        {groups && (
          <>
            <p className="help">{groups.length} group{groups.length === 1 ? '' : 's'} of identical files · {extra} extra cop{extra === 1 ? 'y' : 'ies'}. Files with identical audio are matched byte for byte. Nothing is ticked yet. Tick copies yourself, or let it tick all but one per group (a favorite is always the one kept). At least one copy per group always stays.</p>
            {!!groups.length && <div className="draft-actions" style={{ marginTop: 0 }}><button onClick={() => selectExtras('oldest')}>Tick extras, keep the oldest copy</button><button onClick={() => selectExtras('shortest')}>Tick extras, keep the shortest path</button><button onClick={() => setTrash(new Set())}>Clear</button></div>}
            <div className="dgroups">
              {groups.map((g) => (
                <div key={g.hash} className="dgroup">
                  <div className="dh dim">{fmt(g.size)} · {g.files.length} copies</div>
                  {g.files.map((f) => (
                    <label key={f.id} className={`dfile ${trash.has(f.id) ? 'tr' : ''}`}>
                      <input type="checkbox" checked={trash.has(f.id)} onChange={() => flip(g, f.id)} />
                      <span title={f.path}>{f.fav ? '★ ' : ''}{rel(f.path)}</span>
                      <span className="dim">{trash.has(f.id) ? 'Trash' : ''}</span>
                    </label>
                  ))}
                </div>
              ))}
              {!groups.length && <div className="empty">No duplicates. Nice and tidy.</div>}
            </div>
            <div className="draft-actions"><span className="flash dim">{trash.size ? `${trash.size} file${trash.size > 1 ? 's' : ''} · ${fmt(reclaim)} to reclaim` : ''}</span><button className="primary" disabled={!trash.size || busy} onClick={go}>Move {trash.size || ''} to Trash</button></div>
          </>
        )}
      </div>
    </div>
  )
}
