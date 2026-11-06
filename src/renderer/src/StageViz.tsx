import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from './motion'

interface Props {
  /** The playing beat's stored peaks, 0 to 255. */
  peaks: number[]
  duration: number
  playing: boolean
  getTime: () => number
  /** Hue of the beat's key, 0 to 360, or null when it has none. */
  hue: number | null
}

interface Particle { th: number; rr: number; w: number; size: number; a: number; dx: number; dy: number; vx: number; vy: number; shift: number }
interface Ripple { x: number; y: number; born: number; strong: number }

const TAU = Math.PI * 2
const SIDES = 6
const RINGS = 7
const POINTS = 140

/** The hue of the theme's own accent, used when the playing beat has no key (or nothing is playing). */
function themeHue(el: HTMLElement): number {
  const m = getComputedStyle(el).getPropertyValue('--accent-rgb').match(/\d+/g)
  if (!m || m.length < 3) return 190
  const [r, g, b] = m.slice(0, 3).map((n) => Number(n) / 255)
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b)
  if (d === 0) return 190
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const ballistic = (cur: number, target: number, dt: number, attack: number, release: number): number =>
  cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? attack : release)))

/**
 * The Stage's centrepiece. Concentric loops start as slow organic waves and are pulled toward hexagons as the music gets louder,
 * hard hits throw hexagonal ripples outward, and a field of particles orbits through it and is pushed around by the pointer.
 * It only reads the stored peaks, so it never touches the audio. It idles slowly, pauses while the window is hidden,
 * and under reduced motion it draws a single still frame.
 */
