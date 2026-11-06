const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return [f(0), f(8), f(4)]
}

/**
 * The Chrome theme's neon follows the playing beat's key, so the glow changes from track to track.
 * Saturation and lightness are fixed so every key stays vivid and readable on matte black; only the hue moves.
 * Other themes simply never read these variables.
 */
export function setNeon(hue: number | null): void {
  const h = hue ?? 190
  const [r, g, b] = hslToRgb(h, 1, 0.62)
  const s = document.documentElement.style
  s.setProperty('--neon', `hsl(${h} 100% 62%)`)
  s.setProperty('--neon-hi', `hsl(${h} 100% 74%)`)
  s.setProperty('--neon-rgb', `${r}, ${g}, ${b}`)
}
