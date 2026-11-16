import { useMemo, useRef, useState } from 'react'
import { useScroll, useReducedMotion } from 'framer-motion'
import { Download, Upload, Plus, Search, Lock, Pencil, Trash2, FileDown, FileUp } from 'lucide-react'
import type { Beat, License, Sale, SalesData } from '@shared/types'
import { ImportSalesDialog } from './ImportSalesDialog'
import { Revenue } from './Revenue'
import { errMsg, fmtDay, money, net } from './salesUtils'
import { salesSeries, type SalesMetric } from './salesSeries'
import type { MadePeriod } from './dashUtils'
import { PeakChart } from './components/ui/peak-chart'
import { ScrollArea } from '@/components/lib/scroll-area'
import { TooltipProvider } from '@/components/lib/tooltip'
import { StickyCard } from '@/components/lib/skiper-ui/sticky-card'
import { Art, Button, Reveal, Roll, Seg, Tip, cssVar } from './salesUi'
import './sales.css'

interface Props {
  data: SalesData
  beats: Beat[]
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

type Tab = 'sales' | 'revenue' | 'collabs' | 'licenses'
const srcLabel = (s: string) => (s === 'beatstars' ? 'BeatStars' : s === 'cashapp' ? 'Cash App' : s[0].toUpperCase() + s.slice(1))

export function SalesView(p: Props) {
  const [tab, setTab] = useState<Tab>('sales')
  const { data } = p
  const [importPath, setImportPath] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const pick = async () => { try { const f = await window.api.salesImportPick(); if (f) setImportPath(f) } catch (e) { p.toast(errMsg(e)) } }
  const dropped = (e: React.DragEvent) => {
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    e.preventDefault()
    if (/\.csv$/i.test(f.name)) setImportPath(window.api.pathForFile(f)); else p.toast('Drop a .csv sales export from BeatStars.')
  }
  return (
    <TooltipProvider delay={120}>
      <section className="sl" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false) }} onDrop={dropped}>
        <div className="sl-tools">
          <h2 className="sl-disp">Sales &amp; Collabs</h2>
          <Seg tabs label="Section" value={tab} onChange={setTab} options={[{ v: 'sales', label: 'Sales' }, { v: 'revenue', label: 'Revenue' }, { v: 'collabs', label: 'Collabs & splits' }, { v: 'licenses', label: 'Licenses' }]} />
          <span className="sl-sp" />
          {tab === 'sales' && <Button variant="outline" onClick={async () => { try { const f = await window.api.exportSalesCsv(); if (f) p.toast(`Exported ${f.split('/').pop()}`) } catch (e) { p.toast(errMsg(e)) } }}><Download data-icon="inline-start" />Export CSV</Button>}
          <Button variant="outline" onClick={pick}><Upload data-icon="inline-start" />Import BeatStars sales…</Button>
          <Button onClick={p.onLog}><Plus data-icon="inline-start" />Log sale</Button>
        </div>
        {over && <div className="sl-dropov" aria-hidden="true"><FileUp />Drop the BeatStars .csv to import it</div>}
        {importPath && <ImportSalesDialog path={importPath} beats={p.beats} onClose={() => setImportPath(null)} onDone={(m) => { setImportPath(null); p.toast(m); p.reload() }} />}
        <div className="sl-body">
          {tab === 'sales' && <SalesTable {...p} onImport={pick} />}
          {tab === 'revenue' && <Revenue sales={data.sales} />}
          {tab === 'collabs' && <Collabs {...p} />}
          {tab === 'licenses' && <Licenses licenses={data.licenses} reload={p.reload} toast={p.toast} />}
        </div>
      </section>
    </TooltipProvider>
  )
}

