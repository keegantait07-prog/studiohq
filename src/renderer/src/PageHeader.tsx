import type { ReactNode } from 'react'

export interface FilterPill { id: string; label: string; count?: number | string }

/** The pill row under a page title: ALL 48 / FINISHED 12. Pure buttons, one is on. */
export function FilterPills({ pills, active, onPick, label }: { pills: FilterPill[]; active: string; onPick: (id: string) => void; label?: string }) {
  return (
    <div className="fpills" role="tablist" aria-label={label}>
      {pills.map((p) => (
        <button key={p.id} role="tab" aria-selected={active === p.id} className={`fpill ${active === p.id ? 'on' : ''}`} onClick={() => onPick(p.id)}>
          {p.label}{p.count != null && <em>{p.count}</em>}
        </button>
      ))}
    </div>
  )
}

/** A big centred chrome title with a small caps eyebrow, a one-line lede and optional filter pills: the page header every main view shares. */
export function PageHeader({ eyebrow, title, lede, pills, active, onPick, pillLabel, children }: {
  eyebrow: string; title: string; lede?: ReactNode
  pills?: FilterPill[]; active?: string; onPick?: (id: string) => void; pillLabel?: string
  children?: ReactNode
}) {
  return (
    <header className="pagehead">
      <div className="ph-eyebrow">{eyebrow}</div>
      <h1 className="ph-title">{title}</h1>
      {lede != null && <p className="ph-lede">{lede}</p>}
      {pills && onPick && <FilterPills pills={pills} active={active ?? ''} onPick={onPick} label={pillLabel} />}
      {children}
    </header>
  )
}
