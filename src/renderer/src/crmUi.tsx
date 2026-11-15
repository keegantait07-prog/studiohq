// Glue for the v4 Pitch CRM: thin wrappers that compose the library parts (components/lib) the same way
// everywhere on this screen. No widget is drawn here by hand except the avatar and segmented control,
// which have no library part (listed in the build report).
import type { ReactElement, ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/lib/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/lib/tooltip'
import { NumberTicker } from '@/components/lib/number-ticker'
import { BlurFade } from '@/components/lib/blur-fade'

export { Button }

/** Icon-only button with a library tooltip. */
export function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Wraps any element with a library tooltip. */
export function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Library number ticker; a plain number when the user asked for less motion. */
export function Num({ value }: { value: number }) {
  const still = useReducedMotion()
  return still ? <>{value}</> : <NumberTicker value={value} className="pc-num" />
}

/** Library blur-fade entrance; nothing when the user asked for less motion. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const still = useReducedMotion()
  if (still) return <div className={className}>{children}</div>
  return <BlurFade delay={delay} duration={0.32} offset={6} blur="4px" className={className}>{children}</BlurFade>
}

/** Library link-variant button that opens the URL through the app. (Skiper40 links import next/link, which this app does not have.) */
export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return <Button variant="link" size="xs" className="pc-xlink" onClick={() => window.api.openExternal(href)}>{children}<ExternalLink aria-hidden="true" /></Button>
}

const AV = ['--idea', '--wip', '--finished', '--sent', '--sold']
/** Initial in a status-coloured circle (no library avatar exists). */
export function Avatar({ name, big }: { name: string; big?: boolean }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return <span className={`pc-av${big ? ' big' : ''}`} style={{ ['--c' as string]: `var(${AV[h % AV.length]})` }} aria-hidden="true">{(name.trim()[0] ?? '?').toUpperCase()}</span>
}

/** Segmented control, 21st 43122 pattern (no library part). */
export function Seg<T extends string>({ value, options, onChange, label, full, tabs }: { value: T; options: { v: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; full?: boolean; tabs?: boolean }) {
  return (
    <div className={`pc-seg${full ? ' full' : ''}`} role={tabs ? 'tablist' : 'group'} aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" {...(tabs ? { role: 'tab', 'aria-selected': value === o.v } : { 'aria-pressed': value === o.v })} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  )
}
