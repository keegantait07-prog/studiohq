// Glue for the v4 Sales and Store screens: thin wrappers over library parts. Hand-made here: Seg (no library tabs), Art (no cover art exists).
import type { ReactElement, ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'
import NumberFlow from '@number-flow/react'
import { Button } from '@/components/lib/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/lib/tooltip'
import { BlurFade } from '@/components/lib/blur-fade'

export { Button }
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Skiper 37 rolling number (NumberFlow), whole dollars or counts. Still when the user asked for less motion. */
export function Roll({ value, money, cents }: { value: number; money?: boolean; cents?: boolean }) {
  const still = useReducedMotion()
  return <NumberFlow value={value} animated={!still} format={money ? { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 } : undefined} />
}

export function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const still = useReducedMotion()
  if (still) return <div className={className}>{children}</div>
  return <BlurFade delay={delay} duration={0.3} offset={6} blur="4px" className={className}>{children}</BlurFade>
}

export function Seg<T extends string>({ value, options, onChange, label, tabs }: { value: T; options: { v: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; tabs?: boolean }) {
  return (
    <div className="sl-seg" role={tabs ? 'tablist' : 'group'} aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" {...(tabs ? { role: 'tab', 'aria-selected': value === o.v } : { 'aria-pressed': value === o.v })} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  )
}

const HUES = ['--idea', '--wip', '--finished', '--sent', '--sold']
/** Square tile in a status colour with the beat's initial: stands in for cover art, which beats do not have. */
export function Art({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return <span className="sl-art" style={{ width: size, height: size, ['--c' as string]: `var(${HUES[h % HUES.length]})` }} aria-hidden="true">{(name.trim()[0] ?? '?').toUpperCase()}</span>
}
