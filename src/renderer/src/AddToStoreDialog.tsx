import { useMemo, useState } from 'react'
import type { Beat } from '@shared/types'
import { addable } from './storeUtils'
import { errMsg } from './salesUtils'

/** Pick several finished beats to put on the public site. Adding does not publish. */
export function AddToStoreDialog({ beats, onSite, onClose, onAdded }: { beats: Beat[]; onSite: Set<number>; onClose: () => void; onAdded: (n: number) => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rows = useMemo(() => addable(beats, onSite, q), [beats, onSite, q])
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const add = async () => {
    setBusy(true); setError('')
    try { onAdded(await window.api.siteAddMany([...sel])) } catch (e) { setError(errMsg(e)); setBusy(false) }
  }
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal wide-modal" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <header><h2>Add beats to the store</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <p className="help">Finished beats with audio that are not on the site yet. Adding does not publish; use Publish when you are ready.</p>
        <div className="field"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title…" aria-label="Search beats" /></div>
        <div className="stable addstore-grid" style={{ maxHeight: 320, overflowY: 'auto', marginTop: 10 }}>
          {rows.map((b) => (
            <label key={b.id} className="srow addstore-row">
              <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} style={{ width: 'auto' }} />
              <span className="st-title">{b.title}</span>
            </label>
          ))}
          {!rows.length && <div className="empty">{q ? 'No finished beats match.' : 'Every finished beat is already on the site.'}</div>}
        </div>
        {error && <div className="meta-line warn">{error}</div>}
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!sel.size || busy} onClick={add}>{busy ? 'Adding…' : `Add ${sel.size || ''} beat${sel.size === 1 ? '' : 's'}`}</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
