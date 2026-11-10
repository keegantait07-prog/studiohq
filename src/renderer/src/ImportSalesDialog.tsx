import { useEffect, useMemo, useState } from 'react'
import type { Beat, ColumnMap, ImportField, ImportRead, ImportRowStatus } from '@shared/types'
import { BeatPicker } from './BeatPicker'
import { errMsg, money } from './salesUtils'

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
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal wide-modal" style={{ width: 'min(920px, 94vw)' }} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <header><h2>Import BeatStars sales</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <p className="help">{path.split('/').pop()}</p>
        {error && <div className="meta-line warn">{error}</div>}
        {!read && !error && <div className="empty">Reading the file…</div>}

        {read && (read.missing.length > 0 || forceMap) && (
          <>
            <p className="help">{forceMap ? 'Pick which column is which.' : 'Studio HQ could not tell which column is which. Pick them once and it remembers for next time.'}</p>
            <div className="two">
              {FIELD_ORDER.map((f) => (
                <div className="field" key={f}>
                  <label htmlFor={`imp-${f}`}>{FIELD_LABEL[f]}{REQUIRED.includes(f) ? ' (required)' : ''}</label>
                  <select id={`imp-${f}`} value={map[f] ?? ''} onChange={(e) => { const m = { ...map }; if (e.target.value === '') delete m[f]; else m[f] = +e.target.value; setMap(m) }}>
                    <option value="">— none —</option>
                    {read.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="primary" disabled={!mapped} onClick={() => { setColumns(map); setForceMap(false) }}>Continue</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {read && read.missing.length === 0 && !forceMap && (
          <>
            <div className="stable import-grid" style={{ maxHeight: 340, overflowY: 'auto' }}>
              <div className="srow shead import-grid"><span>Status</span><span>Order</span><span>Beat title in file</span><span>Buyer</span><span className="r">Amount</span><span>Match</span></div>
              {read.rows.map((r) => (
                <div key={r.line} className="srow import-grid">
                  <span className={r.status === 'new' ? '' : r.status === 'unmatched' ? 'excl' : 'dim'} title={r.reason}>{STATUS_LABEL[r.status]}{r.status === 'skipped' && r.reason ? ` · ${r.reason}` : ''}</span>
                  <span className="dim mono">{r.externalId}</span>
                  <span className="st-title" title={r.title}>{r.title}</span>
                  <span>{r.buyer}</span>
                  <span className="r mono">{money(r.price)}</span>
                  <span>
                    {r.status === 'unmatched' && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <BeatPicker beats={beats} value={null} onChange={(id) => id != null && setChoices((c) => ({ ...c, [r.line]: id }))} />
                        <button onClick={() => setChoices((c) => ({ ...c, [r.line]: null }))}>Skip</button>
                      </span>
                    )}
                    {r.status === 'new' && <span className="dim">{beats.find((b) => b.id === r.beatId)?.title ?? ''}</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="help" style={{ marginTop: 10 }}>
              {totals.new} new · {money(totals.gross)} · {totals.duplicate} already imported · {totals.unmatched} unmatched · {totals.skipped} skipped
            </p>
            <div className="actions">
              <button className="primary" disabled={busy || totals.unmatched > 0 || totals.new === 0} onClick={apply}>{busy ? 'Importing…' : `Import ${totals.new} sale${totals.new === 1 ? '' : 's'}`}</button>
              <button onClick={() => setForceMap(true)}>Change columns</button>
              <button onClick={onClose}>Cancel</button>
              {totals.unmatched > 0 && <span className="dim">Match or skip every unmatched row to continue.</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
