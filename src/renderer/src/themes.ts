export interface Theme { id: string; name: string; dark: boolean; font: string; story: string; traits: string }

export const THEMES: Theme[] = [
  { id: 'signal', name: 'Signal', dark: true, font: 'SF Pro', story: 'The original night console. Ink black with a lime level-meter glow.', traits: 'SF Pro · glowing line icons · scanlines · meters that pump' },
  { id: 'faceplate', name: 'Faceplate', dark: true, font: 'Gill Sans', story: 'A console channel strip: blue-grey steel, one red cap, squared-off controls.', traits: 'Barlow Semi Condensed · keycap icons · brushed steel and screws · stepped power-on' },
  { id: 'tape', name: 'Tape', dark: true, font: 'Avenir Next', story: 'A multitrack deck. Olive-grey metal with a warm amber lamp.', traits: 'IBM Plex Mono · reel logo that spins while you play · oxide grain · sprocket edge' },
  { id: 'brass', name: 'Brass', dark: true, font: 'Optima', story: 'Racing-green panelling and brass fittings, like a room with a good reputation.', traits: 'Cinzel and Source Serif · engraved medallion icons · tufted leather · gleam on hover' },
  { id: 'ballpoint', name: 'Ballpoint', dark: false, font: 'Helvetica Neue', story: 'A tracking sheet on cool paper. Blue ink, with grease-pencil red for what needs attention.', traits: 'Caveat and IBM Plex Sans · hand-drawn icons · ruled paper · underlines that draw' },
  { id: 'concrete', name: 'Concrete', dark: false, font: 'DIN Alternate', story: 'A poured slab with hard corners and safety orange. Made for daylight.', traits: 'Barlow Condensed · heavy square icons · speckled slab · hazard stripe that marches' }
]

const KEY = 'shq.theme'
export const DEFAULT_THEME = 'signal'

export function getTheme(): string {
  try { const t = localStorage.getItem(KEY); if (t && THEMES.some((x) => x.id === t)) return t } catch { /* storage blocked */ }
  return DEFAULT_THEME
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  try { localStorage.setItem(KEY, id) } catch { /* storage blocked */ }
  window.dispatchEvent(new Event('shq-theme')) // canvas waveforms read their colours from CSS, so they redraw on this
}
