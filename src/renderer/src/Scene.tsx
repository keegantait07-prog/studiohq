import { lazy, Suspense, type ReactNode } from 'react'
import { Home, Music2, ShoppingBag, Send, Wrench, Sparkles, Settings as Cog } from 'lucide-react'
import Dock from './components/Dock'
import { SECTIONS, sectionOf, sectionTarget, type SectionId, type ViewId } from './navModel'

const Aurora = lazy(() => import('./components/Aurora'))
const Galaxy = lazy(() => import('./components/Galaxy'))
const Silk = lazy(() => import('./components/Silk'))
const Threads = lazy(() => import('./components/Threads'))
const DarkVeil = lazy(() => import('./components/DarkVeil'))

const ICONS: Record<SectionId, ReactNode> = {
  home: <Home size={22} />, make: <Music2 size={22} />, sell: <ShoppingBag size={22} />, reach: <Send size={22} />, studio: <Wrench size={22} />
}

/** One live WebGL scene per section, fixed behind everything. */
export function SceneBackground({ view }: { view: ViewId }) {
  const s = sectionOf(view).id
  return (
    <div className="scene-bg" aria-hidden="true" data-scene={s}>
      <Suspense fallback={null}>
        {s === 'home' && <Aurora colorStops={['#5b3df5', '#22d3ee', '#f472b6']} amplitude={1.2} blend={0.7} />}
        {s === 'make' && <Galaxy />}
        {s === 'sell' && <Silk color="#f59e0b" speed={4} />}
        {s === 'reach' && <Threads color={[0.4, 0.9, 0.8]} amplitude={1.2} />}
        {s === 'studio' && <DarkVeil />}
      </Suspense>
    </div>
  )
}

/** Floating bottom dock: five sections, each opening its screens. Replaces the top tab strip. */
export function SceneDock({ view, onGo, last, onAssistant, onSettings }: {
  view: ViewId; onGo: (v: ViewId) => void; last: Partial<Record<SectionId, ViewId>>; onAssistant: () => void; onSettings: () => void
}) {
  const cur = sectionOf(view).id
  const items = [
    ...SECTIONS.map((s) => ({
      icon: ICONS[s.id], label: s.label, active: s.id === cur,
      onClick: () => onGo(sectionTarget(s, last, view)),
      menu: s.tabs.length > 1 ? s.tabs.map((t) => ({ label: t.label, onClick: () => onGo(t.view) })) : undefined
    })),
    { separator: true },
    { icon: <Sparkles size={22} />, label: 'Assistant', onClick: onAssistant },
    { icon: <Cog size={22} />, label: 'Settings', onClick: onSettings }
  ]
  return <Dock items={items as never} position="bottom" baseItemSize={52} magnification={78} showLabels showIndicators />
}
