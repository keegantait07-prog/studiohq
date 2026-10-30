import { camelot } from '@shared/key'
import { THEMES } from './themes'

// pastel key colours vanish on a light theme, so they sit darker there
const onLight = () => THEMES.find((t) => t.id === document.documentElement.dataset.theme)?.dark === false

/** Every key gets a hue by its place on the Camelot wheel, so neighbouring keys look related and clashing keys look different. */
export function keyHue(key: string | null): number | null {
  const c = camelot(key)
  if (!c) return null
  return ((parseInt(c, 10) - 1) * 30 + 18) % 360
}

export function keyColor(key: string | null, lightness = 64): string {
  const h = keyHue(key)
  if (h == null) return 'var(--dim)'
  const l = (key!.endsWith('minor') ? lightness - 6 : lightness) - (onLight() ? 24 : 0)
  return `hsl(${h} ${onLight() ? 78 : 82}% ${l}%)`
}
