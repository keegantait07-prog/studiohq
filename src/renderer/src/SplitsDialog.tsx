import { useEffect, useState } from 'react'
import { SPLIT_ROLES, type SplitRole, type SplitRow } from '@shared/types'
import { errMsg } from './salesUtils'
import { Button } from './salesUi'
import './sales.css'

const blank = (): SplitRow => ({ name: '', role: 'producer', email: '', pro: '', ipi: '', pubPct: 0, masterPct: 0 })
const r2 = (n: number) => Math.round(n * 100) / 100
const fmt = (n: number) => String(r2(n))

export function SplitsDialog({ groupId, title, producerName, onClose, onDone }: { groupId: number; title: string; producerName: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [rows, setRows] = useState<SplitRow[]>([])
  const [known, setKnown] = useState<SplitRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.getSplits(groupId).then(({ rows: r, known: k }) => {
      setRows(r.length ? r : [{ ...blank(), name: producerName, pubPct: 100, masterPct: 100 }])
      setKnown(k)
      setLoaded(true)
    })
  }, [groupId, producerName])

  const set = (i: number, patch: Partial<SplitRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setPub = (i: number, v: number) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, pubPct: v, masterPct: r.masterPct === r.pubPct ? v : r.masterPct } : r)))
  const setName = (i: number, name: string) => {
    const k = known.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    set(i, k ? { name, email: rows[i].email || k.email, pro: rows[i].pro || k.pro, ipi: rows[i].ipi || k.ipi, role: rows[i].name ? rows[i].role : k.role } : { name })
  }
  const evenly = () => {
    const n = rows.length
    const base = Math.floor((10000 / n)) / 100
    setRows((rs) => rs.map((r, i) => { const v = i === n - 1 ? r2(100 - base * (n - 1)) : base; return { ...r, pubPct: v, masterPct: v } }))
  }
  const pub = rows.reduce((a, r) => a + r.pubPct, 0), master = rows.reduce((a, r) => a + r.masterPct, 0)
  const okPub = Math.abs(pub - 100) < 0.01, okMaster = Math.abs(master - 100) < 0.01
  const named = rows.filter((r) => r.name.trim())
  const canSheet = named.length >= 2 && okPub && okMaster

  const save = async (pdf: boolean) => {
    setError(''); setBusy(true)
    try {
      await window.api.saveSplits(groupId, rows)
      if (pdf) {
        const path = await window.api.exportSplitSheet(groupId)
        onDone(path ? `Split sheet saved: ${path.split('/').pop()}` : 'Splits saved')
      } else onDone('Splits saved')
    } catch (e) { setError(errMsg(e)) }
    setBusy(false)
  }

  if (!loaded) return null
  const tot = (v: number, ok: boolean) => <span className={ok ? 'sl-okc' : 'sl-badc'}>{fmt(v)}%{!ok && ` (${v < 100 ? fmt(100 - v) + ' left' : fmt(v - 100) + ' over'})`}</span>
  return (
    <div className="overlay sl-scrim" onMouseDown={onClose}>
      <div className="modal sl-dlg lg" aria-labelledby="sl-sp" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <header><h2 id="sl-sp" className="sl-disp">Splits · {title}</h2><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button></header>
        <div className="sl-bd">
        <p className="sl-help">Applies to every version of this beat. Publishing is the composition; master is the recording. Master follows publishing until you change it.</p>
        <datalist id="collabs">{known.map((k) => <option key={k.name} value={k.name} />)}</datalist>
        <div className="sl-sp-grid sl-thead"><span>Name</span><span>Role</span><span>Email</span><span>PRO</span><span>IPI</span><span className="r">Pub %</span><span className="r">Master %</span><span /></div>
        {rows.map((r, i) => (
          <div key={i} className="sl-sp-grid">
            <input className="sl-in" list="collabs" value={r.name} placeholder="Name" onChange={(e) => setName(i, e.target.value)} />
            <select className="sl-in" value={r.role} onChange={(e) => set(i, { role: e.target.value as SplitRole })}>{SPLIT_ROLES.map((x) => <option key={x}>{x}</option>)}</select>
            <input className="sl-in" value={r.email} placeholder="email" onChange={(e) => set(i, { email: e.target.value })} />
            <input className="sl-in" value={r.pro} placeholder="ASCAP…" onChange={(e) => set(i, { pro: e.target.value })} />
            <input className="sl-in" value={r.ipi} placeholder="IPI" onChange={(e) => set(i, { ipi: e.target.value })} />
            <input className="sl-in r" inputMode="decimal" value={r.pubPct || ''} placeholder="0" onChange={(e) => setPub(i, parseFloat(e.target.value) || 0)} />
            <input className="sl-in r" inputMode="decimal" value={r.masterPct || ''} placeholder="0" onChange={(e) => set(i, { masterPct: parseFloat(e.target.value) || 0 })} />
            <Button variant="ghost" size="icon-sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="remove">×</Button>
          </div>
        ))}
        <div className="sl-sp-grid sl-sp-total"><span style={{ gridColumn: '1 / 6' }}>Total</span><span className="r">{tot(pub, okPub)}</span><span className="r">{tot(master, okMaster)}</span><span /></div>
        <div className="sl-row-acts">
          <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blank()])}>+ Add person</Button>
          {producerName && !rows.some((r) => r.name.trim().toLowerCase() === producerName.toLowerCase()) && <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { ...blank(), name: producerName }])}>+ Add me</Button>}
          <Button variant="outline" size="sm" onClick={evenly}>Split evenly</Button>
        </div>
        {error && <div className="sl-note warn">{error}</div>}
        {!canSheet && <div className="sl-help">To create the PDF: two or more named people, and both columns at exactly 100%.</div>}
        </div>
        <footer>
          <span />
          <div className="r"><Button variant="outline" disabled={busy} onClick={() => save(false)}>Save</Button><Button disabled={busy || !canSheet} onClick={() => save(true)}>Save &amp; create split sheet PDF</Button></div>
        </footer>
      </div>
    </div>
  )
}
