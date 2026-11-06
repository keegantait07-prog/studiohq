import { useEffect, useRef } from 'react'

interface Props { peaks: number[]; progress: number; onSeek?: (frac: number) => void; height?: number; region?: { from: number; to: number }; markers?: number[] }

export function Waveform({ peaks, progress, onSeek, height = 56, region, markers }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current!
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth, h = height
      c.width = w * dpr; c.height = h * dpr
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      g.clearRect(0, 0, w, h)
      const css = getComputedStyle(c)
      const base = css.getPropertyValue('--wf').trim() || '#3a3d46'
      const played = css.getPropertyValue('--wf-played').trim() || '#ff6b3d'
      const bar = 3, gap = 1, n = Math.max(1, Math.floor(w / (bar + gap)))
      for (let i = 0; i < n; i++) {
        const p = peaks.length ? peaks[Math.min(peaks.length - 1, Math.floor((i / n) * peaks.length))] / 255 : 0.04
        const bh = Math.max(2, p * (h - 4))
        const f = i / n
        g.fillStyle = region ? (f >= region.from && f <= region.to ? played : base) : f <= progress ? played : base
        g.fillRect(i * (bar + gap), (h - bh) / 2, bar, bh)
      }
      // Console: a soft trail behind the playhead, then the playhead itself. Other themes leave this var empty and draw nothing.
      if (!region && css.getPropertyValue('--wf-playhead').trim() && progress > 0 && progress < 1) {
        const x = Math.round(progress * w)
        const trail = g.createLinearGradient(x - 56, 0, x, 0)
        trail.addColorStop(0, 'rgba(0,0,0,0)'); trail.addColorStop(1, played)
        g.globalAlpha = 0.16; g.fillStyle = trail; g.fillRect(x - 56, 0, 56, h)
        g.globalAlpha = 1; g.fillStyle = played; g.fillRect(x - 1, 0, 2, h)
      }
      for (const m of markers ?? []) { g.fillStyle = css.getPropertyValue('--text').trim() || '#ffffff'; g.fillRect(Math.round(m * w) - 1, 0, 2, h); g.beginPath(); g.arc(m * w, 5, 5, 0, Math.PI * 2); g.fill() }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    window.addEventListener('shq-theme', draw)
    return () => { ro.disconnect(); window.removeEventListener('shq-theme', draw) }
  }, [peaks, progress, height, region?.from, region?.to, markers?.join(',')])

  return (
    <canvas
      ref={ref}
      className="wave"
      style={{ height, cursor: onSeek ? 'pointer' : 'default' }}
      onClick={(e) => {
        if (!onSeek) return
        const r = e.currentTarget.getBoundingClientRect()
        onSeek((e.clientX - r.left) / r.width)
      }}
    />
  )
}

export function Thumb({ data, className = '' }: { data: number[]; className?: string }) {
  if (!data.length) return <div className="thumb empty" />
  return (
    <svg className={`thumb ${className}`} viewBox={`0 0 ${data.length * 3} 20`} preserveAspectRatio="none">
      {data.map((v, i) => {
        const h = Math.max(1.5, (v / 255) * 18)
        return <rect key={i} x={i * 3} y={(20 - h) / 2} width={2} height={h} rx={1} />
      })}
    </svg>
  )
}
