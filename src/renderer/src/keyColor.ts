import { camelot } from '@shared/key'

/** Every key gets a hue by its place on the Camelot wheel, so neighbouring keys look related and clashing keys look different. */
export function keyHue(key: string | null): number | null {
  const c = camelot(key)
  if (!c) return null
  return ((parseInt(c, 10) - 1) * 30 + 18) % 360
}

export function keyColor(key: string | null, lightness = 64): string {
  const h = keyHue(key)
  if (h == null) return 'var(--dim)'
  return `hsl(${h} 82% ${key!.endsWith('minor') ? lightness - 6 : lightness}%)`
}
