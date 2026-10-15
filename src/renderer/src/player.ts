import { useEffect, useRef, useState, useCallback } from 'react'

export interface PlayerState { id: number | null; playing: boolean; time: number; duration: number }

export function usePlayer() {
  const el = useRef<HTMLAudioElement | null>(null)
  const cur = useRef<number | null>(null)
  const [state, setState] = useState<PlayerState>({ id: null, playing: false, time: 0, duration: 0 })

  useEffect(() => {
    const a = new Audio()
    a.preload = 'auto'
    el.current = a
    const sync = () => setState((s) => ({ ...s, playing: !a.paused, duration: isFinite(a.duration) ? a.duration : s.duration }))
    let raf = 0
    const tick = () => { setState((s) => (s.time === a.currentTime ? s : { ...s, time: a.currentTime })); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    a.addEventListener('timeupdate', () => setState((s) => ({ ...s, time: a.currentTime })))
    a.addEventListener('error', () => console.error('audio error', a.error?.code, a.error?.message))
    a.addEventListener('play', sync); a.addEventListener('pause', sync); a.addEventListener('ended', sync); a.addEventListener('loadedmetadata', sync)
    return () => { cancelAnimationFrame(raf); a.pause() }
  }, [])

  const play = useCallback((id: number, at?: number) => {
    const a = el.current!
    if (cur.current !== id || !a.src) {
      cur.current = id
      a.src = `shqa://beat/${id}`
      setState((s) => ({ ...s, id, time: 0, duration: 0 }))
    }
    if (at != null) a.currentTime = at
    a.play().catch((e) => console.error('play rejected', String(e)))
  }, [])

  const toggle = useCallback(() => {
    const a = el.current!
    if (!a.src) return
    a.paused ? a.play().catch(() => {}) : a.pause()
  }, [])
  const seek = useCallback((t: number) => { if (el.current) el.current.currentTime = Math.max(0, t) }, [])
  const skip = useCallback((d: number) => { if (el.current) el.current.currentTime = Math.max(0, el.current.currentTime + d) }, [])

  return { ...state, play, toggle, seek, skip }
}
