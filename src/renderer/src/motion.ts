import { useEffect } from 'react'

export const prefersReducedMotion = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

interface DriverInput {
  playing: boolean
  duration: number
  peaks: number[]
  getTime: () => number
  subscribe: (l: () => void) => () => void
}

/** Like a real meter: rises fast, falls slowly. `tau` values are in seconds. */
const ballistic = (cur: number, target: number, dt: number, attack: number, release: number): number =>
  cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? attack : release)))

/**
 * Turns the playing beat's stored peaks into a handful of CSS variables, so the interface can move with the music
 * without a Web Audio graph and without re-rendering React per frame.
 *
 *   --lvl            level at the playhead (fast attack, slow release)
 *   --lvl-a/b/c      the same envelope seen through three different time windows, so they move independently
 *   --prog           playhead position, 0 to 1
 *
 * The variables are written onto the few elements that use them (sidebar, transport, playing row), not the document root,
 * so a change never restyles the whole page. The loop only runs while playing and while the window is visible.
 */
export function useLevelDriver({ playing, duration, peaks, getTime, subscribe }: DriverInput): void {
  useEffect(() => {
    const still = prefersReducedMotion()
    const targets = (): HTMLElement[] => {
      const out: HTMLElement[] = []
      const side = document.querySelector<HTMLElement>('.side'); if (side) out.push(side)
      const player = document.querySelector<HTMLElement>('.player'); if (player) out.push(player)
      const row = document.querySelector<HTMLElement>('.row.now'); if (row) out.push(row)
      return out
    }
    const write = (vars: Record<string, number>): void => {
      for (const el of targets()) for (const k in vars) el.style.setProperty(k, vars[k].toFixed(3))
    }
    const dur = duration || 1
    const at = (t: number): number => {
      if (!peaks.length) return 0
      const i = Math.min(peaks.length - 1, Math.max(0, Math.floor((t / dur) * peaks.length)))
      return peaks[i] / 255
    }
    const progress = (): number => Math.min(1, Math.max(0, getTime() / dur))

    // Paused or reduced motion: the meters rest at zero, and only the playhead position is kept in step.
    if (!playing || still) {
      write({ '--lvl': 0, '--lvl-a': 0, '--lvl-b': 0, '--lvl-c': 0, '--prog': progress() })
      const unsub = subscribe(() => write({ '--prog': progress() }))
      return unsub
    }

    let raf = 0
    let last = 0
    let lvl = 0, a = 0, b = 0, c = 0
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      if (now - last < 33) return // about 30 updates a second is plenty for a meter
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const t = getTime()
      lvl = ballistic(lvl, at(t), dt, 0.03, 0.28)
      a = ballistic(a, at(t), dt, 0.05, 0.22)
      b = ballistic(b, Math.max(at(t - 0.25), at(t)), dt, 0.12, 0.6)
      c = ballistic(c, (at(t - 1) + at(t - 0.5) + at(t) + at(t + 0.5) + at(t + 1)) / 5, dt, 0.3, 1.2)
      write({ '--lvl': lvl, '--lvl-a': a, '--lvl-b': b, '--lvl-c': c, '--prog': t / dur })
    }
    const start = (): void => { if (!raf && !document.hidden) { last = 0; raf = requestAnimationFrame(tick) } }
    const stop = (): void => { cancelAnimationFrame(raf); raf = 0 }
    const onVis = (): void => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    start()
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [playing, duration, peaks, getTime, subscribe])
}
