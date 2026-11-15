import { type ReactNode } from 'react'

/** Icon-only buttons get a small bubble with an arrow. The button keeps its aria-label; the bubble is decoration for sighted users. */
export function Tip({ label, side = 'bottom', children }: { label: string; side?: 'top' | 'bottom'; children: ReactNode }) {
  return (
    <span className={`tip tip-${side}`}>
      {children}
      <span className="tip-bubble" aria-hidden="true">{label}</span>
    </span>
  )
}
