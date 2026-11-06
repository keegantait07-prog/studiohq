import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

export interface PlayerState { id: number | null; playing: boolean; duration: number }

/**
 * The playhead moves ~60 times a second, so it is NOT React state: putting it there re-rendered the whole app every frame.
 * Components that show the time read it with usePlayerTime(); everything else only re-renders when the track, play state or length changes.
 */
export interface PlayerClock { subscribe: (l: () => void) => () => void; getTime: () => number }

export function usePlayerTime(c: PlayerClock): number {
  return useSyncExternalStore(c.subscribe, c.getTime)
}

export function usePlayer() {
  const el = useRef<HTMLAudioElement | null>(null)
  const cur = useRef<number | null>(null)
  const [state, setState] = useState<PlayerState>({ id: null, playing: false, duration: 0 })
  const timeRef = useRef(0)
  const listeners = useRef(new Set<() => void>())
  const subscribe = useCallback((l: () => void) => { listeners.current.add(l); return () => { listeners.current.delete(l) } }, [])
  const getTime = useCallback(() => timeRef.current, [])
  const setTime = useCallback((t: number) => { if (timeRef.current === t) return; timeRef.current = t; listeners.current.forEach((l) => l()) }, [])

  useEffect(() => {
    const a = new Audio()
    a.preload = 'auto'
    el.current = a
    let raf = 0
    const loop = () => { setTime(a.currentTime); raf = a.paused ? 0 : requestAnimationFrame(loop) } // only runs while playing
    const sync = () => {
      setState((s) => ({ ...s, playing: !a.paused, duration: isFinite(a.duration) ? a.duration : s.duration }))
      setTime(a.currentTime)
      if (!a.paused && !raf) raf = requestAnimationFrame(loop)
    }
    a.addEventListener('timeupdate', () => setTime(a.currentTime))
    a.addEventListener('error', () => console.error('audio error', a.error?.code, a.error?.message))
    a.addEventListener('play', sync); a.addEventListener('pause', sync); a.addEventListener('ended', sync); a.addEventListener('loadedmetadata', sync)
    return () => { cancelAnimationFrame(raf); a.pause() }
  }, [setTime])

  const play = useCallback((id: number, at?: number) => {
    const a = el.current!
    if (cur.current !== id || !a.src) {
      cur.current = id
      a.src = `shqa://beat/${id}`
      setTime(0)
      setState((s) => ({ ...s, id, duration: 0 }))
    }
    if (at != null) {
      // a new source ignores a seek until its metadata is in, so wait for it
      if (a.readyState >= 1) a.currentTime = at
      else a.addEventListener('loadedmetadata', () => { a.currentTime = at }, { once: true })
    }
    a.play().catch((e) => console.error('play rejected', String(e)))
  }, [setTime])

  const toggle = useCallback(() => {
    const a = el.current!
    if (!a.src) return
    a.paused ? a.play().catch(() => {}) : a.pause()
  }, [])
  const seek = useCallback((t: number) => { if (el.current) el.current.currentTime = Math.max(0, t) }, [])
  const skip = useCallback((d: number) => { if (el.current) el.current.currentTime = Math.max(0, el.current.currentTime + d) }, [])

  return { ...state, play, toggle, seek, skip, subscribe, getTime }
}