function SalesPeak({ sales }: { sales: Sale[] }) {
  const [period, setPeriod] = useState<MadePeriod>('Yearly')
  const [metric, setMetric] = useState<SalesMetric>('gross')
  const now = Date.now()
  const s = useMemo(() => salesSeries(sales, metric, period, now), [sales, metric, period, now])
  const total = s.data.reduce((a, b) => a + b, 0)
  const span = period === 'Weekly' ? 'Last 7 days' : period === 'Monthly' ? 'Last 30 days' : 'Last 12 months'
  const count = metric === 'count'
  return (
    <div className="sl-peak" aria-label="Sales over time">
      <Seg label="Chart shows" value={metric} onChange={setMetric} options={[{ v: 'gross', label: 'Gross' }, { v: 'net', label: 'Net' }, { v: 'count', label: 'Sales' }]} />
      <PeakChart
        width={300} font="var(--font)" accent={cssVar(count ? '--sent' : '--finished')} data={s.data} labels={s.labels} value={total} valueSuffix="" decimals={0}
        title={count ? 'Sales' : metric === 'net' ? 'Net revenue' : 'Revenue'} caption={span} updatedText={`${sales.length} logged all time`}
        trend="none" period={period} onPeriodChange={(x) => setPeriod(x as MadePeriod)}
        formatValue={(v) => (count ? `${Math.round(v)} sale${Math.round(v) === 1 ? '' : 's'}` : money(Math.round(v)))}
      />
    </div>
  )
}

