// v4 Command palette. Blueprint: docs/design/mockups/v4/screens-studio-system.html (#palette).
// Library parts: BlurFade (Reveal) entrance, TypingAnimation (cycling placeholder), Dock + DockIcon (matching
// actions), Tooltip. Search, caps, order and keys are unchanged.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Beat, Contact, Sale, SoundRow } from '@shared/types'
import { displayKey } from '@shared/key'
import { fmtBpm } from './format'
import { useReducedMotion } from 'motion/react'
import { Search } from 'lucide-react'
import { Dock, DockIcon } from '@/components/lib/dock'
import { TypingAnimation } from '@/components/lib/typing-animation'
import { TooltipProvider } from '@/components/lib/tooltip'
import { Reveal, Tip } from './crmUi'
import { Icon } from './Icons'
import './system.css'

const HINTS = ['Search beats, or type a command…', 'Try a beat title, a key or a vibe', 'Find a contact or a sale', 'Type “theme” or “settings”']
const ICONS = new Set(['dashboard', 'vault', 'loops', 'map', 'leads', 'crm', 'sales', 'store', 'content', 'sounds', 'kits', 'feedback', 'plugins', 'themes', 'assistant', 'settings'])
const iconFor = (c: Command) => { const n = c.id.replace(/^go-/, ''); return ICONS.has(n) ? n : null }

