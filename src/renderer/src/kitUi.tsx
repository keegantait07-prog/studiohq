// Kit Maker widgets: coverflow (Skiper 54 Carousel_006 pattern on the library Carousel), kit cover cards
// (Magic UI MagicCard spotlight + a spring tilt in the Skiper 61 style) and the sample drop zone.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { ChevronLeft, ChevronRight, Plus, Upload } from 'lucide-react'
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/lib/carousel'
import { MagicCard } from '@/components/lib/magic-card'
import { artUrl } from './genart'
import { IconBtn, useHoverCapable } from './makeUi'

export interface CoverKit { id: string; name: string; count: number; updated: number }
const SPRING = { mass: 0.1, damping: 10, stiffness: 131 } // Skiper 61 spring

function Cover({ kit, active }: { kit: CoverKit; active: boolean }) {
  const still = useReducedMotion()
  const hoverOK = useHoverCapable()
  const rx = useSpring(useMotionValue(0), SPRING)
  const ry = useSpring(useMotionValue(0), SPRING)
  const tilt = active && !still && hoverOK
  return (
    <motion.div
      className="mk-art"
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 600 }}
      onPointerMove={(e) => {
        if (!tilt) return
        const b = e.currentTarget.getBoundingClientRect()
        ry.set(((e.clientX - b.left) / b.width - 0.5) * 16)
        rx.set(-((e.clientY - b.top) / b.height - 0.5) * 16)
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0) }}
    >
      <MagicCard className="mk-art-card" gradientSize={110}>
        <img src={artUrl({ seed: `kit-${kit.id}`, peaks: [], key: null, bpm: null })} alt="" draggable={false} />
      </MagicCard>
    </motion.div>
  )
}

export function KitCoverflow({ kits, activeId, onSwitch, onNew }: { kits: CoverKit[]; activeId: string; onSwitch: (id: string) => void; onNew: () => void }) {
  const [api, setApi] = useState<CarouselApi>()
  const still = useReducedMotion()
  const idx = Math.max(0, kits.findIndex((k) => k.id === activeId))
  const act = kits[idx]
  useEffect(() => {
    if (!api) return
    const on = () => { const i = api.selectedScrollSnap(); if (i < kits.length && kits[i].id !== activeId) onSwitch(kits[i].id) }
    api.on('select', on)
    return () => { api.off('select', on) }
  }, [api, kits, activeId, onSwitch])
  useEffect(() => { api?.reInit() }, [api, kits.length])
  useEffect(() => { if (api && api.selectedScrollSnap() !== idx) api.scrollTo(idx, !!still) }, [api, idx, kits.length, still])
  const ago = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago` }
  return (
    <div className="mk-cflow" aria-label="Saved kits">
      <Carousel setApi={setApi} opts={{ align: 'center', containScroll: false, loop: false, duration: still ? 0 : 25 }}>
        <CarouselContent className="mk-cf-track">
          {kits.map((k, i) => (
            <CarouselItem key={k.id} className="mk-cv" onClick={() => api?.scrollTo(i)}>
              <motion.div initial={false} animate={{ clipPath: i === idx ? 'inset(0% 0 0% 0 round 14px)' : 'inset(10% 0 10% 0 round 14px)', opacity: Math.abs(i - idx) > 3 ? 0 : 1 - Math.abs(i - idx) * 0.18 }} transition={{ duration: still ? 0 : 0.4 }}>
                <button type="button" className="mk-cv-btn" aria-label={`Open kit ${k.name}`} aria-current={i === idx}><Cover kit={k} active={i === idx} /></button>
              </motion.div>
            </CarouselItem>
          ))}
          <CarouselItem className="mk-cv new">
            <button type="button" className="mk-cv-btn" onClick={onNew} aria-label="New kit"><span className="mk-art newkit"><Plus /></span></button>
          </CarouselItem>
        </CarouselContent>
      </Carousel>
      <div className="mk-cf-cap" aria-live="polite">{act && <><small>Saved {ago(act.updated)}</small><b>{act.name}</b><small>{act.count} sounds</small></>}</div>
      <div className="mk-cf-nav"><span className="mk-dim">{idx + 1} of {kits.length}</span>
        <IconBtn label="Previous kit" onClick={() => api?.scrollPrev()} disabled={idx <= 0}><ChevronLeft /></IconBtn>
        <IconBtn label="Next kit" onClick={() => api?.scrollNext()} disabled={idx >= kits.length - 1}><ChevronRight /></IconBtn>
      </div>
    </div>
  )
}

/** Drag-in zone (21st file-upload pattern, no library part). Also a real file picker so it works from the keyboard. */
export function DropZone({ title, hint, onFiles }: { title: string; hint: ReactNode; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={`mk-drop${over ? ' over' : ''}`} role="button" tabIndex={0} aria-label={title}
      onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f) }}>
      <Upload aria-hidden="true" />
      <b>{title}</b>
      <small>{hint}</small>
      <input ref={input} type="file" accept=".wav,audio/wav" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f) }} />
    </div>
  )
}
