export interface Theme { id: string; name: string; dark: boolean; font: string; story: string; traits: string }

export const THEMES: Theme[] = [
  { id: 'defied', name: 'Defied', dark: true, font: 'Unbounded', story: 'Pure black with silver chrome headings, wide uppercase type and white pill controls. Hairlines, no boxes.', traits: 'Unbounded and Inter · chrome titles and logo · pill buttons · hairline rows · stats ticker' },
  { id: 'pearl', name: 'Pearl', dark: true, font: 'SF Pro', story: 'Matte soft-touch graphite with a few polished chromatic-pearl controls that catch the light.', traits: 'SF Pro · pearl chrome play, active states and logo · raised and recessed panels · film grain' },
  { id: 'signal', name: 'Signal', dark: true, font: 'SF Pro', story: 'The original night console. Ink black with a lime level-meter glow.', traits: 'SF Pro · glowing line icons · scanlines · meters that pump' },
  { id: 'faceplate', name: 'Faceplate', dark: true, font: 'Gill Sans', story: 'A console channel strip: blue-grey steel, one red cap, squared-off controls.', traits: 'Barlow Semi Condensed · keycap icons · brushed steel and screws · stepped power-on' },
  { id: 'tape', name: 'Tape', dark: true, font: 'Avenir Next', story: 'A multitrack deck. Olive-grey metal with a warm amber lamp.', traits: 'IBM Plex Mono · reel logo that spins while you play · oxide grain · sprocket edge' },
  { id: 'brass', name: 'Brass', dark: true, font: 'Optima', story: 'Racing-green panelling and brass fittings, like a room with a good reputation.', traits: 'Cinzel and Source Serif · engraved medallion icons · tufted leather · gleam on hover' },
  { id: 'ballpoint', name: 'Ballpoint', dark: false, font: 'Helvetica Neue', story: 'A tracking sheet on cool paper. Blue ink, with grease-pencil red for what needs attention.', traits: 'Caveat and IBM Plex Sans · hand-drawn icons · ruled paper · underlines that draw' },
  { id: 'concrete', name: 'Concrete', dark: false, font: 'DIN Alternate', story: 'A poured slab with hard corners and safety orange. Made for daylight.', traits: 'Barlow Condensed · heavy square icons · speckled slab · hazard stripe that marches' }
]

const KEY = 'shq.theme'
export const DEFAULT_THEME = 'defied'

export function getTheme(): string {
  try {
    // Defied is the new look: switch everyone to it once, after that their choice in Themes sticks.
    if (!localStorage.getItem('shq.defied-intro')) { localStorage.setItem('shq.defied-intro', '1'); localStorage.setItem(KEY, 'defied'); return 'defied' }
    const t = localStorage.getItem(KEY); if (t && THEMES.some((x) => x.id === t)) return t
  } catch { /* storage blocked */ }
  return DEFAULT_THEME
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  try { localStorage.setItem(KEY, id) } catch { /* storage blocked */ }
  window.dispatchEvent(new Event('shq-theme')) // canvas waveforms read their colours from CSS, so they redraw on this
}
