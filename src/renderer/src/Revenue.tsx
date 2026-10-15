import { useMemo, useState } from 'react'
import type { Sale } from '@shared/types'
import { buyerKey, inRange, money, monthly, net, rank, type Ranked, type RangeKey } from './salesUtils'

// Series colors come from the dataviz palette (dark, validated): slot 1 blue = leases, slot 2 orange = exclusives.
const nice = (max: number) => {
  if (max <= 0) return 100
  const p = Math.pow(10, Math.floor(Math.log10(max)))
  const f = max / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

function BarList({ rows, unit }: { rows: Ranked[]; unit: (r: Ranked) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.total))
  if (!rows.length) return <p className="help">No sales in this range.</p>
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div key={r.key} className="bl-row" title={`${r.label}: ${money(r.total)}`}>
          <span className="bl-name">{r.label}</span>
          <span className="bl-track"><span className="bl-fill" style={{ width: `${(r.total / max) * 100}%` }} /></span>
          <span className="bl-val mono">{money(r.total)}</span>
          <span className="bl-sub dim">{unit(r)}</span>
        </div>
      ))}
    </div>
  )
}

export function Revenue({ sales }: { sales: Sale[] }) {
  const [range, setRange] = useState<RangeKey>('12m')
  const [useNet, setUseNet] = useState(false)
  const [table, setTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const inR = useMemo(() => sales.filter((s) => inRange(s.soldAt, range)), [sales, range])
  const val = (s: Sale) => (useNet ? net(s) : s.price)
  const total = inR.reduce((a, s) => a + val(s), 0)
  const now = new Date()
  const thisMonth = sales.filter((s) => { const d = new Date(s.soldAt); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() }).reduce((a, s) => a + val(s), 0)
  const fees = inR.reduce((a, s) => a + s.fee, 0)
  const exclusives = inR.filter((s) => s.exclusive).length
  const months = useMemo(() => monthly(sales, range, useNet), [sales, range, useNet])
  const topBeats = useMemo(() => rank(inR, (s) => ({ key: `g${s.groupId}`, label: s.beatTitle }), useNet).slice(0, 8), [inR, useNet])
  const buyers = useMemo(() => rank(inR, buyerKey, useNet), [inR, useNet])
  const sources = useMemo(() => rank(inR, (s) => ({ key: s.source, label: s.source === 'beatstars' ? 'BeatStars' : s.source === 'cashapp' ? 'Cash App' : s.source[0].toUpperCase() + s.source.slice(1) }), useNet), [inR, useNet])

  // chart geometry
  const W = 860, H = 240, L = 48, R = 8, T = 10, B = 28
  const max = nice(Math.max(...months.map((m) => m.leases + m.exclusives), 1))
  const bw = (W - L - R) / months.length
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const everyN = months.length > 18 ? 3 : months.length > 12 ? 2 : 1
  const hv = hover != null ? months[hover] : null

  return (
    <div className="revenue">
      <div className="rv-top">
        <div className="seg" style={{ width: 'auto' }}>
          {([['12m', 'Last 12 months'], ['ytd', 'This year'], ['all', 'All time']] as const).map(([k, l]) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>)}
        </div>
        <div className="seg" style={{ width: 'auto' }}>
          <button className={!useNet ? 'on' : ''} onClick={() => setUseNet(false)}>Gross</button>
          <button className={useNet ? 'on' : ''} onClick={() => setUseNet(true)}>Net of fees</button>
        </div>
      </div>

      <div className="stats six">
        <div className="stat"><b>{money(total)}</b><span>{useNet ? 'net revenue' : 'revenue'}</span></div>
        <div className="stat"><b>{money(thisMonth)}</b><span>this month</span></div>
        <div className="stat"><b>{inR.length}</b><span>sales</span></div>
        <div className="stat"><b>{inR.length ? money(Math.round((total / inR.length) * 100) / 100) : '–'}</b><span>average sale</span></div>
        <div className="stat"><b>{exclusives}</b><span>exclusives</span></div>
        <div className="stat"><b>{money(fees)}</b><span>fees paid</span></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Revenue by month</h3>
          <div className="legend">
            <span><i className="sw s1" />Leases</span><span><i className="sw s2" />Exclusives</span>
            <button className="ghost" onClick={() => setTable((t) => !t)}>{table ? 'Show chart' : 'Show table'}</button>
          </div>
        </div>
        {table ? (
          <table className="mini">
            <thead><tr><th>Month</th><th className="r">Leases</th><th className="r">Exclusives</th><th className="r">Total</th><th className="r">Sales</th></tr></thead>
            <tbody>{months.map((m) => <tr key={m.key}><td>{m.label}</td><td className="r">{money(m.leases)}</td><td className="r">{money(m.exclusives)}</td><td className="r">{money(m.leases + m.exclusives)}</td><td className="r">{m.count}</td></tr>)}</tbody>
          </table>
        ) : (
          <div className="chartwrap" onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue by month, leases and exclusives stacked">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
                  <text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">{t >= 1000 ? `$${t / 1000}k` : `$${t}`}</text>
                </g>
              ))}
              {months.map((m, i) => {
                const x = L + i * bw + bw * 0.2, w = bw * 0.6
                const hL = (H - T - B) * (m.leases / max), hE = (H - T - B) * (m.exclusives / max)
                const base = H - B
                return (
                  <g key={m.key} onMouseEnter={() => setHover(i)}>
                    <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
                    {m.leases > 0 && <rect x={x} y={base - hL} width={w} height={Math.max(hL - (m.exclusives > 0 ? 2 : 0), 1)} rx={3} className="s1" opacity={hover == null || hover === i ? 1 : 0.45} />}
                    {m.exclusives > 0 && <rect x={x} y={base - hL - hE} width={w} height={Math.max(hE, 1)} rx={3} className="s2" opacity={hover == null || hover === i ? 1 : 0.45} />}
                    {i % everyN === 0 && <text x={x + w / 2} y={H - 8} textAnchor="middle" className="axis">{m.label}</text>}
                  </g>
                )
              })}
              <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="baseline" />
            </svg>
            {hv && hover != null && (
              <div className="tip" style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%` }}>
                <b>{hv.label}</b>
                <div><i className="sw s1" />Leases <span>{money(hv.leases)}</span></div>
                <div><i className="sw s2" />Exclusives <span>{money(hv.exclusives)}</span></div>
                <div className="dim">{hv.count} sale{hv.count === 1 ? '' : 's'}</div>
              </div>
            )}
          </div>
        )}
        {!sales.length && <p className="help">No sales logged yet. Log one from the Sales tab and this fills in.</p>}
      </div>

      <div className="rv-cols">
        <div className="panel"><h3>Top beats</h3><BarList rows={topBeats} unit={(r) => `${r.count} sale${r.count === 1 ? '' : 's'}`} /></div>
        <div className="panel"><h3>Top buyers</h3><BarList rows={buyers.slice(0, 8)} unit={(r) => (r.count > 1 ? `${r.count} purchases · repeat` : '1 purchase')} /></div>
        <div className="panel"><h3>By source</h3><BarList rows={sources} unit={(r) => `${Math.round((r.total / Math.max(1, total)) * 100)}%`} /></div>
      </div>
    </div>
  )
}
