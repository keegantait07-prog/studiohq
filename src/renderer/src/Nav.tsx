import type { ReactNode } from 'react'
import { clickable } from './a11y'
import { Icon } from './Icons'
import { SECTIONS, hasDot, sectionOf, sectionTarget, type SectionId, type ViewId } from './navModel'

/** What a tab shows beside its name: a count or "!" when something needs a look. */
export type TabBadges = Partial<Record<ViewId, string | null>>

/** The narrow icon strip on the left: one button per section, plus whatever the app puts at the bottom. Hover for the name. */
export function Rail({ view, last, onGo, badges, brand, children }: {
  view: ViewId; last: Partial<Record<SectionId, ViewId>>; onGo: (v: ViewId) => void; badges: TabBadges; brand: ReactNode; children: ReactNode
}) {
  const here = sectionOf(view)
  const flags = Object.fromEntries(Object.entries(badges).map(([k, v]) => [k, !!v])) as Partial<Record<ViewId, boolean>>
  return (
    <nav className="side rail" aria-label="Sections">
      <div className="brand">{brand}</div>
      {SECTIONS.map((s) => (
        <a key={s.id} className={`nav rail-item ${here.id === s.id ? 'on' : ''}`} title={s.label} aria-label={s.label} aria-current={here.id === s.id ? 'page' : undefined}
          {...clickable(() => onGo(sectionTarget(s, last, view)))}>
          <em className="nl"><Icon name={s.icon} /></em>
          {hasDot(s, flags) && <i className="rail-dot" aria-label="Needs a look" />}
        </a>
      ))}
      <div className="grow" />
      {children}
    </nav>
  )
}

/** The tabs for the section you are in, sitting in the strip at the top of the window. `extra` goes after the tabs (saved searches). */
export function TabBar({ view, onGo, badges, extra }: { view: ViewId; onGo: (v: ViewId) => void; badges: TabBadges; extra?: ReactNode }) {
  const s = sectionOf(view)
  if (s.tabs.length < 2) return null
  return (
    <div className="tabbar" role="tablist" aria-label={s.label}>
      {s.tabs.map((t) => (
        <button key={t.view} role="tab" aria-selected={view === t.view} className={`tab ${view === t.view ? 'on' : ''}`} onClick={() => onGo(t.view)}>
          {t.label}{badges[t.view] ? <span className="badge">{badges[t.view]}</span> : null}
        </button>
      ))}
      {extra}
    </div>
  )
}
