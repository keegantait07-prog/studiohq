import { useEffect, useMemo, useState } from 'react'
import type { Beat, ColumnMap, ImportField, ImportRead, ImportRowStatus } from '@shared/types'
import { BeatPicker } from './BeatPicker'
import { errMsg, money } from './salesUtils'
import { X } from 'lucide-react'
import { Button } from './salesUi'
import './sales.css'

const FIELD_LABEL: Record<ImportField, string> = {
  orderId: 'Order id', date: 'Date', title: 'Beat title', license: 'License', buyer: 'Buyer name', email: 'Buyer email', gross: 'Amount paid', fee: 'Fee', net: 'Amount you receive'
}
const FIELD_ORDER: ImportField[] = ['orderId', 'date', 'title', 'gross', 'license', 'buyer', 'email', 'fee', 'net']
const REQUIRED: ImportField[] = ['orderId', 'date', 'title', 'gross']
const STATUS_LABEL: Record<ImportRowStatus, string> = { new: 'New', duplicate: 'Already imported', unmatched: 'Unmatched', skipped: 'Skipped' }

/** Import a BeatStars sales export: match columns if needed, match beats, review, then write. Nothing is saved until Import. */
export function ImportSalesDialog({ path, beats, onClose, onDone }: { path: string; beats: Beat[]; onClose: () => void; onDone: (summary: string) => void }) {
  const [columns, setColumns] = useState<ColumnMap | undefined>(undefined)
  const [choices, setChoices] = useState<Record<number, number | null>>({})
  const [read, setRead] = useState<ImportRead | null>(null)
  const [map, setMap] = useState<ColumnMap>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forceMap, setForceMap] = useState(false)

  useEffect(() => {
    let live = true
    window.api.salesImportRead(path, columns, choices)
      .then((r) => { if (live) { setRead(r); setMap(r.columns); setError('') } })
      .catch((e) => { if (live) setError(errMsg(e)) })
    return () => { live = false }
  }, [path, columns, choices])

  const totals = useMemo(() => {
    const t = { new: 0, duplicate: 0, unmatched: 0, skipped: 0, gross: 0 }
    for (const r of read?.rows ?? []) { t[r.status]++; if (r.status === 'new') t.gross += r.price }
    return t
  }, [read])
  const mapped = REQUIRED.every((f) => map[f] != null)
  const apply = async () => {
    if (!read) return
    setBusy(true); setError('')
    try {
      const r = await window.api.salesImportApply(path, read.columns, choices)
      onDone(`Imported ${r.imported} sale${r.imported === 1 ? '' : 's'} from BeatStars.`)
    } catch (e) { setError(errMsg(e)); setBusy(false) }
  }

  return (
    <div className="overlay sl-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal sl-dlg lg" aria-labelledby="sl-imp" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <header><h2 id="sl-imp" className="sl-disp">Import BeatStars sales</h2><span className="sl-dim sl-ell">{path.split('/').pop()}</span><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button></header>
        <div className="sl-bd">
        {error && <div className="sl-note warn">{error}</div>}
        {!read && !error && <div className="sl-empty">Reading the file…</div>}

        {read && (read.missing.length > 0 || forceMap) && (
          <>
            <p className="sl-help">{forceMap ? 'Pick which column is which.' : 'Studio HQ could not tell which column is which. Pick them once and it remembers for next time.'}</p>
            <div className="sl-two">
              {FIELD_ORDER.map((f) => (
                <div className="sl-fld" key={f}>
                  <label htmlFor={`imp-${f}`}>{FIELD_LABEL[f]}{REQUIRED.includes(f) ? ' (required)' : ''}</label>
                  <select className="sl-in" id={`imp-${f}`} value={map[f] ?? ''} onChange={(e) => { const m = { ...map }; if (e.target.value === '') delete m[f]; else m[f] = +e.target.value; setMap(m) }}>
                    <option value="">— none —</option>
                    {read.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="sl-row-acts">
              <Button disabled={!mapped} onClick={() => { setColumns(map); setForceMap(false) }}>Continue</Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}

        {read && read.missing.length === 0 && !forceMap && (
          <>
            <div className="sl-imptab">
              <div className="sl-thead sl-im"><span>Status</span><span>Order</span><span>Beat title in file</span><span>Buyer</span><span className="r">Amount</span><span>Match</span></div>
              {read.rows.map((r) => (
                <div key={r.line} className="sl-row sl-im">
                  <span className={r.status === 'new' ? '' : r.status === 'unmatched' ? 'sl-warnc' : 'sl-dim'} title={r.reason}>{STATUS_LABEL[r.status]}{r.status === 'skipped' && r.reason ? ` · ${r.reason}` : ''}</span>
                  <span className="sl-dim sl-mono">{r.externalId}</span>
                  <span className="sl-ell" title={r.title}>{r.title}</span>
                  <span>{r.buyer}</span>
                  <span className="r sl-mono">{money(r.price)}</span>
                  <span>
                    {r.status === 'unmatched' && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <BeatPicker beats={beats} value={null} onChange={(id) => id != null && setChoices((c) => ({ ...c, [r.line]: id }))} />
                        <Button variant="outline" size="sm" onClick={() => setChoices((c) => ({ ...c, [r.line]: null }))}>Skip</Button>
                      </span>
                    )}
                    {r.status === 'new' && <span className="sl-dim">{beats.find((b) => b.id === r.beatId)?.title ?? ''}</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="sl-help" style={{ marginTop: 10 }}>
              {totals.new} new · {money(totals.gross)} · {totals.duplicate} already imported · {totals.unmatched} unmatched · {totals.skipped} skipped
            </p>
            <div className="sl-row-acts">
              <Button disabled={busy || totals.unmatched > 0 || totals.new === 0} onClick={apply}>{busy ? 'Importing…' : `Import ${totals.new} sale${totals.new === 1 ? '' : 's'}`}</Button>
              <Button variant="outline" onClick={() => setForceMap(true)}>Change columns</Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              {totals.unmatched > 0 && <span className="sl-dim">Match or skip every unmatched row to continue.</span>}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}
