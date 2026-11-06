import { useEffect, useState } from 'react'

/** The current time, refreshed every `ms`. Pass `active = false` to stop the timer (nothing re-renders while it is off). */
export function useNow(ms = 1000, active = true): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms, active])
  return now
}
