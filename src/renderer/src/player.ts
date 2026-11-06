import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

export interface PlayerState { id: number | null; playing: boolean; duration: number }

/** What the Stage dials and switches control. Saved between sessions. */
export interface PlayerPrefs { volume: number; rate: number; keepPitch: boolean; loop: boolean }
const PREF_KEY = 'shq.player'
const DEFAULT_PREFS: PlayerPrefs = { volume: 1, rate: 1, keepPitch: true, loop: false }
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
function loadPrefs(): PlayerPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<PlayerPrefs>
    return {
      volume: clamp(Number(raw.volume ?? 1), 0, 1),
      rate: clamp(Number(raw.rate ?? 1), 0.5, 1.5),
      keepPitch: raw.keepPitch ?? true,
      loop: raw.loop ?? false
    }
  } catch { return DEFAULT_PREFS }
}
function applyPrefs(a: HTMLAudioElement, p: PlayerPrefs): void {
  a.volume = p.volume
  a.defaultPlaybackRate = p.rate // loading a new source resets playbackRate to the default, so set both
  a.playbackRate = p.rate
  a.preservesPitch = p.keepPitch
  a.loop = p.loop
}

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
  const [prefs, setPrefs] = useState<PlayerPrefs>(loadPrefs)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const listeners = useRef(new Set<() => void>())
  const subscribe = useCallback((l: () => void) => { listeners.current.add(l); return () => { listeners.current.delete(l) } }, [])
  const getTime = useCallback(() => timeRef.current, [])
  const setTime = useCallback((t: number) => { if (timeRef.current === t) return; timeRef.current = t; listeners.current.forEach((l) => l()) }, [])

  useEffect(() => {
    const a = new Audio()
    a.preload = 'auto'
    applyPrefs(a, prefsRef.current)
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

  useEffect(() => {
    if (el.current) applyPrefs(el.current, prefs)
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch { /* storage blocked */ }
  }, [prefs])
  const setVolume = useCallback((volume: number) => setPrefs((p) => ({ ...p, volume: clamp(volume, 0, 1) })), [])
  const setRate = useCallback((rate: number) => setPrefs((p) => ({ ...p, rate: clamp(rate, 0.5, 1.5) })), [])
  const setKeepPitch = useCallback((keepPitch: boolean) => setPrefs((p) => ({ ...p, keepPitch })), [])
  const setLoop = useCallback((loop: boolean) => setPrefs((p) => ({ ...p, loop })), [])

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

  return { ...state, ...prefs, setVolume, setRate, setKeepPitch, setLoop, play, toggle, seek, skip, subscribe, getTime }
}

/** What usePlayer() returns. */
export type Player = ReturnType<typeof usePlayer>
