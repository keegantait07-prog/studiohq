export interface Theme { id: string; name: string; dark: boolean; font: string; story: string; traits: string }

export const THEMES: Theme[] = [
  { id: 'console', name: 'Console', dark: true, font: 'SF Pro', story: 'A working desk. Graphite panels, flat and square, with one amber LED for whatever is live.', traits: 'SF Pro and SF Mono · fader mark · no glow, no gradients · square 3px corners · amber playhead' },
  { id: 'thorn', name: 'Thorn', dark: true, font: 'Barlow Condensed', story: 'Tattoo-flash blackwork on black. The wordmark is a sculpted thorn logo that leans with the music, titles are distressed condensed italic, and one blood-red drop colour does all the talking.', traits: 'Barlow Condensed italic · 3D thorn wordmark · black smoke and grain · red rim light · flat square buttons' },
  { id: 'yatai', name: 'Yatai', dark: true, font: 'Yusei Magic', story: 'A ramen cart at 11 pm in steady rain. Your beats are a hand-brushed menu board on worn cedar, tempo sits in the price column, and every status is a red hanko stamp.', traits: 'Yusei Magic and Kaisei Tokumin · rain-streaked photograph · cedar boards and indigo noren · hanko status stamps · rain and steam' },
  { id: 'koi', name: 'Koi Pond', dark: true, font: 'Yuji Syuku', story: 'A dusk koi pond in a Japanese garden, photographed in the last blue light. Lantern gold on dark glass, a bamboo transport bar, and ripples that answer your clicks and your music.', traits: 'Yuji Syuku and Shippori Mincho · real pond photograph · dark frosted glass · lantern-gold glow · drifting leaves and ripples' },
  { id: 'citypop', name: 'City Pop', dark: true, font: 'Monoton', story: 'A Japanese lakeside street at dusk under cherry blossom, shot on film. Neon, candy-gloss keys and a little VHS grain, in pink and blue.', traits: 'Monoton and Righteous · neon titles · candy keys · VHS grain · falling sakura' },
  { id: 'magma', name: 'Magma', dark: true, font: 'Metal Mania', story: 'A night lava field of black basalt and cracked light with a weathered skull in the ash. Obsidian panels, molten rims, and embers that rise while you work.', traits: 'Metal Mania, Grenze Gotisch and Rubik Burned · obsidian panels · molten rims · skull mark · rising embers' },
  { id: 'chrome', name: 'Chrome', dark: true, font: 'SF Pro', story: 'Matte black and polished chrome. The neon is borrowed from the key of whatever is playing.', traits: 'SF Pro and SF Mono · chrome dials and faders · LED rings · glass over the Stage · neon that follows the key' },
  { id: 'signal', name: 'Signal', dark: true, font: 'SF Pro', story: 'The earlier night console. Ink black with a lime level-meter glow.', traits: 'SF Pro · glowing line icons · scanlines · meters that pump' },
  { id: 'faceplate', name: 'Faceplate', dark: true, font: 'Gill Sans', story: 'A console channel strip: blue-grey steel, one red cap, squared-off controls.', traits: 'Barlow Semi Condensed · keycap icons · brushed steel and screws · stepped power-on' },
  { id: 'tape', name: 'Tape', dark: true, font: 'Avenir Next', story: 'A multitrack deck. Olive-grey metal with a warm amber lamp.', traits: 'IBM Plex Mono · reel logo that spins while you play · oxide grain · sprocket edge' },
  { id: 'brass', name: 'Brass', dark: true, font: 'Optima', story: 'Racing-green panelling and brass fittings, like a room with a good reputation.', traits: 'Cinzel and Source Serif · engraved medallion icons · tufted leather · gleam on hover' },
  { id: 'ballpoint', name: 'Ballpoint', dark: false, font: 'Helvetica Neue', story: 'A tracking sheet on cool paper. Blue ink, with grease-pencil red for what needs attention.', traits: 'Caveat and IBM Plex Sans · hand-drawn icons · ruled paper · underlines that draw' },
  { id: 'concrete', name: 'Concrete', dark: false, font: 'DIN Alternate', story: 'A poured slab with hard corners and safety orange. Made for daylight.', traits: 'Barlow Condensed · heavy square icons · speckled slab · hazard stripe that marches' },
  { id: 'dusk', name: 'Dusk', dark: true, font: 'Avenir Next', story: 'A synth-wave sunset. Violet-black with hot pink and soft, rounded controls.', traits: 'Avenir Next · sunset-stripe mark · neon halo · pill buttons' },
  { id: 'sonar', name: 'Sonar', dark: true, font: 'Futura', story: 'A deep-water instrument panel. Navy-teal with a radar-cyan trace.', traits: 'Futura · radar-sweep mark · small radii · cool glow' },
  { id: 'amp', name: 'Amp', dark: true, font: 'Trebuchet MS', story: 'A tube amp. Warm black tolex, cream lettering and an orange pilot light.', traits: 'Trebuchet MS · control-knob mark · squared corners · warm glow' },
  { id: 'sandstone', name: 'Sandstone', dark: false, font: 'Palatino', story: 'Warm desert paper. Cream and clay with a terracotta accent. Easy on the eyes by day.', traits: 'Palatino · layered-strata mark · soft corners · serif type' },
  { id: 'chalk', name: 'Chalk', dark: false, font: 'SF Pro', story: 'A clean daylight workspace. Cool white, near-black ink and electric violet.', traits: 'SF Pro · waveform mark · pill buttons · airy spacing' }
]

const KEY = 'shq.theme'
export const DEFAULT_THEME = 'yatai'
// Bumped when the default look changes, so everyone lands on the new default once and can then pick any theme they like.
const UI_REV = '3'

export function getTheme(): string {
  try {
    if (localStorage.getItem(KEY + '.rev') !== UI_REV) { localStorage.setItem(KEY + '.rev', UI_REV); localStorage.setItem(KEY, DEFAULT_THEME); return DEFAULT_THEME }
    const t = localStorage.getItem(KEY); if (t && THEMES.some((x) => x.id === t)) return t
  } catch { /* storage blocked */ }
  return DEFAULT_THEME
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  try { localStorage.setItem(KEY, id) } catch { /* storage blocked */ }
  window.dispatchEvent(new Event('shq-theme')) // canvas waveforms read their colours from CSS, so they redraw on this
}
