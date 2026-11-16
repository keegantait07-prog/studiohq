import { AudioLines, Bot, Disc3, FileAudio, Inbox, LayoutGrid, Map as MapIcon, MessageSquareText, Package, Palette, PlayCircle, Plug, Repeat, Search, SlidersHorizontal, Store, Wallet, type LucideIcon } from 'lucide-react'

// One drawing per icon, all from lucide at the same 1.75 stroke (shell.css .ico-l pins the weight so no
// theme token thickens or fills one of them). Unknown names fall back to a neutral grid.
const G: Record<string, LucideIcon> = {
  dashboard: LayoutGrid,
  vault: Disc3,
  loops: Repeat,
  map: MapIcon,
  leads: Search,
  crm: Inbox,
  sales: Wallet,
  store: Store,
  content: PlayCircle,
  sounds: AudioLines,
  kits: Package,
  feedback: MessageSquareText,
  plugins: Plug,
  themes: Palette,
  assistant: Bot,
  settings: SlidersHorizontal,
  file: FileAudio
}

export const ICON_STROKE = 1.75

export function Icon({ name }: { name: string }) {
  const I = G[name] ?? LayoutGrid
  return (
    <span className="ico-wrap" aria-hidden>
      <I className="ico ico-l" strokeWidth={ICON_STROKE} absoluteStrokeWidth={false} />
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