function SalesTable({ data, query, onQuery, onEdit, onOpenBeat, reload, toast, onLog, onImport }: Props & { onImport: () => void }) {
  const [exclOnly, setExclOnly] = useState(false)
  const q = query.trim().toLowerCase()
  const rows = useMemo(() => data.sales.filter((s) => (!exclOnly || s.exclusive) && (!q || [s.beatTitle, s.buyer, s.licenseName, s.source, s.notes].join(' ').toLowerCase().includes(q))), [data.sales, q, exclOnly])
  const total = rows.reduce((a, s) => a + s.price, 0)
  const fees = rows.reduce((a, s) => a + s.fee, 0)
  const excl = rows.filter((s) => s.exclusive).length
  return (
    <div className="sl-split">
      <div className="sl-list">
        <div className="sl-subbar">
          <label className="sl-field"><Search aria-hidden="true" /><input className="sl-in" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search beat, buyer, license…" aria-label="Search sales" /></label>
          <label className="sl-chk"><input type="checkbox" checked={exclOnly} onChange={(e) => setExclOnly(e.target.checked)} /> Exclusives only</label>
          <span className="sl-sp" />
          <span className="sl-dim">{rows.length} sale{rows.length === 1 ? '' : 's'} · {money(total)} gross{fees > 0 ? ` · ${money(total - fees)} net` : ''}</span>
        </div>
        <div className="sl-thead sl-sa"><span>Date</span><span>Beat</span><span>Buyer</span><span>License</span><span className="sl-c-src">Source</span><span className="r">Price</span><span className="r sl-c-net">Net</span><span /></div>
        <ScrollArea className="sl-rows">
          {rows.map((s) => (
            <div key={s.id} className="sl-row sl-sa">
              <span className="sl-dim">{fmtDay(s.soldAt)}</span>
              <span className="sl-beat"><Art name={s.beatTitle} size={28} /><a onClick={() => onOpenBeat(s.beatId)}>{s.beatTitle}</a></span>
              <span className="sl-ell" title={s.buyerEmail}>{s.buyer}</span>
              <span>{s.exclusive ? <em className="sl-pill out"><Lock aria-hidden="true" />{s.licenseName}</em> : <em className="sl-pill">{s.licenseName}</em>}</span>
              <span className="sl-dim sl-c-src">{srcLabel(s.source)}</span>
              <span className="r sl-mono">{money(s.price)}</span>
              <span className="r sl-mono sl-dim sl-c-net">{money(net(s))}</span>
              <span className="sl-act">
                <Tip label="Edit sale"><Button variant="ghost" size="icon-sm" aria-label="Edit sale" onClick={() => onEdit(s)}><Pencil /></Button></Tip>
                <Tip label="Delete sale"><Button variant="ghost" size="icon-sm" aria-label="Delete sale" title="Delete" onClick={async () => {
                  const warn = s.exclusive ? `\n\nThis was an exclusive. Deleting it unlocks “${s.beatTitle}” and sets it back to finished.` : ''
                  if (!confirm(`Delete the ${money(s.price)} sale of “${s.beatTitle}” to ${s.buyer}?${warn}`)) return
                  try { await window.api.deleteSale(s.id); reload() } catch (e) { toast(errMsg(e)) }
                }}><Trash2 /></Button></Tip>
              </span>
            </div>
          ))}
          {!rows.length && (
            <div className="sl-empty"><b>{data.sales.length ? 'No sales match.' : 'No sales yet. Log your first lease or exclusive.'}</b>
              {!data.sales.length && <div className="sl-row-acts"><Button onClick={onLog}><Plus data-icon="inline-start" />Log sale</Button><Button variant="outline" onClick={onImport}>Import BeatStars sales…</Button></div>}
            </div>
          )}
        </ScrollArea>
      </div>
      <aside className="sl-rail">
        <section><SalesPeak sales={data.sales} /></section>
        <section>
          <h4>This view</h4>
          <Reveal className="sl-kvs">
            <div className="sl-kv"><span>Sales</span><b><Roll value={rows.length} /></b><em>logged</em></div>
            <div className="sl-kv"><span>Gross</span><b><Roll value={total} money cents={total % 1 !== 0} /></b><em /></div>
            <div className="sl-kv"><span>Net of fees</span><b><Roll value={total - fees} money cents={(total - fees) % 1 !== 0} /></b><em>{fees > 0 ? `${money(fees)} fees` : 'no fees'}</em></div>
            <div className="sl-kv"><span>Exclusives</span><b><Roll value={excl} /></b><em>locked beats</em></div>
          </Reveal>
        </section>
        <section>
          <button type="button" className="sl-dropz" onClick={onImport}><FileDown aria-hidden="true" /><b>Drop a BeatStars .csv anywhere</b><small>or use Import BeatStars sales…</small></button>
        </section>
      </aside>
    </div>
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
    <div className="sl-list sl-solo">
      <div className="sl-subbar">
        <label className="sl-field"><Search aria-hidden="true" /><input className="sl-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a beat…" aria-label="Find a beat" /></label>
        <Seg label="Filter" value={f} onChange={setF} options={[{ v: 'with', label: 'With splits' }, { v: 'attention', label: 'Needs attention' }, { v: 'none', label: 'No splits yet' }, { v: 'all', label: 'All' }]} />
      </div>
      <div className="sl-thead sl-co"><span>Beat</span><span>Status</span><span /></div>
      <ScrollArea className="sl-rows">
        {rows.map((g) => {
          const s = status(g)
          return (
            <div key={g.groupId} className="sl-row sl-co">
              <span className="sl-beat"><Art name={g.title} size={28} /><b>{g.title}</b>{g.count > 1 && <em className="sl-pill">{g.count} versions</em>}</span>
              <span className={`sl-st ${s.k}`}>{s.label}</span>
              <span className="sl-act">
                <Button variant="outline" size="sm" onClick={() => onSplits({ groupId: g.groupId, title: g.title })}>{g.parties ? 'Edit splits' : 'Add splits'}</Button>
                {(s.k === 'ok' || s.k === 'sheet') && <Button size="sm" onClick={() => onSheet(g.groupId)}>{s.k === 'sheet' ? 'Re-create PDF' : 'Create PDF'}</Button>}
              </span>
            </div>
          )
        })}
        {!rows.length && <div className="sl-empty"><b>{f === 'with' ? 'No beats have splits yet.' : 'Nothing here.'}</b>{f === 'with' && 'Open “No splits yet” and add some, or use Add splits from a beat in the Vault.'}</div>}
      </ScrollArea>
    </div>
  )
}

