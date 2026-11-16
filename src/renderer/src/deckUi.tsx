// Glue for the v4 Deck shell, Home and Beats: thin wrappers that compose library parts (components/lib,
// base-ui) the same way everywhere. Nothing here draws its own widget; each wrapper only adds the
// reduced-motion fallback and the app's class names.
import type { ReactElement, ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Tabs } from '@base-ui/react/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/lib/tooltip'
import { NumberTicker } from '@/components/lib/number-ticker'
import { BlurFade } from '@/components/lib/blur-fade'
import { Button } from '@/components/lib/button'
import { MagicCard } from '@/components/lib/magic-card'
import { TextRoll } from '@/components/lib/skiper-ui/skiper58'
import { SkiperGooeyFilterProvider } from '@/components/lib/skiper-ui/skiper64'

/** Library tooltip (with arrow) on any element. The element keeps its own aria-label. */
export function Tip({ label, side = 'bottom', children }: { label: string; side?: 'top' | 'bottom'; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className="dk-tip">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Library number ticker; a plain number under reduced motion. prefix/suffix stay still around it. */
export function Num({ value, prefix = '', suffix = '', className }: { value: number; prefix?: string; suffix?: string; className?: string }) {
  const still = useReducedMotion()
  return (
    <span className={`dk-num ${className ?? ''}`} aria-label={`${prefix}${value.toLocaleString('en-US')}${suffix}`}>
      <span aria-hidden="true">{prefix}{still ? value.toLocaleString('en-US') : <NumberTicker value={value} className="dk-num-t" />}{suffix}</span>
    </span>
  )
}

/** A badge or counter that may be a number or a short word ("!"): numbers tick, words stay. */
export function Count({ value }: { value: string | number }) {
  const n = typeof value === 'number' ? value : /^\d+$/.test(value) ? +value : null
  return n == null ? <>{value}</> : <Num value={n} />
}

/** Library blur-fade entrance; a plain div under reduced motion. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const still = useReducedMotion()
  if (still) return <div className={className}>{children}</div>
  return <BlurFade delay={delay} duration={0.3} offset={6} blur="4px" className={className}>{children}</BlurFade>
}

/** Skiper 58 TextRoll on hover; plain text under reduced motion. */
export function Roll({ text }: { text: string }) {
  const still = useReducedMotion()
  return still ? <span className="st-roll">{text}</span> : <TextRoll className="st-roll">{text}</TextRoll>
}

export interface SegItem<T extends string> { id: T; label: ReactNode; dot?: boolean; count?: number }

/** Segmented control on base-ui Tabs: the library Indicator slides under the active item. */
export function Seg<T extends string>({ items, value, onChange, label, className }: { items: SegItem<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <Tabs.Root value={value} onValueChange={(v) => onChange(v as T)} className={`dk-seg ${className ?? ''}`}>
      <Tabs.List aria-label={label} className="dk-seg-list" activateOnFocus={false}>
        {items.map((it) => (
          <Tabs.Tab key={it.id} value={it.id} data-s={it.id} className="dk-seg-tab">
            {it.dot && <i aria-hidden="true" />}{it.label}{it.count != null && <span>{it.count}</span>}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className="dk-seg-ind" renderBeforeHydration={false} />
      </Tabs.List>
    </Tabs.Root>
  )
}

export interface GooChip { id: string; label: string; on?: boolean; disabled?: boolean; title: string; onClick: () => void }

/** Toggle chips: library Buttons over a blob layer run through the Skiper 64 gooey filter, so the lit
 *  blob stretches (Skiper 64's spring) and melts into its neighbour. */
export function GooToggles({ chips }: { chips: GooChip[] }) {
  const still = useReducedMotion()
  return (
    <div className="dk-chips">
      <SkiperGooeyFilterProvider />
      <div className="dk-blobs" aria-hidden="true">
        {chips.map((c) => (
          <motion.i key={c.id} className={`dk-blob ${c.on ? 'on' : ''} ${c.disabled ? 'off' : ''}`}
            animate={{ scaleX: c.on ? 1.14 : 1 }}
            transition={still ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}>{c.label}</motion.i>
        ))}
      </div>
      {chips.map((c) => (
        <Tip key={c.id} label={c.title}>
          <Button variant="outline" size="sm" className={`dk-chip ${c.on ? 'on' : ''}`} onClick={c.onClick} aria-pressed={c.on === undefined ? undefined : c.on} disabled={c.disabled}>{c.label}</Button>
        </Tip>
      ))}
    </div>
  )
}

/** Magic UI MagicCard cursor spotlight; only with a hovering pointer and full motion. */
export function Spot({ children, className }: { children: ReactNode; className?: string }) {
  const still = useReducedMotion()
  const hover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
  if (still || !hover) return <div className={className}>{children}</div>
  return <MagicCard gradientSize={180} gradientFrom="var(--text)" gradientTo="var(--accent)" gradientColor="var(--raise)" gradientOpacity={0.3} className={className}>{children}</MagicCard>
}

export { Button }
