// Generative cover art: every beat gets its own piece, drawn from its title, waveform, key and tempo.
// The key sets the colour, the tempo sets the number of orbiting dots, the waveform becomes a ring of rays.
import { keyHue } from './keyColor'

export interface ArtInput { seed: string; peaks: number[]; key: string | null; bpm: number | null }

const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

export function artSvg(a: ArtInput): string {
  const r = rng(hashStr(a.seed))
  const h1 = keyHue(a.key) ?? Math.floor(r() * 360)
  const h2 = (h1 + 36 + (a.bpm ? Math.round((a.bpm - 100) / 3) : 24) + 360) % 360
  const rays = 84, rot = r() * 360
  const pk = a.peaks.length ? a.peaks : null
  const ray = Array.from({ length: rays }, (_, i) => {
    const v = pk ? pk[Math.min(pk.length - 1, Math.floor((i / rays) * pk.length))] / 255 : 0.25 + 0.55 * Math.abs(Math.sin(i * 0.37 + r() * 2)) * r()
    const len = 8 + Math.pow(v, 0.8) * 84
    return { ang: (i / rays) * 360, len, o: 0.45 + 0.55 * v }
  })
  const dots = Math.max(3, Math.min(16, Math.round((a.bpm ?? 120) / 11)))
  const blobs = [0, 1, 2].map((i) => `<circle cx="${60 + r() * 280}" cy="${60 + r() * 280}" r="${90 + r() * 90}" fill="hsl(${i === 1 ? h2 : h1} 80% ${i === 2 ? 45 : 38}%)" opacity="${0.28 + r() * 0.2}"/>`).join('')
  const orbit = Array.from({ length: dots }, () => {
    const ang = r() * Math.PI * 2, rad = 150 + r() * 34
    return `<circle cx="${200 + Math.cos(ang) * rad}" cy="${200 + Math.sin(ang) * rad}" r="${1.4 + r() * 3.2}" fill="#fff" opacity="${0.35 + r() * 0.5}"/>`
  }).join('')
  const rayEls = ray.map((q) => `<line x1="200" y1="${200 - 80}" x2="200" y2="${200 - 80 - q.len}" transform="rotate(${q.ang + rot} 200 200)" stroke="hsl(${h1 + (q.ang / 360) * (h2 - h1)} 90% 68%)" stroke-opacity="${q.o}" stroke-width="3.6" stroke-linecap="round"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
<defs>
<radialGradient id="bg" cx="30%" cy="22%" r="95%"><stop offset="0" stop-color="hsl(${h1} 52% 17%)"/><stop offset="1" stop-color="hsl(${h2} 60% 4%)"/></radialGradient>
<radialGradient id="core" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="hsl(${h1} 95% 78%)"/><stop offset=".55" stop-color="hsl(${h1} 85% 52%)"/><stop offset="1" stop-color="hsl(${h2} 80% 30%)"/></radialGradient>
<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="46"/></filter>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${hashStr(a.seed) % 97}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"/></filter>
</defs>
<rect width="400" height="400" fill="url(#bg)"/>
<g filter="url(#blur)">${blobs}</g>
<g filter="url(#glow)" opacity=".7">${rayEls}</g>
<g>${rayEls}</g>
<circle cx="200" cy="200" r="66" fill="none" stroke="hsl(${h1} 90% 75%)" stroke-opacity=".5" stroke-width="1.5"/>
<circle cx="200" cy="200" r="54" fill="url(#core)"/>
<ellipse cx="184" cy="180" rx="20" ry="11" fill="#fff" opacity=".22" transform="rotate(-28 184 180)"/>
${orbit}
<rect width="400" height="400" filter="url(#grain)" opacity=".07"/>
</svg>`
}

const cache = new Map<string, string>()
/** data: URL for <img>, cached by the inputs so scrolling a long list stays cheap. */
export function artUrl(a: ArtInput): string {
  const k = `${a.seed}|${a.key}|${a.bpm}|${a.peaks.length}|${a.peaks[3] ?? ''}`
  let u = cache.get(k)
  if (!u) { u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(artSvg(a)); cache.set(k, u) }
  return u
}

export function artPng(a: ArtInput, size = 1400): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = size
      c.getContext('2d')!.drawImage(img, 0, 0, size, size)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Could not draw the cover.'))
    img.src = artUrl(a)
  })
}
