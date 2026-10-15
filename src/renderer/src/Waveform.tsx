import { useEffect, useRef } from 'react'

interface Props { peaks: number[]; progress: number; onSeek?: (frac: number) => void; height?: number }

export function Waveform({ peaks, progress, onSeek, height = 56 }: Props) {
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
        g.fillStyle = i / n <= progress ? played : base
        g.fillRect(i * (bar + gap), (h - bh) / 2, bar, bh)
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [peaks, progress, height])

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

export function Thumb({ data }: { data: number[] }) {
  if (!data.length) return <div className="thumb empty" />
  return (
    <svg className="thumb" viewBox={`0 0 ${data.length * 3} 20`} preserveAspectRatio="none">
      {data.map((v, i) => {
        const h = Math.max(1.5, (v / 255) * 18)
        return <rect key={i} x={i * 3} y={(20 - h) / 2} width={2} height={h} rx={1} />
      })}
    </svg>
  )
}
