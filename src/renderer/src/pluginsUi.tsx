// Glue for the v4 Plugins screen: thin wrappers around library parts. Nothing here removes, disables or fixes anything;
// the screen's handlers live in Plugins.tsx unchanged.
import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { NumberTicker } from '@/components/lib/number-ticker'
import { BlurFade } from '@/components/lib/blur-fade'

export { Button } from '@/components/lib/button'

/** Library number ticker; a plain number when the user asked for less motion. */
export function Num({ value }: { value: number }) {
  const still = useReducedMotion()
  return still ? <>{value}</> : <NumberTicker value={value} className="pg-num" />
}

/** Library blur-fade used as the dialog entrance (keeps the `.modal` class so the app's focus trap still finds it). */
export function DialogFade({ children, className }: { children: ReactNode; className: string }) {
  const still = useReducedMotion()
  if (still) return <div className={className}>{children}</div>
  return <BlurFade duration={0.28} offset={10} blur="6px" direction="up" className={className}>{children}</BlurFade>
}

/**
 * Dynamic toggle: Skiper 3's spring-sized pill (motion `layout` + width spring) turned into a switch.
 * It wraps a real checkbox, so the owner's onChange handler and keyboard behaviour are unchanged.
 */
export function DynToggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  const still = useReducedMotion()
  return (
    <span className={`pg-tg${checked ? ' on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
      <motion.span className="pg-tg-pill" layout={!still} transition={{ type: 'spring', bounce: 0.16, duration: 0.35 }} animate={{ width: checked ? 38 : 30 }} initial={false}>
        <motion.i className="pg-tg-dot" layout={!still} transition={{ type: 'spring', bounce: 0.16, duration: 0.35 }} />
      </motion.span>
    </span>
  )
}

/** Expandable region: height and fade via motion (the Skiper 53 expand idea, applied to list rows). Instant under reduced motion. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const still = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className={className}
          style={{ overflow: 'hidden' }}
          initial={still ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={still ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
          transition={{ duration: still ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
