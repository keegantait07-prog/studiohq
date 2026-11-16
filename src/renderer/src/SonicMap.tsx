import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import type { Beat, Status } from '@shared/types'
import { clickable } from './a11y'
import { camelot, keysCompatible, bpmCompatible, displayKey } from '@shared/key'
import { keyColor } from './keyColor'
import { artUrl } from './genart'
import { fmtBpm } from './format'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/lib/skiper-ui/skiper101'
import { Button, Chip } from './makeUi'
import './make.css'

const B_NAMES = ['B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E']          // 1B..12B
const A_NAMES = ['G#m', 'D#m', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m'] // 1A..12A
const STATUS_RING: Record<Status, string> = { idea: '#8a8a99', wip: '#e8b93a', finished: '#4cc38a', sent: '#5aa9ff', sold: '#c084fc' }
const STATUS_R: Record<Status, number> = { idea: 5, wip: 6, finished: 8, sent: 8, sold: 9 }
const C = 400, R = 380
const SPRING = { mass: 0.1, damping: 10, stiffness: 131 } // Skiper 61 spring, drives the focus ring
const BANDS = { B: [0.62, 0.98], A: [0.28, 0.58] } as const

const hash = (n: number) => { let h = (n + 1) * 2654435761; h ^= h >>> 15; return ((h >>> 0) % 10000) / 10000 }
const rad = (deg: number) => (deg * Math.PI) / 180
const pt = (angDeg: number, r: number) => [C + Math.cos(rad(angDeg)) * r, C + Math.sin(rad(angDeg)) * r] as const
const centre = (n: number) => (n - 1) * 30 - 90

function sector(n: number, r0: number, r1: number): string {
  const a0 = centre(n) - 14.4, a1 = centre(n) + 14.4
  const [x0, y0] = pt(a0, r1), [x1, y1] = pt(a1, r1), [x2, y2] = pt(a1, r0), [x3, y3] = pt(a0, r0)
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`
}

interface Dot { b: Beat; x: number; y: number; r: number }

export function SonicMap({ beats, onOpen, onPlay, onQuery }: { beats: Beat[]; onOpen: (id: number) => void; onPlay: (id: number) => void; onQuery: (q: string) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const still = useReducedMotion()
  const wrap = useRef<HTMLDivElement>(null)
  const rx = useSpring(useMotionValue(C), SPRING)
  const ry = useSpring(useMotionValue(C), SPRING)
  const ro = useSpring(useMotionValue(0), SPRING)
  const [hide, setHide] = useState<Set<Status>>(new Set())

  const { dots, unplaced } = useMemo(() => {
    const seen = new Set<number>()
    const out: Dot[] = []
    let un = 0
    for (const b of [...beats].sort((a, c) => c.mtime - a.mtime)) {
      if (seen.has(b.groupId)) continue
      seen.add(b.groupId)
      const code = camelot(b.key)
      if (!code) { un++; continue }
      const n = parseInt(code, 10), band = BANDS[code.endsWith('A') ? 'A' : 'B']
      const t = b.bpm ? Math.min(1, Math.max(0, (b.bpm - 60) / 120)) : 0.5
      const r = band[0] * R + 16 + t * ((band[1] - band[0]) * R - 56) + (hash(b.id * 3) - 0.5) * 8 // the outer 40px of each band is kept clear for its label
      const ang = centre(n) + (hash(b.id) - 0.5) * 24
      const [x, y] = pt(ang, r)
      out.push({ b, x, y, r: STATUS_R[b.status] })
    }
    return { dots: out, unplaced: un }
  }, [beats])

  const focusId = hover ?? sel
  const focus = dots.find((d) => d.b.id === focusId)?.b ?? null
  const mates = useMemo(() => (focus ? dots.filter((d) => d.b.id !== focus.id && keysCompatible(focus.key, d.b.key) && bpmCompatible(focus.bpm, d.b.bpm)) : []), [dots, focus])
  const mateIds = new Set(mates.map((m) => m.b.id))
  const fd = dots.find((d) => d.b.id === focus?.id)
  const shown = dots.filter((d) => !hide.has(d.b.status))
  const toggle = (s: Status) => setHide((h) => { const n = new Set(h); n.has(s) ? n.delete(s) : n.add(s); return n })
  const selBeat = dots.find((d) => d.b.id === sel)?.b ?? null

  const place = (x: number, y: number) => {
    if (still) { rx.jump(x); ry.jump(y) } else { rx.set(x); ry.set(y) }
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (focus && fd) return // ring is pinned to the focused dot
    const b = e.currentTarget.getBoundingClientRect()
    place(((e.clientX - b.left) / b.width) * C * 2, ((e.clientY - b.top) / b.height) * C * 2)
    ro.set(1)
  }
  useEffect(() => { if (fd) { place(fd.x, fd.y); ro.set(1) } else ro.set(0) }, [fd?.x, fd?.y]) // eslint-disable-line react-hooks/exhaustive-deps
  const hv = hover != null ? dots.find((d) => d.b.id === hover) ?? null : null

  return (
    <div className="mk-map">
      <div className="mk-stage">
        <div className="mk-mapwrap" ref={wrap}>
          <svg viewBox={`0 0 ${C * 2} ${C * 2}`} className="mk-mapsvg" role="img" aria-label="Sonic map of every beat on the Camelot wheel" onClick={() => setSel(null)} onPointerMove={onMove} onPointerLeave={() => { if (!focus) ro.set(0) }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
              const hueB = keyColor(`${B_NAMES[n - 1]} major`, 60), hueA = keyColor(`${A_NAMES[n - 1].replace('m', '')} minor`, 60)
              const lb = pt(centre(n), R * BANDS.B[1] - 18), la = pt(centre(n), R * BANDS.A[1] - 18)
              return (
                <g key={n}>
                  <path d={sector(n, BANDS.B[0] * R, BANDS.B[1] * R)} fill={hueB} fillOpacity=".07" className="mk-sec" strokeWidth="1" />
                  <path d={sector(n, BANDS.A[0] * R, BANDS.A[1] * R)} fill={hueA} fillOpacity=".07" className="mk-sec" strokeWidth="1" />
                  <text x={lb[0]} y={lb[1]} className="mk-lab" fill={hueB}>{n}B <tspan className="mk-note">{B_NAMES[n - 1]}</tspan></text>
                  <text x={la[0]} y={la[1]} className="mk-lab" fill={hueA}>{n}A <tspan className="mk-note">{A_NAMES[n - 1]}</tspan></text>
                </g>
              )
            })}
            <circle cx={C} cy={C} r={BANDS.A[0] * R - 12} className="mk-hub" />
            {fd && mates.map((m) => <line key={m.b.id} x1={fd.x} y1={fd.y} x2={m.x} y2={m.y} stroke={keyColor(m.b.key)} strokeOpacity=".55" strokeWidth="1.6" />)}
            {/* mouse-follow focus ring: springs toward the cursor, or locks onto the focused dot (Skiper 61) */}
            <motion.circle className="mk-focusglow" cx={rx} cy={ry} style={{ opacity: ro }} r={58} />
            <motion.circle className="mk-focusring" cx={rx} cy={ry} style={{ opacity: ro }} r={30} />
            {shown.map((d) => {
              const dim = focus && d.b.id !== focus.id && !mateIds.has(d.b.id)
              return (
                <circle key={d.b.id} cx={d.x} cy={d.y} r={d.b.id === focusId ? d.r + 3 : d.r} fill={keyColor(d.b.key)} fillOpacity={dim ? 0.18 : 0.95}
                  stroke={STATUS_RING[d.b.status]} strokeWidth={d.b.id === sel ? 3 : 1.6} strokeOpacity={dim ? 0.2 : 1} className="mk-dot"
                  onMouseEnter={() => { setHover(d.b.id); }} onMouseLeave={() => setHover(null)}
                  onClick={(e) => { e.stopPropagation(); setSel(d.b.id) }} onDoubleClick={(e) => { e.stopPropagation(); onPlay(d.b.id) }} />
              )
            })}
            <text x={C} y={C - 22} className="mk-ctr big">{focus ? focus.title.slice(0, 22) : 'SONIC MAP'}</text>
            <text x={C} y={C + 6} className="mk-ctr">{focus ? `${fmtBpm(focus.bpm)} BPM · ${displayKey(focus.key)} · ${camelot(focus.key)}` : `${shown.length} beats placed`}</text>
            <text x={C} y={C + 30} className="mk-ctr d">{focus ? (mates.length ? `${mates.length} play well with it` : 'nothing else mixes with it yet') : 'further out = faster'}</text>
          </svg>
          {/* point tooltip card (Skiper 101): one controlled tooltip anchored on the hovered dot */}
          <Tooltip open={!!hv}>
            <TooltipTrigger asChild>
              <span className="mk-anchor" aria-hidden="true" style={{ left: `${((hv?.x ?? C) / (C * 2)) * 100}%`, top: `${((hv?.y ?? C) / (C * 2)) * 100}%` }} />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10} className="mk-tip">
              {hv && <>
                <b>{hv.b.title}</b>
                <small>{fmtBpm(hv.b.bpm)} BPM · {displayKey(hv.b.key)} · {camelot(hv.b.key)}</small>
                <span className="mk-tip-f"><i style={{ borderColor: STATUS_RING[hv.b.status] }} />{hv.b.status} · {mates.length} mix with it · click to pin · double-click to play</span>
              </>}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <aside className="mk-mside">
        <section>
          <h2 className="mk-disp">Sonic map</h2>
          <p className="mk-help">Every beat sits on the Camelot wheel by its key (outer ring major, inner ring minor), and further out means a faster tempo. Hover a beat to see what mixes with it.</p>
        </section>
        <section>
          <span className="mk-eyebrow">Show by status</span>
          <div className="mk-chips">
            {(Object.keys(STATUS_RING) as Status[]).map((s) => (
              <Chip key={s} on={!hide.has(s)} onClick={() => toggle(s)}><i className="mk-ring" style={{ borderColor: STATUS_RING[s] }} />{s} <span className="mk-dim">{dots.filter((d) => d.b.status === s).length}</span></Chip>
            ))}
          </div>
          {unplaced > 0 && <p className="mk-help"><a className="mk-lnk" {...clickable(() => onQuery('needsinfo'))}>{unplaced} beats have no key yet</a> so they are not on the map.</p>}
        </section>
        {selBeat ? (
          <section className="mk-msel">
            <img className="mk-mart" src={artUrl({ seed: `g${selBeat.groupId}`, peaks: selBeat.thumb, key: selBeat.key, bpm: selBeat.bpm })} alt="" />
            <div><b>{selBeat.title}</b><div className="mk-dim">{fmtBpm(selBeat.bpm)} BPM · {displayKey(selBeat.key)} · {camelot(selBeat.key)}</div></div>
            <div className="mk-row"><Button size="sm" onClick={() => onPlay(selBeat.id)}>Play</Button><Button variant="outline" size="sm" onClick={() => onOpen(selBeat.id)}>Open</Button></div>
            <span className="mk-eyebrow">Plays well with ({mates.length})</span>
            <div className="mk-mates">
              {mates.slice(0, 10).map((m) => (
                <div key={m.b.id} className="mk-mate" {...clickable(() => setSel(m.b.id))} onDoubleClick={() => onPlay(m.b.id)}>
                  <span className="vl" style={{ color: keyColor(m.b.key) }}>{camelot(m.b.key)}</span><span className="mk-ellip">{m.b.title}</span><span className="mk-dim">{fmtBpm(m.b.bpm)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : <p className="mk-help">Click a beat to pin it. Double-click to play.</p>}
      </aside>
    </div>
  )
}
