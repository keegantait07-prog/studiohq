import type { ReactNode } from 'react'
import { clickable } from './a11y'
import { SECTIONS, sectionOf, type ViewId } from './navModel'

/** What an item shows beside its name: a count or "!" when something needs a look. */
export type TabBadges = Partial<Record<ViewId, string | null>>

/**
 * The side navigation: every screen, grouped by what you are doing (Make, Sell, Reach, Studio). It replaces the icon strip
 * and the tab row, so you can see where everything lives. `extra` (saved searches) opens under the screen you are on.
 */
export function SideNav({ view, onGo, badges, brand, onSearch, extra, children }: {
  view: ViewId; onGo: (v: ViewId) => void; badges: TabBadges; brand: ReactNode; onSearch: () => void; extra?: ReactNode; children: ReactNode
}) {
  const here = sectionOf(view)
  return (
    <nav className="side rail sn" aria-label="Screens">
      <div className="brand sn-brand">{brand}</div>
      <button className="sn-search" onClick={onSearch} aria-label="Search everything"><span>Search</span><kbd>⌘K</kbd></button>
      <div className="sn-scroll">
        {SECTIONS.map((s) => (
          <div key={s.id} className="sn-group" role="group" aria-label={s.label}>
            {s.id !== 'home' && <div className="sn-h">{s.label}</div>}
            {s.tabs.map((t) => (
              <div key={t.view}>
                <a className={`nav sn-item ${view === t.view ? 'on' : ''}`} aria-current={view === t.view ? 'page' : undefined} {...clickable(() => onGo(t.view))}>
                  <span className="nl">{s.id === 'home' ? 'Home' : t.label}</span>
                  {badges[t.view] ? <span className="sn-badge">{badges[t.view]}</span> : null}
                </a>
                {view === t.view && here.id === s.id && extra}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="sn-foot">{children}</div>
    </nav>
  )
}
