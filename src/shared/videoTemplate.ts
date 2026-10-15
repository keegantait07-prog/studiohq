// One HTML template drives both the live preview (iframe) and the final still (hidden window -> PNG).
// ffmpeg then lays the animated visualizer over the still, inside LAYOUT[format].wave.
import type { VideoFormat, VideoLook, VizStyle } from './types'

export interface Box { x: number; y: number; w: number; h: number }
export const LAYOUT: Record<VideoFormat, { W: number; H: number; wave: Box }> = {
  vertical: { W: 1080, H: 1920, wave: { x: 90, y: 1360, w: 900, h: 260 } },
  horizontal: { W: 1920, H: 1080, wave: { x: 120, y: 790, w: 1680, h: 170 } }
}

interface Spec { cover?: Box & { r: number }; text: Box & { align: 'center' | 'left'; end?: boolean; title: number; tag: number }; footer: Box & { align: 'center' | 'left' } }
const SPECS: Record<VideoFormat, Record<VideoLook, Spec>> = {
  vertical: {
    classic: { cover: { x: 150, y: 240, w: 780, h: 780, r: 36 }, text: { x: 90, y: 1060, w: 900, h: 270, align: 'center', title: 104, tag: 42 }, footer: { x: 90, y: 1740, w: 900, h: 60, align: 'center' } },
    minimal: { cover: { x: 90, y: 170, w: 260, h: 260, r: 28 }, text: { x: 90, y: 480, w: 900, h: 820, align: 'left', end: true, title: 150, tag: 48 }, footer: { x: 90, y: 1740, w: 900, h: 60, align: 'left' } },
    poster: { text: { x: 90, y: 860, w: 900, h: 460, align: 'left', end: true, title: 132, tag: 46 }, footer: { x: 90, y: 1740, w: 900, h: 60, align: 'left' } }
  },
  horizontal: {
    classic: { cover: { x: 140, y: 110, w: 600, h: 600, r: 32 }, text: { x: 800, y: 110, w: 1000, h: 600, align: 'left', title: 120, tag: 46 }, footer: { x: 120, y: 1000, w: 1680, h: 50, align: 'left' } },
    minimal: { cover: { x: 120, y: 90, w: 200, h: 200, r: 24 }, text: { x: 120, y: 320, w: 1680, h: 430, align: 'left', end: true, title: 170, tag: 52 }, footer: { x: 120, y: 1000, w: 1680, h: 50, align: 'left' } },
    poster: { text: { x: 120, y: 400, w: 1500, h: 350, align: 'left', end: true, title: 150, tag: 50 }, footer: { x: 120, y: 1000, w: 1680, h: 50, align: 'left' } }
  }
}

