// Glue shared by the Make screens (Sounds, Kits, Map). Widgets come from components/lib; the only hand-made
// widgets here are the segmented control and the pressed chip (no library part for either).
import { useEffect, useState, type ReactNode } from 'react'
import { IconBtn, Tip, Reveal } from './crmUi'
import { Button } from '@/components/lib/button'

export { IconBtn, Tip, Reveal, Button }

/** True when the pointer can really hover (hover effects are skipped on touch). */
export function useHoverCapable(): boolean {
  const q = '(hover: hover)'
  const [ok, setOk] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(q)
    const f = () => setOk(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return ok
}

/** Segmented control, 21st 43122 pattern (no library part). */
export function Seg<T extends string>({ value, options, onChange, label, full }: { value: T; options: { v: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; full?: boolean }) {
  return (
    <div className={`mk-seg${full ? ' full' : ''}`} role="group" aria-label={label}>
      {options.map((o) => <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </div>
  )
}

/** Toggle chip. */
export function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return <button type="button" className="mk-chip" aria-pressed={on} onClick={onClick} title={title}>{children}</button>
}
