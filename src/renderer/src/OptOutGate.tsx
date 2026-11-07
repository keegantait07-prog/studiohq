import { useEffect, useState, type ReactNode } from 'react'

/** Renders children only once the address is confirmed not opted out. Unknown or failed checks stay closed. */
export function OptOutGate({ email, name, children }: { email: string; name: string; children: ReactNode }) {
  const [optedOut, setOptedOut] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    setOptedOut(undefined)
    if (!email) { setOptedOut(false); return }
    let live = true
    window.api.leadsIsSuppressed(email).then((v) => { if (live) setOptedOut(v) }, () => { if (live) setOptedOut(true) })
    return () => { live = false }
  }, [email])
  if (optedOut === undefined) return <div className="notice">Checking opt-out list…</div>
  if (optedOut) return <div className="notice err">{name} opted out and cannot be pitched.</div>
  return <>{children}</>
}