export interface VideoHtmlOpts {
  format: VideoFormat
  look: VideoLook
  viz: VizStyle
  accent: string
  title: string
  tagline: string
  footer: string
  cover: string | null
  peaks: number[]
  /** true: draw a stand-in visualizer (live preview). false: leave the wave box empty for ffmpeg. */
  preview: boolean
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const safeColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#ff6b3d')
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const px = (b: Box) => `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`

/** Stand-in visualizer for the live preview, positioned absolutely inside the W x H frame. */
export function previewWaveSvg(o: Pick<VideoHtmlOpts, 'format' | 'viz' | 'accent' | 'peaks'>): string {
  return previewWave({ ...o, accent: safeColor(o.accent) } as VideoHtmlOpts, LAYOUT[o.format].wave)
}

function previewWave(o: VideoHtmlOpts, b: Box): string {
  const n = o.format === 'vertical' ? 48 : 80
  const pk = o.peaks.length ? o.peaks : new Array(200).fill(80)
  const val = (i: number) => (pk[Math.floor((i / n) * pk.length)] ?? 60) / 255
  const A = o.accent, mid = b.h / 2
  const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  const svg = (inner: string) => `<svg width="${b.w}" height="${b.h}" style="position:absolute;${px(b)}">${inner}</svg>`
  if (o.viz === 'ribbon') {
    const pts = Array.from({ length: 121 }, (_, i) => [(i / 120) * b.w, Math.max(4, Math.pow(val(Math.floor((i / 120) * n)), 1.2) * mid)] as const)
    const top = pts.map(([x, h]) => `${x},${mid - h}`).join(' '), bot = [...pts].reverse().map(([x, h]) => `${x},${mid + h}`).join(' ')
    return svg(`<defs><linearGradient id="rb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${A}" stop-opacity=".8"/><stop offset=".5" stop-color="${A}" stop-opacity=".12"/><stop offset="1" stop-color="${A}" stop-opacity=".8"/></linearGradient></defs><polygon points="${top} ${bot}" fill="url(#rb)"/><polyline points="${top}" fill="none" stroke="${A}" stroke-width="4"/><polyline points="${bot.split(' ').reverse().join(' ')}" fill="none" stroke="${A}" stroke-width="4"/>`)
  }
  if (o.viz === 'led') {
    const cols = Math.round(n / 1.5), pitch = b.w / cols, rows = 14, rh = b.h / rows
    let cells = ''
    for (let c = 0; c < cols; c++) { const lit = Math.max(1, Math.round(val(Math.floor((c / cols) * n)) * rows)); for (let r = 0; r < lit; r++) cells += `<rect x="${c * pitch + pitch * 0.12}" y="${b.h - (r + 1) * rh + 2}" width="${pitch * 0.76}" height="${rh - 4}" fill="${A}" opacity="${0.35 + 0.65 * (r / rows)}"/>` }
    return svg(cells)
  }
  if (o.viz === 'dots') {
    const cols = Math.round(n / 1.2), pitch = b.w / cols, rows = 13, rh = b.h / rows
    let d = ''
    for (let c = 0; c < cols; c++) { const lit = Math.max(1, Math.round(val(Math.floor((c / cols) * n)) * rows)); for (let r = 0; r < lit; r++) d += `<circle cx="${c * pitch + pitch / 2}" cy="${b.h - rh * (r + 0.5)}" r="${Math.min(pitch * 0.34, rh * 0.4) * (r === lit - 1 ? 1.05 : 0.7)}" fill="${A}" opacity="${r === lit - 1 ? 1 : 0.35 + 0.4 * (r / lit)}"/>` }
    return svg(d)
  }
  if (o.viz === 'sonar') {
    const rings = [0.28, 0.55, 0.85].map((t, i) => `<ellipse cx="${b.w / 2}" cy="${mid}" rx="${t * b.w / 2}" ry="${t * mid}" fill="none" stroke="${A}" stroke-width="${6 - i * 1.5}" opacity="${1 - t * 0.9}"/>`).join('')
    return svg(`${rings}<circle cx="${b.w / 2}" cy="${mid}" r="${b.h * 0.12}" fill="${A}" opacity=".8"/>`)
  }
  if (o.viz === 'aurora') {
    const layer = (l: number) => `<polyline points="${Array.from({ length: 160 }, (_, i) => `${(i / 159) * b.w},${mid + Math.sin(i * (0.09 + l * 0.03) + l * 1.7) * b.h * (0.18 + 0.1 * val(l * 9)) * (0.7 + 0.3 * Math.sin(i * 0.03))}`).join(' ')}" fill="none" stroke="${A}" stroke-width="${10 - l * 1.5}" stroke-linecap="round" opacity="${0.9 - l * 0.2}" style="filter:blur(${3 + l}px)"/>`
    return svg([0, 1, 2, 3].map(layer).join(''))
  }
  if (o.viz === 'pulse') {
    let pts = ''
    for (let i = 0; i <= 200; i++) { const x = (i / 200) * b.w, ph = ((i % 50) - 25) / 25; const spike = Math.abs(ph) < 0.18 ? Math.sin((ph / 0.18) * Math.PI) * -1 * b.h * 0.42 * (1 - Math.abs(ph) / 0.18) * 1.4 : Math.abs(ph - 0.55) < 0.16 ? Math.sin(((ph - 0.55) / 0.16 + 1) * Math.PI / 2) * b.h * 0.07 : 0; pts += `${x},${mid + spike} ` }
    return svg(`<polyline points="${pts}" fill="none" stroke="${A}" stroke-width="5" stroke-linejoin="round"/><circle cx="${b.w - 4}" cy="${mid}" r="9" fill="${A}"/>`)
  }
  if (o.viz === 'sparks') {
    let d = ''
    for (let i = 0; i < 70; i++) { const x = rnd(i) * b.w, y = b.h - 12 - Math.pow(rnd(i + 99), 1.6) * b.h * 0.85; d += `<circle cx="${x}" cy="${y}" r="${2.5 + rnd(i + 5) * 4.5}" fill="${A}" opacity="${0.35 + 0.65 * rnd(i + 7)}"/>` }
    for (let c = 0; c < n; c++) d += `<rect x="${c * (b.w / n) + 3}" y="${b.h - Math.max(3, val(c) * b.h * 0.16)}" width="${b.w / n - 6}" height="${Math.max(3, val(c) * b.h * 0.16)}" fill="${A}" opacity=".5"/>`
    return svg(d)
  }
  if (o.viz === 'line') {
    const pts = Array.from({ length: 200 }, (_, i) => `${(i / 199) * b.w},${b.h / 2 + Math.sin(i * 0.7) * val(Math.floor((i / 200) * n)) * (b.h / 2.4)}`).join(' ')
    return `<svg width="${b.w}" height="${b.h}" style="position:absolute;${px(b)}"><polyline points="${pts}" fill="none" stroke="${o.accent}" stroke-width="5" stroke-linejoin="round"/></svg>`
  }
  const pitch = b.w / n, bw = pitch * 0.62
  const bars = Array.from({ length: n }, (_, i) => {
    const h = Math.max(10, val(i) * (o.viz === 'mirror' ? b.h : b.h * 0.95))
    const y = o.viz === 'mirror' ? (b.h - h) / 2 : b.h - h
    return `<rect class="vbar" style="animation-delay:-${(i * 83) % 900}ms;transform-origin:${i * pitch + bw / 2}px ${o.viz === 'mirror' ? b.h / 2 : b.h}px" x="${i * pitch + (pitch - bw) / 2}" y="${y}" width="${bw}" height="${h}" rx="${bw / 2}" fill="${o.accent}"/>`
  }).join('')
  return `<svg width="${b.w}" height="${b.h}" style="position:absolute;${px(b)}">${bars}</svg>`
}

export function videoHtml(o: VideoHtmlOpts): string {
  const { W, H, wave } = LAYOUT[o.format]
  const spec = SPECS[o.format][o.look]
  const accent = safeColor(o.accent)
  const cover = o.cover && o.cover.startsWith('data:image/') ? o.cover : null
  const hue = hash(o.title) % 360
  const art = cover ? `url("${cover}") center/cover` : `linear-gradient(135deg, hsl(${hue} 55% 32%), hsl(${(hue + 50) % 360} 60% 12%))`
  const initials = esc(o.title.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase())
  const t = spec.text
  const bg =
    o.look === 'poster'
      ? `<div class="abs" style="inset:0;background:${art}"></div><div class="abs" style="inset:0;background:linear-gradient(180deg,rgba(8,9,12,.15) 0%,rgba(8,9,12,.55) 45%,rgba(8,9,12,.94) 100%)"></div>`
      : o.look === 'minimal'
        ? `<div class="abs" style="inset:0;background:radial-gradient(120% 70% at 80% 0%, ${accent}33, transparent 60%),#0d0e11"></div>`
        : `<div class="abs" style="inset:-12%;background:${art};filter:blur(70px) brightness(.5) saturate(1.3)"></div><div class="abs" style="inset:0;background:rgba(8,9,12,.35)"></div>`
  const coverEl = spec.cover
    ? `<div class="abs" style="${px(spec.cover)};border-radius:${spec.cover.r}px;background:${art};box-shadow:0 30px 80px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;overflow:hidden">${cover ? '' : `<span style="font-size:${spec.cover.w * 0.32}px;font-weight:800;color:rgba(255,255,255,.22)">${initials}</span>`}</div>`
    : ''
  const scrim = `<div class="abs" style="left:${wave.x - 50}px;top:${wave.y - 40}px;width:${wave.w + 100}px;height:${wave.h + 80}px;border-radius:48px;background:rgba(6,7,9,${o.look === 'minimal' ? 0.25 : 0.42})"></div>`
  const justify = t.end ? 'flex-end' : 'center'
  const align = t.align === 'center' ? 'center' : 'flex-start'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:${W}px;height:${H}px;overflow:hidden;background:#0d0e11}
.frame{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Arial,sans-serif;color:#fff}
.abs{position:absolute}.text{position:absolute;${px(t)};display:flex;flex-direction:column;justify-content:${justify};align-items:${align};text-align:${t.align};gap:18px;overflow:hidden}
.title{font-weight:800;letter-spacing:-.02em;line-height:1.02;font-size:${t.title}px;text-shadow:0 4px 30px rgba(0,0,0,.4);max-width:100%;overflow-wrap:anywhere}
.tag{font-size:${t.tag}px;font-weight:500;color:rgba(255,255,255,.72);line-height:1.2;max-width:100%}
.foot{position:absolute;${px(spec.footer)};display:flex;align-items:center;justify-content:${spec.footer.align === 'center' ? 'center' : 'flex-start'};font-size:${o.format === 'vertical' ? 36 : 34}px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${accent}}
@keyframes pump{0%,100%{transform:scaleY(.55)}50%{transform:scaleY(1)}}.vbar{animation:pump .9s ease-in-out infinite}
</style></head><body><div class="frame">
${bg}${coverEl}${scrim}
<div class="text"><div class="title" id="t">${esc(o.title)}</div>${o.tagline ? `<div class="tag">${esc(o.tagline)}</div>` : ''}</div>
${o.footer ? `<div class="foot">${esc(o.footer)}</div>` : ''}
${o.preview ? previewWave(o, wave) : ''}
</div>
<script>
(function(){var box=document.querySelector('.text'),t=document.getElementById('t'),s=${t.title};
while((box.scrollHeight>box.clientHeight+1||t.scrollWidth>box.clientWidth+1)&&s>34){s-=4;t.style.fontSize=s+'px'}})();
</script></body></html>`
}
