import { useMemo, useState } from 'react'
import { SALE_SOURCES, type Beat, type Contact, type License, type Sale, type SaleSource } from '@shared/types'
import { clickable } from './a11y'
import { displayKey } from '@shared/key'
import { errMsg, fmtDay, fromInputDate, money, toInputDate } from './salesUtils'
import { fmtBpm } from './format'
import { Button } from './salesUi'
import './sales.css'

interface Props {
  beats: Beat[]
  sales: Sale[]
  licenses: License[]
  contacts: Contact[]
  beatId?: number
  edit?: Sale
  onClose: () => void
  onSaved: (msg: string) => void
}

export function LogSaleDialog({ beats, sales, licenses, contacts, beatId: b0, edit, onClose, onSaved }: Props) {
  const [beatId, setBeatId] = useState<number | null>(edit?.beatId ?? b0 ?? null)
  const [q, setQ] = useState('')
  const first = licenses.find((l) => !l.exclusive) ?? licenses[0]
  const [licId, setLicId] = useState<number | 'custom'>(first?.id ?? 'custom')
  const [customName, setCustomName] = useState('')
  const [customExcl, setCustomExcl] = useState(false)
  const [buyer, setBuyer] = useState(edit?.buyer ?? '')
  const [email, setEmail] = useState(edit?.buyerEmail ?? '')
  const [price, setPrice] = useState(edit ? String(edit.price) : first?.defaultPrice != null ? String(first.defaultPrice) : '')
  const [fee, setFee] = useState(edit ? String(edit.fee) : '0')
  const [source, setSource] = useState<SaleSource>(edit?.source ?? 'beatstars')
  const [date, setDate] = useState(toInputDate(edit?.soldAt ?? Date.now()))
  const [notes, setNotes] = useState(edit?.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const lic = typeof licId === 'number' ? licenses.find((l) => l.id === licId) : undefined
  const exclusive = edit ? edit.exclusive : lic ? lic.exclusive : customExcl
  const licenseName = edit ? edit.licenseName : lic ? lic.name : customName
  const beat = beats.find((b) => b.id === beatId)
  const groupSales = beat ? sales.filter((s) => s.groupId === beat.groupId && s.id !== edit?.id) : []
  const lock = groupSales.find((s) => s.exclusive)
  const soldAt = date ? fromInputDate(date) : NaN
  const blocked = !edit && !!lock && (exclusive || lock.soldAt <= soldAt)

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (s ? beats.filter((b) => b.title.toLowerCase().includes(s) || b.filename.toLowerCase().includes(s)) : beats).slice(0, 7)
  }, [beats, q])
  const buyerOptions = useMemo(() => [...new Set([...contacts.map((c) => c.name), ...sales.map((s) => s.buyer)])], [contacts, sales])

  const pickLicense = (v: string) => {
    const id = v === 'custom' ? 'custom' : +v
    setLicId(id)
    const l = typeof id === 'number' ? licenses.find((x) => x.id === id) : undefined
    if (l?.defaultPrice != null) setPrice(String(l.defaultPrice))
  }
  const onBuyer = (v: string) => {
    setBuyer(v)
    const c = contacts.find((x) => x.name.toLowerCase() === v.trim().toLowerCase())
    if (c?.email && !email) setEmail(c.email)
  }

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      if (edit) {
        await window.api.updateSale(edit.id, { buyer, buyerEmail: email, price: parseFloat(price), fee: parseFloat(fee) || 0, source, soldAt, notes })
        onSaved('Sale updated')
      } else {
        const contact = contacts.find((c) => c.name.toLowerCase() === buyer.trim().toLowerCase())
        await window.api.logSale({
          beatId: beatId!, buyer, buyerEmail: email, contactId: contact?.id ?? null, licenseId: lic?.id ?? null, licenseName,
          exclusive, price: parseFloat(price), fee: parseFloat(fee) || 0, source, soldAt, notes
        })
        onSaved(exclusive ? `“${beat?.title}” is now SOLD and locked` : `Logged ${money(parseFloat(price))} for “${beat?.title}”`)
      }
    } catch (e) {
      setError(errMsg(e))
    }
    setBusy(false)
  }

  const p = parseFloat(price), f = parseFloat(fee) || 0
  const valid = !!beatId && !!buyer.trim() && p >= 0 && !isNaN(p) && f >= 0 && f <= p && !!date && !!licenseName.trim() && !blocked

  return (
    <div className="overlay sl-scrim" onMouseDown={onClose}>
      <div className="modal sl-dlg sm" aria-labelledby="sl-log" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && valid) save() }}>
        <header><h2 id="sl-log" className="sl-disp">{edit ? 'Edit sale.' : 'Log a sale.'}</h2><Button variant="ghost" size="sm" onClick={onClose} aria-label="Cancel">Cancel</Button></header>
        <div className="sl-bd">

        <div className="sl-fld"><label>Beat</label>
          {beat ? (
            <div className="sl-picked"><span><b>{beat.title}</b> <span className="sl-dim sl-mono">{fmtBpm(beat.bpm)} {displayKey(beat.key)} · {beat.status}</span></span>{!edit && <Button variant="outline" size="sm" onClick={() => setBeatId(null)}>Change</Button>}</div>
          ) : (
            <>
              <input className="sl-in" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your beats…" />
              <div className="sl-pick">
                {results.map((b) => (
                  <div key={b.id} className="sl-pick-row" {...clickable(() => setBeatId(b.id))}>
                    <span className="sl-ell">{b.title}</span><span className="sl-mono sl-dim">{fmtBpm(b.bpm)} {displayKey(b.key)}</span><span className={`sl-dot st-${b.status}`} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {blocked && lock && <div className="sl-note warn">🔒 “{beat?.title}” was sold exclusively to {lock.buyer} on {fmtDay(lock.soldAt)}. It can’t be sold again{!exclusive ? ' unless this sale happened before that date' : ''}.</div>}
        {!blocked && beat && groupSales.length > 0 && !edit && <div className="sl-help">Already sold {groupSales.length}×: {groupSales.slice(0, 3).map((s) => `${s.licenseName} to ${s.buyer}`).join(', ')}{groupSales.length > 3 ? '…' : ''}</div>}

        <div className="sl-two">
          <div className="sl-fld"><label>Buyer</label><input className="sl-in" list="buyers" value={buyer} onChange={(e) => onBuyer(e.target.value)} /><datalist id="buyers">{buyerOptions.map((b) => <option key={b} value={b} />)}</datalist></div>
          <div className="sl-fld"><label>Buyer email (optional)</label><input className="sl-in" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="sl-two">
          <div className="sl-fld"><label>License</label>
            {edit ? <input className="sl-in" value={edit.licenseName} readOnly /> : (
              <div className="sl-chips" role="radiogroup" aria-label="License">
                {licenses.map((l) => <button type="button" role="radio" aria-checked={licId === l.id} key={l.id} className={`sl-chip${licId === l.id ? ' on' : ''}`} onClick={() => pickLicense(String(l.id))}>{l.name}{l.exclusive ? ' · excl.' : ''}</button>)}
                <button type="button" role="radio" aria-checked={licId === 'custom'} className={`sl-chip${licId === 'custom' ? ' on' : ''}`} onClick={() => pickLicense('custom')}>Custom…</button>
              </div>
            )}
          </div>
          <div className="sl-fld"><label>Source</label><div className="sl-chips" role="radiogroup" aria-label="Source">{SALE_SOURCES.map((x) => <button type="button" role="radio" aria-checked={source === x} key={x} className={`sl-chip${source === x ? ' on' : ''}`} onClick={() => setSource(x)}>{x === 'beatstars' ? 'BeatStars' : x === 'cashapp' ? 'Cash App' : x[0].toUpperCase() + x.slice(1)}</button>)}</div></div>
        </div>
        {!edit && licId === 'custom' && (
          <div className="sl-two">
            <div className="sl-fld"><label>Custom license name</label><input className="sl-in" value={customName} onChange={(e) => setCustomName(e.target.value)} /></div>
            <label className="sl-chk"><input type="checkbox" checked={customExcl} onChange={(e) => setCustomExcl(e.target.checked)} /> This is an exclusive</label>
          </div>
        )}
        <div className="sl-three">
          <div className="sl-fld"><label>Price ($)</label><input className="sl-in" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="sl-fld"><label>Fees ($)</label><input className="sl-in" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
          <div className="sl-fld"><label>Date</label><input className="sl-in" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {!isNaN(p) && <div className="sl-help">You keep {money(Math.max(0, p - f))}</div>}
        <div className="sl-fld"><label>Notes</label><input className="sl-in" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order #, terms, anything to remember" /></div>

        {exclusive && !edit && !blocked && <div className="sl-note">Exclusive: this marks “{beat?.title ?? 'the beat'}”{beat && beats.filter((b) => b.groupId === beat.groupId).length > 1 ? ` and its ${beats.filter((b) => b.groupId === beat.groupId).length - 1} other version(s)` : ''} as <b>sold</b> and blocks any future sale.</div>}
        {error && <div className="sl-note warn">{error}</div>}
        </div>
        <footer><span /><div className="r"><Button disabled={!valid || busy} onClick={save}>{edit ? 'Save' : exclusive ? 'Log exclusive · lock beat' : 'Log sale'} <kbd>⌘↵</kbd></Button></div></footer>
      </div>
    </div>
  )
}
