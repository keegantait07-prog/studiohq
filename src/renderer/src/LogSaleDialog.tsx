import { useMemo, useState } from 'react'
import { SALE_SOURCES, type Beat, type Contact, type License, type Sale, type SaleSource } from '@shared/types'
import { displayKey } from '@shared/key'
import { errMsg, fmtDay, fromInputDate, money, toInputDate } from './salesUtils'
import { fmtBpm } from './format'

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
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && valid) save() }}>
        <header><h2>{edit ? 'Edit sale' : 'Log a sale'}</h2><button onClick={onClose}>Cancel</button></header>

        <div className="field"><label>Beat</label>
          {beat ? (
            <div className="folder"><span><b>{beat.title}</b> <span className="dim mono">{fmtBpm(beat.bpm)} {displayKey(beat.key)} · {beat.status}</span></span>{!edit && <button onClick={() => setBeatId(null)}>Change</button>}</div>
          ) : (
            <>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your beats…" />
              <div className="plist" style={{ height: 'auto', maxHeight: 200, marginTop: 6 }}>
                {results.map((b) => (
                  <div key={b.id} className="pitem" style={{ gridTemplateColumns: '1fr auto 10px' }} onClick={() => setBeatId(b.id)}>
                    <span className="pt">{b.title}</span><span className="mono dim">{fmtBpm(b.bpm)} {displayKey(b.key)}</span><span className={`dot st-${b.status}`} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {blocked && lock && <div className="notice err">🔒 “{beat?.title}” was sold exclusively to {lock.buyer} on {fmtDay(lock.soldAt)}. It can’t be sold again{!exclusive ? ' unless this sale happened before that date' : ''}.</div>}
        {!blocked && beat && groupSales.length > 0 && !edit && <div className="help">Already sold {groupSales.length}×: {groupSales.slice(0, 3).map((s) => `${s.licenseName} to ${s.buyer}`).join(', ')}{groupSales.length > 3 ? '…' : ''}</div>}

        <div className="two">
          <div className="field"><label>Buyer</label><input list="buyers" value={buyer} onChange={(e) => onBuyer(e.target.value)} /><datalist id="buyers">{buyerOptions.map((b) => <option key={b} value={b} />)}</datalist></div>
          <div className="field"><label>Buyer email (optional)</label><input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="two">
          <div className="field"><label>License</label>
            {edit ? <input value={edit.licenseName} readOnly /> : (
              <select value={licId} onChange={(e) => pickLicense(e.target.value)}>
                {licenses.map((l) => <option key={l.id} value={l.id}>{l.name}{l.exclusive ? ' (exclusive)' : ''}</option>)}
                <option value="custom">Custom…</option>
              </select>
            )}
          </div>
          <div className="field"><label>Source</label><select value={source} onChange={(e) => setSource(e.target.value as SaleSource)}>{SALE_SOURCES.map((s) => <option key={s} value={s}>{s === 'beatstars' ? 'BeatStars' : s === 'cashapp' ? 'Cash App' : s[0].toUpperCase() + s.slice(1)}</option>)}</select></div>
        </div>
        {!edit && licId === 'custom' && (
          <div className="two">
            <div className="field"><label>Custom license name</label><input value={customName} onChange={(e) => setCustomName(e.target.value)} /></div>
            <label className="check" style={{ marginTop: 22 }}><input type="checkbox" checked={customExcl} onChange={(e) => setCustomExcl(e.target.checked)} /> This is an exclusive</label>
          </div>
        )}
        <div className="three">
          <div className="field"><label>Price ($)</label><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="field"><label>Fees ($)</label><input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
          <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {!isNaN(p) && <div className="meta-line" style={{ marginTop: 6 }}>You keep {money(Math.max(0, p - f))}</div>}
        <div className="field"><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order #, terms, anything to remember" /></div>

        {exclusive && !edit && !blocked && <div className="notice">Exclusive: this marks “{beat?.title ?? 'the beat'}”{beat && beats.filter((b) => b.groupId === beat.groupId).length > 1 ? ` and its ${beats.filter((b) => b.groupId === beat.groupId).length - 1} other version(s)` : ''} as <b>sold</b> and blocks any future sale.</div>}
        {error && <div className="notice err">{error}</div>}
        <div className="draft-actions"><span className="flash" /><button className="primary" disabled={!valid || busy} onClick={save}>{edit ? 'Save' : exclusive ? 'Log exclusive · lock beat' : 'Log sale'} <kbd>⌘↵</kbd></button></div>
      </div>
    </div>
  )
}
