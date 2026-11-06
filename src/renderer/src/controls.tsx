import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * Tactile controls for the Stage: a dial with an LED ring, a vertical fader, a switch.
 * They are real sliders and switches for assistive tech and the keyboard, and every one of them is wired to something that works.
 * The global shortcuts (space, arrows) are blocked while a control has focus, so nudging a dial never skips the track.
 */

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const snap = (n: number, step: number, lo: number): number => Math.round((n - lo) / step) * step + lo

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  def?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

/** Shared drag / wheel / keyboard behaviour. `span` is how many pixels of vertical drag cover the full range. */
function useSliderInput({ value, min, max, step = 0.01, def, onChange }: SliderProps, span: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const drag = useRef<{ y: number; v: number } | null>(null)
  const live = useRef({ value, min, max, step, onChange })
  live.current = { value, min, max, step, onChange }
  const set = (v: number): void => { const c = live.current; c.onChange(clamp(snap(v, c.step, c.min), c.min, c.max)) }

  // React's wheel listener is passive, so the page would scroll too; attach a real one.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      const c = live.current
      set(c.value - Math.sign(e.deltaY) * c.step * (e.shiftKey ? 1 : 4))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  return {
    ref,
    active,
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y: e.clientY, v: value }
        setActive(true)
      },
      onPointerMove: (e: PointerEvent) => {
        const d = drag.current
        if (!d) return
        const range = max - min
        set(d.v + ((d.y - e.clientY) / span) * range * (e.shiftKey ? 0.2 : 1))
      },
      onPointerUp: () => { drag.current = null; setActive(false) },
      onPointerCancel: () => { drag.current = null; setActive(false) },
      onDoubleClick: () => { if (def != null) onChange(def) },
      onKeyDown: (e: KeyboardEvent) => {
        const big = (max - min) / 10
        const moves: Record<string, number> = {
          ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big
        }
        if (e.key in moves) { e.preventDefault(); e.stopPropagation(); set(value + moves[e.key] * (e.shiftKey ? 0.2 : 1)); return }
        if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); onChange(min) }
        else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); onChange(max) }
        else if (e.key === 'Enter' && def != null) { e.preventDefault(); e.stopPropagation(); onChange(def) }
      }
    }
  }
}

const SEGMENTS = 27
const SWEEP = 270

/** A chrome-capped dial inside a ring of LEDs. Drag up or down, scroll, or use the arrow keys; double-click resets. */
export function Dial(props: SliderProps & { size?: number }) {
  const { label, value, min, max, format, size = 124 } = props
  const { ref, active, handlers } = useSliderInput(props, 170)
  const frac = (value - min) / (max - min)
  const lit = Math.round(frac * SEGMENTS)
  const text = format ? format(value) : String(value)
  return (
    <div className="ctl">
      <div
        ref={ref}
        className={`dial ${active ? 'active' : ''}`}
        style={{ '--sz': `${size}px`, '--a': `${-SWEEP / 2 + frac * SWEEP}deg` } as CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        {...handlers}
      >
        <i className="backlight" />
        <svg viewBox="0 0 120 120" aria-hidden>
          {Array.from({ length: SEGMENTS }, (_, i) => {
            const a = ((-SWEEP / 2 + (i / (SEGMENTS - 1)) * SWEEP) * Math.PI) / 180
            const x1 = 60 + Math.sin(a) * 51, y1 = 60 - Math.cos(a) * 51
            const x2 = 60 + Math.sin(a) * 58, y2 = 60 - Math.cos(a) * 58
            return <line key={i} className={`led-seg ${i < lit || (i === 0 && frac > 0) ? 'on' : ''}`} x1={x1.toFixed(2)} y1={y1.toFixed(2)} x2={x2.toFixed(2)} y2={y2.toFixed(2)} />
          })}
        </svg>
        <div className="dial-cap"><div className="dial-notch" /></div>
      </div>
      <span className="ctl-label">{label}</span>
      <span className="ctl-val">{text}</span>
    </div>
  )
}

const FADER_H = 156

/** A vertical fader with a chrome cap and an LED fill. */
export function VFader(props: SliderProps) {
  const { label, value, min, max, format } = props
  const { ref, active, handlers } = useSliderInput(props, FADER_H - 36)
  const frac = (value - min) / (max - min)
  const text = format ? format(value) : String(value)
  return (
    <div className="ctl">
      <div
        ref={ref}
        className={`vfader ${active ? 'active' : ''}`}
        style={{ '--h': `${FADER_H}px`, '--f': frac } as CSSProperties}
        role="slider"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        {...handlers}
      >
        <i className="backlight" />
        <div className="vf-track"><i className="vf-fill" /></div>
        <div className="vf-cap" />
      </div>
      <span className="ctl-label">{label}</span>
      <span className="ctl-val">{text}</span>
    </div>
  )
}

/** A switch with a chrome thumb and a lamp that lights when it is on. */
export function Switch({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="tgl"
      title={hint}
      onClick={() => onChange(!on)}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation() }}
    >
      <span className="tgl-label">{label}</span>
      <span className="tgl-track"><i className="tgl-thumb" /></span>
    </button>
  )
}
