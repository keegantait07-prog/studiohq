import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from './motion'

type Mode = 'petals' | 'embers' | 'rain'
interface Mote { x: number; y: number; vx: number; vy: number; s: number; rot: number; vr: number; ph: number; a: number; hue: number }
interface Ripple { x: number; y: number; born: number }
interface Puff { x: number; y: number; r: number; a: number }

const MODE: Record<string, Mode | undefined> = { koi: 'petals', citypop: 'petals', magma: 'embers', yatai: 'rain', thorn: 'embers' }
const TAU = Math.PI * 2

/**
 * A light, always-on layer that gives the scenic themes their weather: sakura petals drift down over Koi Pond and City Pop,
 * embers rise over Magma, and on Koi Pond ripples spread from your clicks and from hard hits in the music.
 * It sits above the interface but never takes a click, runs at about 30 frames a second, stops while the window is hidden,
 * draws nothing in the other themes, and stays still when you have asked your Mac for reduced motion.
 */
export function Ambient() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const still = prefersReducedMotion()
    let w = 0, h = 0, dpr = 1
    let mode: Mode | undefined
    let theme = ''
    let motes: Mote[] = []
    const ripples: Ripple[] = []
    let puffs: Puff[] = []
    let raf = 0, last = 0, lvl = 0, lastHit = 0, frames = 0

    const resize = (): void => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = window.innerWidth; h = window.innerHeight
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
    }
    const seed = (): void => {
      theme = document.documentElement.dataset.theme ?? ''
      mode = MODE[theme]
      const n = mode === 'embers' ? 70 : mode === 'petals' ? 30 : mode === 'rain' ? 90 : 0
      motes = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h, ph: Math.random() * TAU, rot: Math.random() * TAU,
        s: mode === 'embers' ? 0.8 + Math.random() * 1.8 : 5 + Math.random() * 6,
        vx: mode === 'embers' ? (Math.random() - 0.5) * 14 : 8 + Math.random() * 14,
        vy: mode === 'embers' ? -(24 + Math.random() * 60) : 24 + Math.random() * 36,
        vr: (Math.random() - 0.5) * 2, a: 0.45 + Math.random() * 0.5, hue: Math.random()
      }))
      if (mode === 'rain') {
        for (const m of motes) { m.s = 10 + Math.random() * 18; m.vx = -(40 + Math.random() * 40); m.vy = 520 + Math.random() * 380; m.a = 0.1 + Math.random() * 0.2 }
        puffs = Array.from({ length: 9 }, () => ({ x: w * (0.15 + Math.random() * 0.7), y: h * (0.62 + Math.random() * 0.3), r: 30 + Math.random() * 40, a: Math.random() * 0.07 }))
      } else puffs = []
      ripples.length = 0
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
    }

    const readLevel = (): number => {
      const v = document.querySelector<HTMLElement>('.player')?.style.getPropertyValue('--lvl')
      return v ? parseFloat(v) || 0 : 0
    }

    const frame = (now: number): void => {
      const dt = Math.min(0.06, (now - last) / 1000)
      last = now
      const t = now / 1000
      if (++frames % 4 === 0) lvl = readLevel()
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)

      if (theme === 'koi' && lvl > 0.62 && t - lastHit > 0.7) { // a hard hit in the music drops a ripple somewhere on the water
        ripples.push({ x: w * (0.25 + Math.random() * 0.5), y: h * (0.3 + Math.random() * 0.45), born: t })
        lastHit = t
      }
      for (let r = ripples.length - 1; r >= 0; r--) {
        const k = (t - ripples[r].born) / 2
        if (k >= 1) { ripples.splice(r, 1); continue }
        for (let ring = 0; ring < 3; ring++) {
          const kk = k - ring * 0.12
          if (kk <= 0) continue
          g.beginPath()
          g.ellipse(ripples[r].x, ripples[r].y, 14 + kk * 150, (14 + kk * 150) * 0.42, 0, 0, TAU)
          g.strokeStyle = `rgba(190, 228, 255, ${Math.pow(1 - kk, 2) * 0.55})`
          g.lineWidth = 1.4
          g.stroke()
        }
      }

      const boost = 1 + lvl * 1.6
      if (mode === 'embers') {
        g.globalCompositeOperation = 'lighter'
        for (const m of motes) {
          m.x += (m.vx + Math.sin(t * 1.3 + m.ph) * 10) * dt
          m.y += m.vy * boost * dt
          if (m.y < -10) { m.y = h + 10; m.x = Math.random() * w }
          const flick = 0.6 + 0.4 * Math.sin(t * 7 + m.ph * 3)
          g.fillStyle = m.hue > 0.5 ? `rgba(255, 165, 0, ${m.a * flick})` : `rgba(255, 70, 40, ${m.a * flick})`
          g.beginPath(); g.arc(m.x, m.y, m.s, 0, TAU); g.fill()
        }
        g.globalCompositeOperation = 'source-over'
      } else if (mode === 'rain') {
        g.lineWidth = 1
        for (const m of motes) {
          m.x += m.vx * dt; m.y += m.vy * dt
          if (m.y > h + 20) { m.y = -20; m.x = Math.random() * (w + 200) }
          if (m.x < -20) m.x += w + 40
          g.strokeStyle = `rgba(205, 220, 240, ${m.a})`
          g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(m.x - m.vx * 0.03, m.y - m.vy * 0.03); g.stroke()
        }
        for (const p of puffs) { // steam: soft wisps that rise from the counter, grow and fade
          p.y -= 16 * dt; p.r += 7 * dt; p.a += (p.y < h * 0.45 ? -0.05 : 0.025) * dt
          if (p.a <= 0.004) { p.x = w * (0.15 + Math.random() * 0.7); p.y = h * (0.78 + Math.random() * 0.15); p.r = 28 + Math.random() * 30; p.a = 0.05 }
          const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r)
          gr.addColorStop(0, `rgba(255, 238, 215, ${Math.min(0.1, p.a)})`); gr.addColorStop(1, 'rgba(255, 238, 215, 0)')
          g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill()
        }
      } else if (mode === 'petals') {
        const pink = theme === 'citypop' ? '255, 150, 210' : '200, 120, 62'
        const blue = '170, 220, 255'
        for (const m of motes) {
          m.x += (m.vx + Math.sin(t * 0.9 + m.ph) * 16) * dt
          m.y += m.vy * dt
          m.rot += m.vr * dt
          if (m.y > h + 12) { m.y = -12; m.x = Math.random() * w }
          if (m.x > w + 12) m.x = -12
          g.save()
          g.translate(m.x, m.y); g.rotate(m.rot)
          g.fillStyle = `rgba(${theme === 'citypop' && m.hue > 0.82 ? blue : pink}, ${m.a * 0.8})`
          g.beginPath(); g.ellipse(0, 0, m.s, m.s * 0.55, 0, 0, TAU); g.fill()
          g.restore()
        }
      }
    }

    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (document.hidden || !mode) { last = now; return }
      if (now - last < 33) return
      frame(now)
    }
    const onClick = (e: PointerEvent): void => {
      if (theme === 'koi' && !still) ripples.push({ x: e.clientX, y: e.clientY, born: performance.now() / 1000 })
    }
    const onTheme = (): void => { seed(); if (still && mode) frame(performance.now()) }

    resize(); seed()
    window.addEventListener('resize', resize)
    window.addEventListener('shq-theme', onTheme)
    window.addEventListener('pointerdown', onClick)
    if (!still) raf = requestAnimationFrame(loop)
    else if (mode) frame(performance.now())
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('shq-theme', onTheme)
      window.removeEventListener('pointerdown', onClick)
    }
  }, [])

  return <canvas ref={ref} className="ambient" aria-hidden />
}
