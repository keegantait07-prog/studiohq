import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { SECTIONS, type ViewId } from './navModel'
import { Search } from 'lucide-react'
import { Count, Roll } from './deckUi'

export type TabBadges = Partial<Record<ViewId, string | null>>

/** The top bar. The player is the header: brand, now playing, find, session. */
export function Transport({ brand, deck, onFind, right }: { brand: ReactNode; deck: ReactNode; onFind: () => void; right?: ReactNode }) {
  return (
    <header className="transport">
      <div className="tp-brand">{brand}<span className="tp-name">Studio HQ</span></div>
      <div className="deck" aria-label="Player">{deck}</div>
      <button className="tp-find" onClick={onFind} aria-label="Find a beat, lead or action (⌘K)">
        <Search size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Find a beat, lead or action</span><kbd>⌘K</kbd>
      </button>
      <div className="tp-right">{right}</div>
    </header>
  )
}

/** Every screen in one flat row, grouped by section. The underline glides: its leading edge runs ahead, then the trailing edge catches up (from 21st segmented control 43122). */
export function SectionStrip({ view, onGo, badges, end }: { view: ViewId; onGo: (v: ViewId) => void; badges: TabBadges; end?: ReactNode }) {
  const nav = useRef<HTMLElement>(null)
  const line = useRef<HTMLSpanElement>(null)
  const last = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = nav.current, ln = line.current
    if (!el || !ln) return
    const place = () => {
      const on = el.querySelector<HTMLElement>('.st-tab.on')
      if (!on) { ln.style.opacity = '0'; return }
      const pad = parseFloat(getComputedStyle(on).paddingLeft) || 10
      const l = on.offsetLeft + pad, r = el.clientWidth - (on.offsetLeft + on.offsetWidth) + pad
      ln.dataset.dir = last.current == null ? '' : l > last.current ? 'right' : 'left'
      if (last.current == null) ln.style.transition = 'none' // nothing grows in on first paint
      ln.style.left = l + 'px'; ln.style.right = r + 'px'; ln.style.opacity = '1'
      if (last.current == null) { void ln.offsetWidth; ln.style.transition = '' }
      last.current = l
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [view])
  return (
    <nav className="strip" ref={nav} aria-label="Screens">
      {SECTIONS.map((s, i) => (
        <div key={s.id} className="st-group" role="group" aria-label={s.label}>
          {i > 0 && <span className="st-sep" aria-hidden="true" />}
          {s.tabs.map((t) => (
            <button key={t.view} className={`st-tab ${view === t.view ? 'on' : ''}`} aria-current={view === t.view ? 'page' : undefined} onClick={() => onGo(t.view)}>
              <Roll text={t.label} />{badges[t.view] && <span className="st-badge"><Count value={badges[t.view] as string} /></span>}
            </button>
          ))}
        </div>
      ))}
      <span className="st-gap" />
      {end}
      <span className="st-line" ref={line} aria-hidden="true" />
    </nav>
  )
}
