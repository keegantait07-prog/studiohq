import { useMemo, useState } from 'react'
import type { Beat } from '@shared/types'
import { addable } from './storeUtils'
import { errMsg } from './salesUtils'
import { X } from 'lucide-react'
import { Art, Button } from './salesUi'
import './sales.css'

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
    <div className="overlay sl-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal sl-dlg sm" aria-labelledby="sl-add" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <header><h2 id="sl-add" className="sl-disp">Add beats to the store</h2><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button></header>
        <div className="sl-bd">
          <p className="sl-help">Finished beats with audio that are not on the site yet. Adding does not publish; use Publish when you are ready.</p>
          <input className="sl-in" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title…" aria-label="Search beats" />
          <div className="sl-pick">
            {rows.map((b) => (
              <label key={b.id} className="sl-pick-row">
                <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} />
                <Art name={b.title} size={26} /><span className="sl-ell">{b.title}</span>
              </label>
            ))}
            {!rows.length && <div className="sl-empty"><b>{q ? 'No finished beats match.' : 'Every finished beat is already on the site.'}</b></div>}
          </div>
          {error && <div className="sl-note warn">{error}</div>}
        </div>
        <footer>
          <span className="sl-dim">{sel.size ? `${sel.size} picked` : 'Pick one or more beats'}</span>
          <div className="r"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!sel.size || busy} onClick={add}>{busy ? 'Adding…' : `Add ${sel.size || ''} beat${sel.size === 1 ? '' : 's'}`}</Button></div>
        </footer>
      </div>
    </div>
  )
}