function Licenses({ licenses, reload, toast }: { licenses: License[]; reload: () => void; toast: (m: string) => void }) {
  const save = async (l: Partial<License> & { name: string; exclusive: boolean }) => { try { await window.api.saveLicense(l); reload() } catch (e) { toast(errMsg(e)) } }
  const scroller = useRef<HTMLDivElement>(null)
  const stack = useRef<HTMLDivElement>(null)
  const still = useReducedMotion()
  const { scrollYProgress } = useScroll({ container: scroller, target: stack, offset: ['start start', 'end end'] })
  return (
    <div className="sl-lics">
      <aside className="sl-lics-aside">
        <h3 className="sl-disp">Licenses</h3>
        <p>The license types you offer. Prices are suggestions and fill in when you log a sale; you can always override them. Past sales keep the name they were sold under.</p>
        <p>“Files” and “What it includes” are shown on your public beat site.</p>
        <Button onClick={() => save({ name: 'New license', exclusive: false, defaultPrice: 50 })}><Plus data-icon="inline-start" />Add license</Button>
      </aside>
      <div className="sl-lics-scroll" ref={scroller}>
        <div className="sl-lstack" ref={stack}>
          {licenses.map((l, i) => (
            <StickyCard key={l.id} i={i} offset={46} progress={scrollYProgress} range={[i / licenses.length, 1]} targetScale={still ? 1 : Math.max(0.9, 1 - (licenses.length - i - 1) * 0.02)} className="sl-lc-wrap">
              <LicenseCard l={l} save={save} reload={reload} />
            </StickyCard>
          ))}
          {!licenses.length && <div className="sl-empty"><b>No licenses yet.</b>Add one to start logging sales against it.</div>}
        </div>
      </div>
    </div>
  )
}

function LicenseCard({ l, save, reload }: { l: License; save: (l: Partial<License> & { name: string; exclusive: boolean }) => void; reload: () => void }) {
  const [name, setName] = useState(l.name)
  const [price, setPrice] = useState(l.defaultPrice == null ? '' : String(l.defaultPrice))
  const [files, setFiles] = useState(l.files)
  const [perks, setPerks] = useState(l.perks.join('\n'))
  return (
    <div className={`sl-lc${l.exclusive ? ' excl' : ''}`}>
      <div className="sl-lh">
        <input className="sl-in sl-lname" value={name} aria-label="License name" onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== l.name && save({ ...l, name })} />
        <label className="sl-price">$<input className="sl-in" inputMode="decimal" aria-label={`Default price for ${l.name}`} value={price} placeholder="price" onChange={(e) => setPrice(e.target.value)} onBlur={() => save({ ...l, defaultPrice: price === '' ? null : parseFloat(price) || 0 })} /></label>
        <label className="sl-chk"><input type="checkbox" checked={l.exclusive} onChange={(e) => save({ ...l, exclusive: e.target.checked })} /> Exclusive</label>
        <Tip label="Remove license"><Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.name}`} onClick={async () => { if (confirm(`Remove “${l.name}”? Past sales keep their license name.`)) { await window.api.deleteLicense(l.id); reload() } }}><Trash2 /></Button></Tip>
      </div>
      <div className="sl-lb">
        <input className="sl-in" value={files} placeholder="Files, e.g. MP3 + WAV" aria-label={`Files for ${l.name}`} onChange={(e) => setFiles(e.target.value)} onBlur={() => files !== l.files && save({ ...l, files })} />
        <textarea className="sl-in" rows={3} value={perks} placeholder="What it includes, one per line" aria-label={`What ${l.name} includes`} onChange={(e) => setPerks(e.target.value)}
          onBlur={() => { const next = perks.split('\n').map((x) => x.trim()).filter(Boolean); if (next.join('\n') !== l.perks.join('\n')) save({ ...l, perks: next }) }} />
      </div>
    </div>
  )
}