/** The query, highlighted where it matches. */
function Hi({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export interface Command { id: string; label: string; hint?: string; run: () => void }

export function Palette({ beats, contacts, sales, sounds, commands, onPickBeat, onPickContact, onPickSale, onPickSound, onClose }: { beats: Beat[]; contacts: Contact[]; sales: Sale[]; sounds: SoundRow[]; onPickSound: (s: SoundRow) => void; commands: Command[]; onPickBeat: (b: Beat) => void; onPickContact: (c: Contact) => void; onPickSale: (s: Sale) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const still = useReducedMotion()
  useEffect(() => input.current?.focus(), [])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }) }, [i])

  const items = useMemo(() => {
    const s = q.trim().toLowerCase()
    const cmds = commands.filter((c) => !s || c.label.toLowerCase().includes(s)).slice(0, 6)
    const hits = s
      ? beats.filter((b) => [b.title, b.filename, ...b.tags.vibe, ...b.tags.genre, ...b.tags.artist].join(' ').toLowerCase().includes(s)).slice(0, 8)
      : beats.slice(0, 6)
    const people = s ? contacts.filter((c) => [c.name, c.email, c.sound].join(' ').toLowerCase().includes(s)).slice(0, 5) : []
    const deals = s ? sales.filter((x) => [x.buyer, x.beatTitle, x.licenseName].join(' ').toLowerCase().includes(s)).slice(0, 4) : []
    const snds = s.length > 1 ? sounds.filter((x) => x.n.toLowerCase().includes(s)).slice(0, 4) : []
    return [
      ...hits.map((b) => ({ kind: 'beat' as const, beat: b })),
      ...people.map((c) => ({ kind: 'contact' as const, contact: c })),
      ...deals.map((x) => ({ kind: 'sale' as const, sale: x })),
      ...snds.map((x) => ({ kind: 'sound' as const, sound: x })),
      ...cmds.map((c) => ({ kind: 'cmd' as const, cmd: c }))
    ]
  }, [q, beats, contacts, sales, sounds, commands])

  const run = (idx: number) => {
    const it = items[idx]
    if (!it) return
    onClose()
    if (it.kind === 'beat') onPickBeat(it.beat)
    else if (it.kind === 'contact') onPickContact(it.contact)
    else if (it.kind === 'sale') onPickSale(it.sale)
    else if (it.kind === 'sound') onPickSound(it.sound)
    else it.cmd.run()
  }

  const s = q.trim().toLowerCase()
  const cmds = items.flatMap((it) => (it.kind === 'cmd' ? [it.cmd] : []))
  const tag = { beat: 'Beat', contact: 'Contact', sale: 'Sale', sound: 'Sound', cmd: 'Action' } as const
  return (
    <TooltipProvider delay={120}>
      <div className="pal4-scrim" onMouseDown={onClose}>
        <Reveal className="pal4-wrap">
          <div className="pal4 sx" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
            <div className="pal4-box">
              <Search aria-hidden="true" />
              <input
                ref={input}
                className="pal4-in"
                value={q}
                aria-label="Search beats, or type a command"
                role="combobox"
                aria-expanded="true"
                aria-controls="pal4-list"
                aria-activedescendant={items.length ? `pal4-o-${i}` : undefined}
                placeholder={still ? HINTS[0] : ''}
                onChange={(e) => { setQ(e.target.value); setI(0) }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)) }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
                  else if (e.key === 'Enter') run(i)
                  else if (e.key === 'Escape') onClose()
                }}
              />
              {!q && !still && <TypingAnimation className="pal4-ph" words={HINTS} loop typeSpeed={40} deleteSpeed={20} pauseDelay={1800} startOnView={false} showCursor={false} />}
              <kbd className="sx-kbd">Esc</kbd>
            </div>
            <div className="pal4-list" id="pal4-list" role="listbox" aria-label="Results" ref={listRef}>
              {items.map((it, idx) => (
                <div key={idx} id={`pal4-o-${idx}`} role="option" aria-selected={idx === i} className="pal4-o" onMouseEnter={() => setI(idx)} onClick={() => run(idx)}>
                  <span className={`pal4-k ${it.kind}`} style={it.kind === 'beat' ? { ['--st' as string]: `var(--${it.beat.status})` } : undefined}><i />{tag[it.kind]}</span>
                  {it.kind === 'beat' ? (
                    <><span className="pal4-t"><Hi text={it.beat.title} q={s} /></span><span className="pal4-h">{fmtBpm(it.beat.bpm)} · {displayKey(it.beat.key)} · {it.beat.status}</span></>
                  ) : it.kind === 'sound' ? (
                    <><span className="pal4-t"><Hi text={it.sound.n} q={s} /></span><span className="pal4-h">{it.sound.k}</span></>
                  ) : it.kind === 'sale' ? (
                    <><span className="pal4-t"><Hi text={`${it.sale.beatTitle} → ${it.sale.buyer}`} q={s} /></span><span className="pal4-h">{it.sale.licenseName} · ${it.sale.price}</span></>
                  ) : it.kind === 'contact' ? (
                    <><span className="pal4-t"><Hi text={it.contact.name} q={s} /></span><span className="pal4-h">{it.contact.role}</span></>
                  ) : (
                    <><span className="pal4-t"><Hi text={it.cmd.label} q={s} /></span><span className="pal4-h">{it.cmd.hint}</span></>
                  )}
                </div>
              ))}
              {!items.length && <div className="pal4-none" role="status">Nothing found</div>}
            </div>
            {cmds.length > 0 && (
              <Dock className="pal4-dock" iconSize={34} iconMagnification={still ? 34 : 46} disableMagnification={!!still} iconDistance={110}>
                {cmds.map((c) => (
                  <DockIcon key={c.id} className="pal4-di">
                    <Tip label={c.hint ? `${c.label} (${c.hint})` : c.label}>
                      <button type="button" aria-label={c.label} onClick={() => { onClose(); c.run() }}>
                        {iconFor(c) ? <Icon name={iconFor(c)!} /> : <span className="pal4-ab">{c.label.replace(/^(Go to|Open) /, '').slice(0, 2)}</span>}
                      </button>
                    </Tip>
                  </DockIcon>
                ))}
              </Dock>
            )}
            <footer className="pal4-foot">
              <span><kbd className="sx-kbd">↑</kbd><kbd className="sx-kbd">↓</kbd> move</span>
              <span><kbd className="sx-kbd">Enter</kbd> open</span>
              <span><kbd className="sx-kbd">Esc</kbd> close</span>
              <span className="sx-sp" />
              <span><kbd className="sx-kbd">⌘K</kbd> anywhere</span>
            </footer>
          </div>
        </Reveal>
      </div>
    </TooltipProvider>
  )
}
