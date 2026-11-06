import type { ReactNode } from 'react'

// One drawing per icon. Each theme restyles them (stroke weight, caps, fill, a hand-drawn filter, the cap they sit in) through the --ico-* tokens in styles.css.
const G: Record<string, ReactNode> = {
  stage: <><circle className="f" cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.2" /><path d="M12 3.5v3M5 17.5l2-2M19 17.5l-2-2" /></>,
  dashboard: <><rect className="f" x="3.5" y="3.5" width="7" height="7" /><rect className="f" x="13.5" y="3.5" width="7" height="4.5" /><rect className="f" x="13.5" y="11" width="7" height="9.5" /><rect className="f" x="3.5" y="13.5" width="7" height="7" /></>,
  vault: <><path className="f" d="M3.5 8.5h17v11h-17z" /><path d="M8.5 8.5v-4h7v4M3.5 13h17" /></>,
  loops: <><path className="f" d="M3.5 9.5h17v6h-17z" /><path d="M7 9.5c0-3 10-3 10 0M7 15.5c0 3 10 3 10 0" /></>,
  map: <><circle className="f" cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" /></>,
  crm: <><rect className="f" x="3.5" y="5.5" width="17" height="13" /><path d="M3.5 7l8.5 6.5L20.5 7" /></>,
  sales: <><circle className="f" cx="12" cy="12" r="8.5" /><path d="M12 7v10M9.5 9.8c0-1.2 1.1-1.8 2.5-1.8s2.5.6 2.5 1.8-1.1 1.5-2.5 1.9-2.5.7-2.5 1.9 1.1 1.8 2.5 1.8 2.5-.6 2.5-1.8" /></>,
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

/** Every theme has its own mark; CSS shows the one that matches. */
export function BrandMark() {
  return (
    <span className="bm" aria-hidden>
      <svg className="bm-thorn" viewBox="0 0 22 22"><path d="M11 1l1.600 7.400L20 6l-5.200 5.400L21 15l-8-.8L11 21l-2-6.800L1 15l6.200-3.600L2 6l7.400 2.400z" className="th" /></svg>
      <svg className="bm-yatai" viewBox="0 0 22 22"><path d="M3 11h16a8 8 0 0 1-16 0z" className="bowl" /><path d="M8 5.500c-1.500-1.200 1.500-2.400 0-3.600M12 5.500c-1.500-1.200 1.500-2.400 0-3.600M16 5.500c-1.500-1.200 1.500-2.400 0-3.600" className="st" /></svg>
      <svg className="bm-koi" viewBox="0 0 22 22"><path d="M11 3c2.2 3.2 2.2 7.2 0 11.5-2.2-4.300-2.200-8.300 0-11.500z" className="pt" /><path d="M10.500 14.500C6.500 14 3.500 11 2.500 7.500c3.200.1 6.200 2.200 8 7z" className="pt" /><path d="M11.500 14.500c4-.5 7-3.500 8-7-3.200.1-6.200 2.200-8 7z" className="pt" /><path d="M3 18.500c2.500-1.500 5-1.500 8 0s5.500 1.500 8 0" className="wv" /></svg>
      <svg className="bm-citypop" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.500" className="sun" /><path d="M2 13.500h18M3 16.500h16M5 19.500h12" className="cut" /></svg>
      <svg className="bm-magma" viewBox="0 0 22 22"><path d="M11 2C6.600 2 4 5 4 9c0 2.400 1 4 2.500 5v3.500c0 .6.4 1 1 1H9V16h1v2.500h2V16h1v2.500h1.500c.6 0 1-.4 1-1V14C17 13 18 11.400 18 9c0-4-2.600-7-7-7z" className="sk" /><circle cx="8.200" cy="9.300" r="2" className="eye" /><circle cx="13.800" cy="9.300" r="2" className="eye" /><path d="M11 11.500l-1 2h2z" className="eye" /></svg>
      <svg className="bm-chrome" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.2" className="ring" /><path d="M4.4 15.6A8.2 8.2 0 1 1 17.6 15.6" className="arc" /><path d="M11 11L11 5.4" className="nt" /></svg>
      <svg className="bm-console" viewBox="0 0 22 22"><rect x="3" y="1" width="2" height="20" className="rail" /><rect x="10" y="1" width="2" height="20" className="rail" /><rect x="17" y="1" width="2" height="20" className="rail" /><rect x="0.5" y="13" width="7" height="4" className="cap c1" /><rect x="7.5" y="3" width="7" height="4" className="cap c2" /><rect x="14.5" y="10" width="7" height="4" className="cap c3" /></svg>
      <svg className="bm-signal" viewBox="0 0 22 20"><rect x="0" y="11" width="3.4" height="9" /><rect x="6" y="0" width="3.4" height="20" /><rect x="12" y="6" width="3.4" height="14" /><rect x="18" y="13" width="3.4" height="7" /></svg>
      <svg className="bm-faceplate" viewBox="0 0 22 22"><rect x="9.5" y="1" width="3" height="20" rx="1.5" className="slot" /><rect x="4" y="12" width="14" height="6" rx="1" className="cap" /><path d="M11 13.5v3" className="mark" /></svg>
      <svg className="bm-tape" viewBox="0 0 34 20">
        <path d="M10 18.5h14" className="strip" />
        <g className="reel r1"><circle cx="9" cy="9" r="7.5" className="ring" /><circle cx="9" cy="9" r="1.7" className="hub" /><path d="M9 2v4M9 12v4M2 9h4M12 9h4" className="spk" /></g>
        <g className="reel r2"><circle cx="25" cy="9" r="7.5" className="ring" /><circle cx="25" cy="9" r="1.7" className="hub" /><path d="M25 2v4M25 12v4M18 9h4M28 9h4" className="spk" /></g>
      </svg>
      <svg className="bm-brass" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13" className="o" /><circle cx="14" cy="14" r="10.4" className="i" /><text x="14" y="19" textAnchor="middle" className="t">S</text></svg>
      <svg className="bm-ballpoint" viewBox="0 0 120 10" preserveAspectRatio="none"><path d="M2 7c18-5 38-5 58-3s38 2 58-2" className="scribble" /></svg>
      <svg className="bm-concrete" viewBox="0 0 22 22"><rect width="22" height="22" className="blk" /><path d="M5 17V9M11 17V5M17 17v-6" className="cut" /></svg>
      <svg className="bm-dusk" viewBox="0 0 22 20"><path d="M2 12a9 9 0 0 1 18 0z" className="sun" /><path d="M0 15.2h22M3 18h16" className="bar" /></svg>
      <svg className="bm-sonar" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9.5" className="ring o" /><circle cx="11" cy="11" r="5.2" className="ring" /><path d="M11 11L18 5" className="sweep" /><circle cx="14.6" cy="14.4" r="1.3" className="dot" /></svg>
      <svg className="bm-amp" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.6" className="knob" /><path d="M11 11V4.6" className="tick" /></svg>
      <svg className="bm-sandstone" viewBox="0 0 22 20"><rect x="0" y="1" width="16" height="4.6" rx="2.3" className="layer" /><rect x="4" y="7.7" width="18" height="4.6" rx="2.3" className="layer b" /><rect x="1" y="14.4" width="14" height="4.6" rx="2.3" className="layer c" /></svg>
      <svg className="bm-chalk" viewBox="0 0 22 20"><path d="M3 10v0M7.5 5v10M12 2v16M16.5 6v8M20 10v0" className="stroke" /></svg>
    </span>
  )
}
