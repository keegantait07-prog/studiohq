import type { ReactNode } from 'react'

// One drawing per icon. Each theme restyles them (stroke weight, caps, fill, a hand-drawn filter, the cap they sit in) through the --ico-* tokens in styles.css.
const G: Record<string, ReactNode> = {
  dashboard: <><rect className="f" x="3.5" y="3.5" width="7" height="7" /><rect className="f" x="13.5" y="3.5" width="7" height="4.5" /><rect className="f" x="13.5" y="11" width="7" height="9.5" /><rect className="f" x="3.5" y="13.5" width="7" height="7" /></>,
  vault: <><path className="f" d="M3.5 8.5h17v11h-17z" /><path d="M8.5 8.5v-4h7v4M3.5 13h17" /></>,
  loops: <><path className="f" d="M3.5 9.5h17v6h-17z" /><path d="M7 9.5c0-3 10-3 10 0M7 15.5c0 3 10 3 10 0" /></>,
  map: <><circle className="f" cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" /></>,
  leads: <><circle className="f" cx="10.5" cy="10.5" r="6.5" /><path d="M15.2 15.2l5.3 5.3M10.5 7.5v6M7.5 10.5h6" /></>,
  crm: <><rect className="f" x="3.5" y="5.5" width="17" height="13" /><path d="M3.5 7l8.5 6.5L20.5 7" /></>,
  sales: <><circle className="f" cx="12" cy="12" r="8.5" /><path d="M12 7v10M9.5 9.8c0-1.2 1.1-1.8 2.5-1.8s2.5.6 2.5 1.8-1.1 1.5-2.5 1.9-2.5.7-2.5 1.9 1.1 1.8 2.5 1.8 2.5-.6 2.5-1.8" /></>,
  store: <><path d="M4 9l1.6-4.5h12.8L20 9" /><path d="M4 9c0 1.4 1.1 2.5 2.5 2.5S9 10.4 9 9c0 1.4 1.1 2.5 2.5 2.5S14 10.4 14 9c0 1.4 1.1 2.5 2.5 2.5S20 10.4 20 9" /><path d="M5.5 11.8V19h13v-7.2M9.5 19v-4.5h5V19" /></>,
  content: <><rect className="f" x="3.5" y="5" width="17" height="14" /><path d="M10 9.2v5.6l4.8-2.8z" /></>,
  sounds: <><circle className="f" cx="12" cy="12" r="8.5" /><path d="M12 12l3.6-3.6M5.5 17.5l1 -1M18.5 17.5l-1-1M12 3.5v1.6" /></>,
  kits: <><rect className="f" x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect className="f" x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect className="f" x="3.5" y="13.5" width="7" height="7" rx="1.5" /><path d="M17 13.5v7M13.5 17h7" /></>,
  feedback: <path className="f" d="M4 5h16v11H10.5L6 20v-4H4z" />,
  plugins: <><path d="M9 3.5v5M15 3.5v5" /><path className="f" d="M5.5 8.5h13v3.5a6.5 6.5 0 0 1-13 0z" /><path d="M12 18.5v2" /></>,
  themes: <><circle cx="12" cy="12" r="8.5" /><path className="f" d="M12 3.5a8.5 8.5 0 0 1 0 17z" style={{ fillOpacity: 1 }} /></>,
  assistant: <><path className="f" d="M4 4.5h16v11H11l-4.5 4v-4H4z" /><path d="M9 10h6" /></>,
  settings: <><path d="M4 8h16M4 16h16" /><circle className="f" cx="9" cy="8" r="2.3" /><circle className="f" cx="15.5" cy="16" r="2.3" /></>
}

export function Icon({ name }: { name: string }) {
  return (
    <span className="ico-wrap" aria-hidden>
      <svg className="ico" viewBox="0 0 24 24">{G[name]}</svg>
    </span>
  )
}

/** Hand-drawn wobble used by the Ballpoint theme. Rendered once. */
export function Defs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <filter id="shq-rough" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" />
      </filter>
    </svg>
  )
}

/** The Studio HQ mark. Themes can swap it by styling .bm; Deck draws a wide S in the display face. */
export function BrandMark() {
  return (
    <span className="bm" aria-hidden>
      <span className="bm-deck">S</span>
    </span>
  )
}
