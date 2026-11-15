export interface Theme { id: string; name: string; dark: boolean; font: string; story: string; traits: string }

export const THEMES: Theme[] = [
  { id: 'deck', name: 'Deck', dark: true, font: 'Inter Tight', story: 'Warm near-black with a signal-orange accent, wide Archivo headings and a faint dot grain.', traits: 'Inter Tight and Archivo · uppercase wide titles · 8px controls, 10px cards · status colours per release stage' }
]

const KEY = 'shq.theme'
export const DEFAULT_THEME = 'deck'

export function getTheme(): string {
  try {
    // an id saved by a removed theme (defied, pearl, ...) falls back to the default
    const t = localStorage.getItem(KEY); if (t && THEMES.some((x) => x.id === t)) return t
  } catch { /* storage blocked */ }
  return DEFAULT_THEME
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  try { localStorage.setItem(KEY, id) } catch { /* storage blocked */ }
  window.dispatchEvent(new Event('shq-theme')) // canvas waveforms read their colours from CSS, so they redraw on this
}
