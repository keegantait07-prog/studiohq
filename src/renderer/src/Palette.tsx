import { useEffect, useMemo, useRef, useState } from 'react'
import type { Beat, Contact, Sale } from '@shared/types'
import { displayKey } from '@shared/key'
import { fmtBpm } from './format'

export interface Command { id: string; label: string; hint?: string; run: () => void }

export function Palette({ beats, contacts, sales, commands, onPickBeat, onPickContact, onPickSale, onClose }: { beats: Beat[]; contacts: Contact[]; sales: Sale[]; commands: Command[]; onPickBeat: (b: Beat) => void; onPickContact: (c: Contact) => void; onPickSale: (s: Sale) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const items = useMemo(() => {
    const s = q.trim().toLowerCase()
    const cmds = commands.filter((c) => !s || c.label.toLowerCase().includes(s)).slice(0, 6)
    const hits = s
      ? beats.filter((b) => [b.title, b.filename, ...b.tags.vibe, ...b.tags.genre, ...b.tags.artist].join(' ').toLowerCase().includes(s)).slice(0, 8)
      : beats.slice(0, 6)
    const people = s ? contacts.filter((c) => [c.name, c.email, c.sound].join(' ').toLowerCase().includes(s)).slice(0, 5) : []
    const deals = s ? sales.filter((x) => [x.buyer, x.beatTitle, x.licenseName].join(' ').toLowerCase().includes(s)).slice(0, 4) : []
    return [
      ...hits.map((b) => ({ kind: 'beat' as const, beat: b })),
      ...people.map((c) => ({ kind: 'contact' as const, contact: c })),
      ...deals.map((x) => ({ kind: 'sale' as const, sale: x })),
      ...cmds.map((c) => ({ kind: 'cmd' as const, cmd: c }))
    ]
  }, [q, beats, contacts, sales, commands])

  const run = (idx: number) => {
    const it = items[idx]
    if (!it) return
    onClose()
    if (it.kind === 'beat') onPickBeat(it.beat)
    else if (it.kind === 'contact') onPickContact(it.contact)
    else if (it.kind === 'sale') onPickSale(it.sale)
    else it.cmd.run()
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Search beats, or type a command…"
          onChange={(e) => { setQ(e.target.value); setI(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
            else if (e.key === 'Enter') run(i)
            else if (e.key === 'Escape') onClose()
          }}
        />
        <div className="results">
          {items.map((it, idx) => (
            <div key={idx} className={`res ${idx === i ? 'on' : ''}`} onMouseEnter={() => setI(idx)} onClick={() => run(idx)}>
              {it.kind === 'beat' ? (
                <>
                  <span className="rk">Beat</span><span className="rt">{it.beat.title}</span>
                  <span className="rh">{fmtBpm(it.beat.bpm)} · {displayKey(it.beat.key)} · {it.beat.status}</span>
                </>
              ) : it.kind === 'sale' ? (
                <>
                  <span className="rk sale">Sale</span><span className="rt">{it.sale.beatTitle} → {it.sale.buyer}</span><span className="rh">{it.sale.licenseName} · ${it.sale.price}</span>
                </>
              ) : it.kind === 'contact' ? (
                <>
                  <span className="rk contact">Contact</span><span className="rt">{it.contact.name}</span><span className="rh">{it.contact.role}</span>
                </>
              ) : (
                <>
                  <span className="rk cmd">Action</span><span className="rt">{it.cmd.label}</span><span className="rh">{it.cmd.hint}</span>
                </>
              )}
            </div>
          ))}
          {!items.length && <div className="empty-res">Nothing found</div>}
        </div>
      </div>
    </div>
  )
}