export function StageViz(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef(props)
  live.current = props
  const pointer = useRef({ x: -9999, y: -9999 })
  const burst = useRef<(x: number, y: number) => void>(() => undefined)

  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const still = prefersReducedMotion()
    let w = 0, h = 0, dpr = 1
    const size = (): void => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = c.clientWidth; h = c.clientHeight
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr))
    }
    size()

    const particles: Particle[] = Array.from({ length: 190 }, () => ({
      th: Math.random() * TAU, rr: 0.1 + Math.random() * 0.46, w: (0.04 + Math.random() * 0.2) * (Math.random() < 0.5 ? -1 : 1),
      size: 0.7 + Math.random() * 1.8, a: 0.35 + Math.random() * 0.55, dx: 0, dy: 0, vx: 0, vy: 0, shift: Math.random() * 70 - 15
    }))
    const ripples: Ripple[] = []
    let fallbackHue = themeHue(c), frames = 0
    let lvl = 0, slow = 0, morph = 0.1, hue = live.current.hue ?? fallbackHue
    let lastRipple = -1, last = performance.now(), lastDraw = 0

    burst.current = (x: number, y: number): void => {
      ripples.push({ x, y, born: performance.now() / 1000, strong: 0.9 })
      if (ripples.length > 8) ripples.shift()
      for (const p of particles) {
        const px = w / 2 + Math.cos(p.th) * p.rr * Math.min(w, h) + p.dx, py = h / 2 + Math.sin(p.th) * p.rr * Math.min(w, h) * 0.92 + p.dy
        const d = Math.hypot(px - x, py - y)
        if (d < 260 && d > 1) { const f = (1 - d / 260) * 420; p.vx += ((px - x) / d) * f; p.vy += ((py - y) / d) * f }
      }
    }

    const frame = (now: number): void => {
      const L = live.current
      const t = now / 1000
      const dt = clamp((now - last) / 1000, 0.001, 0.05)
      last = now
      const md = Math.min(w, h)
      const cx = w / 2, cy = h / 2

      // level at the playhead, or a slow breath when nothing is playing
      let target = 0.1 + 0.04 * Math.sin(t * 0.8)
      if (L.playing && L.peaks.length) {
        const i = clamp(Math.floor((L.getTime() / (L.duration || 1)) * L.peaks.length), 0, L.peaks.length - 1)
        target = L.peaks[i] / 255
      }
      if (still) target = 0.25
      lvl = ballistic(lvl, target, dt, 0.04, 0.3)
      slow = ballistic(slow, target, dt, 0.5, 0.8)
      if (L.playing && target - slow > 0.16 && t - lastRipple > 0.2) {
        ripples.push({ x: cx, y: cy, born: t, strong: Math.min(1, (target - slow) * 3) })
        lastRipple = t
        if (ripples.length > 8) ripples.shift()
      }
      morph = ballistic(morph, still ? 0.3 : L.playing ? clamp(0.12 + lvl * 1.15, 0, 1) : 0.1, dt, 0.2, 0.45)
      if (++frames % 90 === 0) fallbackHue = themeHue(c) // follows a theme change
      const goal = L.hue ?? fallbackHue
      hue = (hue + (((goal - hue + 540) % 360) - 180) * (1 - Math.exp(-dt / 0.35)) + 360) % 360

      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.globalCompositeOperation = 'lighter'
      g.lineJoin = 'round'

      // a soft core
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, md * (0.16 + 0.16 * lvl))
      core.addColorStop(0, `hsla(${hue}, 100%, 60%, ${0.2 + 0.22 * lvl})`)
      core.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`)
      g.fillStyle = core
      g.fillRect(cx - md, cy - md, md * 2, md * 2)

      // long organic ribbons behind everything
      for (let k = 0; k < 3; k++) {
        g.beginPath()
        for (let x = 0; x <= w; x += 8) {
          const y = cy + Math.sin((x / w) * TAU * (1.2 + k * 0.5) + t * (0.5 + k * 0.2) + k * 2) * md * (0.04 + 0.1 * lvl) * (1 + k * 0.3) + Math.sin(x * 0.013 + t * 0.9 + k) * md * 0.02
          x === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.strokeStyle = `hsla(${hue + 40 + k * 10}, 100%, 65%, ${0.08 + 0.12 * lvl})`
        g.lineWidth = 1.2
        g.stroke()
      }

      // concentric loops: organic when quiet, hexagonal when loud
      for (let i = 0; i < RINGS; i++) {
        const R = md * (0.12 + i * 0.052) * (1 + 0.05 * lvl)
        const amp = (0.035 + 0.11 * lvl) * (1 - i * 0.09)
        const rot = t * 0.08 * (i % 2 ? 1 : -1) + i * 0.3
        g.beginPath()
        for (let j = 0; j <= POINTS; j++) {
          const th = (j / POINTS) * TAU
          const organic = 1 + amp * (0.5 * Math.sin(3 * th + t * 0.6 + i) + 0.3 * Math.sin(5 * th - t * 0.9 + i * 1.7) + 0.4 * Math.sin(2 * th + t * 0.35 + i * 0.5))
          const a = ((((th + rot) % (TAU / SIDES)) + TAU / SIDES) % (TAU / SIDES)) - Math.PI / SIDES
          const poly = Math.cos(Math.PI / SIDES) / Math.cos(a)
          const r = R * (organic * (1 - morph) + poly * morph * (1 + 0.06 * lvl))
          const x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r
          j === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.closePath()
        const col = `${hue + i * 7}, 100%, 60%`
        g.strokeStyle = `hsla(${col}, ${(0.05 + 0.05 * lvl) * (1 - i * 0.08)})`
        g.lineWidth = 7
        g.stroke()
        g.strokeStyle = `hsla(${col}, ${0.78 - i * 0.08})`
        g.lineWidth = 1.1 + lvl * 1.6
        g.stroke()
      }

      // hexagonal ripples thrown out by hard hits and by clicks
      for (let r = ripples.length - 1; r >= 0; r--) {
        const rp = ripples[r]
        const k = (t - rp.born) / 1.8
        if (k >= 1) { ripples.splice(r, 1); continue }
        const R = md * (0.08 + k * 0.62)
        g.beginPath()
        for (let s = 0; s <= SIDES; s++) {
          const a = (s / SIDES) * TAU + Math.PI / 6 + k * 0.4
          const x = rp.x + Math.cos(a) * R, y = rp.y + Math.sin(a) * R
          s === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.strokeStyle = `hsla(${hue + 20}, 100%, 70%, ${Math.pow(1 - k, 2) * 0.6 * rp.strong})`
        g.lineWidth = 1.6
        g.stroke()
      }

      // particles orbit through it and are pushed by the pointer
      const px = pointer.current.x, py = pointer.current.y
      for (const p of particles) {
        p.th += p.w * (1 + lvl * 2.2) * dt
        const bx = cx + Math.cos(p.th) * p.rr * md, by = cy + Math.sin(p.th) * p.rr * md * 0.92
        p.vx += -p.dx * 7 * dt; p.vy += -p.dy * 7 * dt
        const ddx = bx + p.dx - px, ddy = by + p.dy - py
        const d = Math.hypot(ddx, ddy)
        if (d < 150 && d > 0.5) { const f = Math.pow(1 - d / 150, 2) * 1400 * dt; p.vx += (ddx / d) * f; p.vy += (ddy / d) * f }
        const damp = Math.exp(-dt * 3)
        p.vx *= damp; p.vy *= damp
        p.dx += p.vx * dt; p.dy += p.vy * dt
        g.fillStyle = `hsla(${hue + p.shift}, 100%, 72%, ${p.a * (0.45 + 0.55 * Math.min(1, lvl * 1.4 + 0.2))})`
        g.beginPath()
        g.arc(bx + p.dx, by + p.dy, p.size * (1 + lvl * 0.5), 0, TAU)
        g.fill()
      }
      g.globalCompositeOperation = 'source-over'
    }

    let raf = 0
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (document.hidden) { last = now; return }
      if (!live.current.playing && now - lastDraw < 33) return // idle drift at about 30 frames a second
      lastDraw = now
      frame(now)
    }
    const ro = new ResizeObserver(() => { size(); if (still) frame(performance.now()) })
    ro.observe(c)
    if (still) frame(performance.now())
    else raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); burst.current = () => undefined }
  }, [])

  const at = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  return (
    <canvas
      ref={ref}
      className="stage-viz"
      aria-hidden
      onPointerMove={(e) => { pointer.current = at(e) }}
      onPointerLeave={() => { pointer.current = { x: -9999, y: -9999 } }}
      onPointerDown={(e) => { const p = at(e); burst.current(p.x, p.y) }}
    />
  )
}
