import { useMemo, useState } from 'react'
import type { License, Sale, SalesData } from '@shared/types'
import { Revenue } from './Revenue'
import { errMsg, fmtDay, money, net } from './salesUtils'

interface Props {
  data: SalesData
  query: string
  onQuery: (q: string) => void
  onLog: () => void
  onEdit: (s: Sale) => void
  onSplits: (g: { groupId: number; title: string }) => void
  onSheet: (groupId: number) => void
  onOpenBeat: (id: number) => void
  reload: () => void
  toast: (m: string) => void
}

export function SalesView(p: Props) {
  const [tab, setTab] = useState<'sales' | 'revenue' | 'collabs' | 'licenses'>('sales')
  const { data } = p
  return (
    <section className="sales">
      <div className="sales-head">
        <h2>Sales & Collabs</h2>
        <div className="seg" style={{ width: 'auto' }}>
          {([['sales', 'Sales'], ['revenue', 'Revenue'], ['collabs', 'Collabs & splits'], ['licenses', 'Licenses']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="grow" />
        {tab === 'sales' && <button onClick={async () => { try { const f = await window.api.exportSalesCsv(); if (f) p.toast(`Exported ${f.split('/').pop()}`) } catch (e) { p.toast(errMsg(e)) } }}>Export CSV</button>}
        <button className="primary" onClick={p.onLog}>+ Log sale</button>
      </div>
      <div className="sales-body">
        {tab === 'sales' && <SalesTable {...p} />}
        {tab === 'revenue' && <Revenue sales={data.sales} />}
        {tab === 'collabs' && <Collabs {...p} />}
        {tab === 'licenses' && <Licenses licenses={data.licenses} reload={p.reload} toast={p.toast} />}
      </div>
    </section>
  )
}

function SalesTable({ data, query, onQuery, onEdit, onOpenBeat, reload, toast }: Props) {
  const [exclOnly, setExclOnly] = useState(false)
  const q = query.trim().toLowerCase()
  const rows = useMemo(() => data.sales.filter((s) => (!exclOnly || s.exclusive) && (!q || [s.beatTitle, s.buyer, s.licenseName, s.source, s.notes].join(' ').toLowerCase().includes(q))), [data.sales, q, exclOnly])
  const total = rows.reduce((a, s) => a + s.price, 0)
  const fees = rows.reduce((a, s) => a + s.fee, 0)
  return (
    <>
      <div className="subbar" style={{ padding: '0 0 10px' }}>
        <input style={{ maxWidth: 340 }} value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search beat, buyer, license…" />
        <label className="check small"><input type="checkbox" checked={exclOnly} onChange={(e) => setExclOnly(e.target.checked)} /> Exclusives only</label>
        <div className="grow" />
        <span className="dim">{rows.length} sale{rows.length === 1 ? '' : 's'} · {money(total)} gross{fees > 0 ? ` · ${money(total - fees)} net` : ''}</span>
      </div>
      <div className="stable">
        <div className="srow shead"><span>Date</span><span>Beat</span><span>Buyer</span><span>License</span><span>Source</span><span className="r">Price</span><span className="r">Net</span><span /></div>
        {rows.map((s) => (
          <div key={s.id} className="srow">
            <span className="dim">{fmtDay(s.soldAt)}</span>
            <span className="st-title"><a onClick={() => onOpenBeat(s.beatId)}>{s.beatTitle}</a></span>
            <span title={s.buyerEmail}>{s.buyer}</span>
            <span>{s.exclusive ? <em className="excl">🔒 {s.licenseName}</em> : s.licenseName}</span>
            <span className="dim" style={{ textTransform: 'capitalize' }}>{s.source === 'beatstars' ? 'BeatStars' : s.source === 'cashapp' ? 'Cash App' : s.source}</span>
            <span className="r mono">{money(s.price)}</span>
            <span className="r mono dim">{money(net(s))}</span>
            <span className="sact"><button onClick={() => onEdit(s)}>Edit</button><button className="x" title="Delete" onClick={async () => {
              const warn = s.exclusive ? `\n\nThis was an exclusive. Deleting it unlocks “${s.beatTitle}” and sets it back to finished.` : ''
              if (!confirm(`Delete the ${money(s.price)} sale of “${s.beatTitle}” to ${s.buyer}?${warn}`)) return
              try { await window.api.deleteSale(s.id); reload() } catch (e) { toast(errMsg(e)) }
            }}>×</button></span>
          </div>
        ))}
        {!rows.length && <div className="empty">{data.sales.length ? 'No sales match.' : 'No sales yet. Log your first lease or exclusive.'}</div>}
      </div>
    </>
  )
}

function Collabs({ data, onSplits, onSheet }: Props) {
  const [f, setF] = useState<'with' | 'attention' | 'none' | 'all'>('with')
  const [q, setQ] = useState('')
  const status = (g: SalesData['groups'][number]) => {
    if (!g.parties) return { k: 'none', label: 'No splits' }
    const ok = Math.abs(g.pubTotal - 100) < 0.01 && Math.abs(g.masterTotal - 100) < 0.01
    if (!ok) return { k: 'bad', label: `Incomplete · ${g.pubTotal}% / ${g.masterTotal}%` }
    return g.sheetAt ? { k: 'sheet', label: `Sheet made ${fmtDay(g.sheetAt)}` } : { k: 'ok', label: 'Complete · no sheet yet' }
  }
  const rows = data.groups.filter((g) => {
    const s = status(g).k
    if (q && !g.title.toLowerCase().includes(q.toLowerCase())) return false
    return f === 'all' ? true : f === 'none' ? s === 'none' : f === 'with' ? s !== 'none' : s === 'bad' || s === 'ok'
  })
  return (
    <>
      <div className="subbar" style={{ padding: '0 0 10px' }}>
        <input style={{ maxWidth: 300 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a beat…" />
        <div className="tabs">{([['with', 'With splits'], ['attention', 'Needs attention'], ['none', 'No splits yet'], ['all', 'All']] as const).map(([k, l]) => <button key={k} className={`tab ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{l}</button>)}</div>
      </div>
      <div className="stable">
        <div className="crow2 shead"><span>Beat</span><span>Status</span><span /></div>
        {rows.map((g) => {
          const s = status(g)
          return (
            <div key={g.groupId} className="crow2">
              <span className="st-title">{g.title}{g.count > 1 && <em className="ver-badge">{g.count} versions</em>}</span>
              <span className={`spst ${s.k}`}>{s.label}</span>
              <span className="sact"><button onClick={() => onSplits({ groupId: g.groupId, title: g.title })}>{g.parties ? 'Edit splits' : 'Add splits'}</button>{(s.k === 'ok' || s.k === 'sheet') && <button className="primary" onClick={() => onSheet(g.groupId)}>{s.k === 'sheet' ? 'Re-create PDF' : 'Create PDF'}</button>}</span>
            </div>
          )
        })}
        {!rows.length && <div className="empty">{f === 'with' ? 'No beats have splits yet. Open “No splits yet” and add some, or use Add splits from a beat in the Vault.' : 'Nothing here.'}</div>}
      </div>
    </>
  )
}

function Licenses({ licenses, reload, toast }: { licenses: License[]; reload: () => void; toast: (m: string) => void }) {
  const save = async (l: Partial<License> & { name: string; exclusive: boolean }) => { try { await window.api.saveLicense(l); reload() } catch (e) { toast(errMsg(e)) } }
  return (
    <div style={{ maxWidth: 640 }}>
      <p className="help">The license types you offer. Prices are suggestions and fill in when you log a sale; you can always override them. Past sales keep the name they were sold under.</p>
      <div className="lic-grid shead"><span>Name</span><span>Default price</span><span>Exclusive</span><span /></div>
      {licenses.map((l) => <LicenseRow key={l.id} l={l} save={save} reload={reload} />)}
      <button style={{ marginTop: 10 }} onClick={() => save({ name: 'New license', exclusive: false, defaultPrice: 50 })}>+ Add license</button>
    </div>
  )
}
function LicenseRow({ l, save, reload }: { l: License; save: (l: Partial<License> & { name: string; exclusive: boolean }) => void; reload: () => void }) {
  const [name, setName] = useState(l.name)
  const [price, setPrice] = useState(l.defaultPrice == null ? '' : String(l.defaultPrice))
  return (
    <div className="lic-grid">
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== l.name && save({ ...l, name })} />
      <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={() => save({ ...l, defaultPrice: price === '' ? null : parseFloat(price) || 0 })} />
      <input type="checkbox" checked={l.exclusive} onChange={(e) => save({ ...l, exclusive: e.target.checked })} style={{ width: 'auto' }} />
      <button className="x" onClick={async () => { if (confirm(`Remove “${l.name}”? Past sales keep their license name.`)) { await window.api.deleteLicense(l.id); reload() } }}>×</button>
    </div>
  )
}
