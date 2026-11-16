// v4 Themes: live preview of the chosen world, its palette / type / shape sheet, and the world list.
// Blueprint: docs/design/mockups/v4/screens-studio-system.html (#themes). Library parts:
// BlurFade via Reveal (preview entrance), TextAnimate (story line), Tooltip (quick switch), Button, Skiper 26
// circle wipe (applying a world), Skiper 63 squircle filter (world card shapes).
// The preview and the sheet are plain markup skinned with the previewed theme's own tokens (no library part).
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { useReducedMotion } from 'motion/react'
import { Check, Play } from 'lucide-react'
import { THEMES, type Theme } from './themes'
import { BrandMark } from './Icons'
import { SquiCircleFilterStatic } from '@/components/lib/skiper-ui/skiper63'
import { startCircleWipe } from '@/components/lib/skiper-ui/skiper26-wipe'
import { TextAnimate } from '@/components/lib/text-animate'
import { TooltipProvider } from '@/components/lib/tooltip'
import { Button, Reveal, Tip } from './crmUi'
import './system.css'
import './themes.css'

const BEATS = [
  { t: 'Glass Hours', bpm: 128, k: '8A', st: 'finished' },
  { t: 'Night Drive', bpm: 141, k: '5A', st: 'wip' },
  { t: 'Lowrider', bpm: 100, k: '10B', st: 'sent' }
]
const WAVE = [4, 9, 6, 13, 10, 16, 8, 12, 17, 11, 7, 14, 18, 9, 5, 12, 15, 8, 11, 6, 10, 14, 7, 5, 9, 13, 6, 11, 16, 8, 12, 7]
const SWATCHES = ['--bg', '--panel', '--raise', '--well', '--line-hi', '--text', '--dim', '--accent']
const STATUS = [['--idea', 'Idea'], ['--wip', 'In progress'], ['--finished', 'Finished'], ['--sent', 'Pitched'], ['--sold', 'Sold']]

/** A small working copy of the app, drawn with the previewed theme's tokens. */
function Preview({ theme }: { theme: Theme }) {
  return (
    <div className="th-pv" data-theme={theme.id} aria-hidden="true">
      <div className="th-pv-top">
        <span className="th-pv-brand"><BrandMark /><b>Studio HQ</b></span>
        <span className="th-pv-play"><Play /></span>
        <span className="th-pv-wave">{WAVE.map((h, i) => <i key={i} className={i < 12 ? 'p' : ''} style={{ height: h + 4 }} />)}</span>
        <span className="th-pv-t">1:12</span>
      </div>
      <div className="th-pv-tabs"><span>Today</span><span className="on">Beats</span><span>Loops</span><span>Sounds</span><span>Pitch CRM</span></div>
      <div className="th-pv-body">
        <div className="th-pv-list">
          <div className="th-pv-h"><b>Beats</b><small>79 beats</small></div>
          {BEATS.map((b, i) => (
            <div key={b.t} className={`th-pv-row${i === 0 ? ' sel' : ''}`} style={{ ['--st' as string]: `var(--${b.st})` }}>
              <span className="pl"><Play /></span><span className="tt">{b.t}</span><span className="bp">{b.bpm}</span><span className="ky">{b.k}</span>
            </div>
          ))}
          <div className="th-pv-legend">{STATUS.map(([v, l]) => <span key={v}><i style={{ background: `var(${v})` }} />{l}</span>)}</div>
        </div>
        <div className="th-pv-insp">
          <b>Glass Hours</b>
          <dl><dt>BPM</dt><dd>128</dd><dt>Key</dt><dd>8A</dd></dl>
          <span className="th-pv-chk on">Mixdown exported</span>
          <span className="th-pv-chk on">Tagged</span>
          <span className="th-pv-chk">Cover art</span>
          <span className="th-pv-btn">Pitch this beat</span>
        </div>
      </div>
    </div>
  )
}

/** Reads the previewed theme's font and corner tokens off the scoped preview, so the sheet shows real values. */
function useTokens(id: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [t, setT] = useState({ font: '', display: '', btn: '', field: '', card: '' })
  useEffect(() => {
    const read = () => {
      const el = ref.current?.querySelector<HTMLElement>('[data-theme]')
      if (!el) return
      const cs = getComputedStyle(el)
      const v = (n: string) => cs.getPropertyValue(n).trim()
      const first = (f: string) => f.split(',')[0].replace(/['"]/g, '').replace(/ Variable$/, '').trim()
      setT({ font: first(v('--font')), display: first(v('--font-display')), btn: v('--r-btn'), field: v('--r-field'), card: v('--r-card') })
    }
    read()
    window.addEventListener('shq-theme', read)
    return () => window.removeEventListener('shq-theme', read)
  }, [id])
  return { ref, t }
}

export function ThemesView({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const still = useReducedMotion()
  const [sel, setSel] = useState(current)
  const [note, setNote] = useState('')
  const [err, setErr] = useState(false)
  const theme = THEMES.find((x) => x.id === sel) ?? THEMES.find((x) => x.id === current) ?? THEMES[0]
  const { ref, t } = useTokens(theme?.id ?? '')

  if (!theme) {
    return (
      <section className="th4 sx">
        <div className="sx-empty"><b>No worlds found</b><span>The theme list did not load, so Studio HQ is showing Deck. Nothing is lost.</span><Button variant="outline" size="sm" onClick={() => location.reload()}>Reload themes</Button></div>
      </section>
    )
  }

  const use = (id: string, e?: MouseEvent) => {
    setErr(false)
    const apply = () => flushSync(() => {
      try { onPick(id); setNote(`${THEMES.find((x) => x.id === id)?.name ?? id} is on. Saved on this Mac.`) } catch { setErr(true) }
    })
    if (id === current) return apply()
    startCircleWipe(apply, e?.clientX, e?.clientY)
  }
  const inUse = theme.id === current

  // radio group keys: arrows move the preview, Enter / Space applies it
  const onKey = (e: KeyboardEvent, list: Theme[], i: number) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (step) {
      e.preventDefault()
      const next = list[(i + step + list.length) % list.length]
      setSel(next.id)
      document.getElementById('th-w-' + next.id)?.focus()
    }
  }
  const group = (dark: boolean, title: string) => {
    const list = THEMES.filter((x) => x.dark === dark)
    if (!list.length) return null
    return (
      <div className="th-grp">
        <h3 className="sx-eyebrow">{title}</h3>
        <div role="radiogroup" aria-label={title} className="th-wlist">
          {list.map((w, i) => (
            <div key={w.id} className="th-wcard">
              <i className="th-w-bg" aria-hidden="true" />
              <button
                id={'th-w-' + w.id}
                role="radio"
                aria-checked={w.id === current}
                tabIndex={w.id === sel ? 0 : -1}
                className={`th-w${w.id === sel ? ' sel' : ''}`}
                onClick={() => setSel(w.id)}
                onDoubleClick={(e) => use(w.id, e)}
                onKeyDown={(e) => onKey(e, list, i)}
              >
                <span className="th-w-sw" data-theme={w.id} aria-hidden="true"><i /><i /><i /></span>
                <span className="th-w-txt"><b>{w.name}</b><small>{w.font} · {w.dark ? 'dark' : 'light'}</small></span>
                {w.id === current && <span className="sx-chip ok">In use</span>}
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider delay={120}>
      <section className="th4 sx">
        <SquiCircleFilterStatic />
        <header className="sx-head">
          <div>
            <div className="sx-eyebrow">Look and feel</div>
            <h1 className="sx-h1">Themes</h1>
            <p className="sx-lede">Pick how Studio HQ looks. The change is instant and stays on this Mac.</p>
          </div>
          <span className="sx-chip">{THEMES.length} world{THEMES.length === 1 ? '' : 's'} installed</span>
        </header>
        {err && <div className="sx-notice err" role="alert"><span>Could not apply that theme. Your current one is still on.</span><Button variant="outline" size="sm" onClick={() => use(theme.id)}>Try again</Button></div>}
        <div className="th-grid">
          <div className="th-main" ref={ref}>
            <div className="th-pvwrap">
              <div className="th-pvbar">
                <h2 className="sx-h2">{theme.name}</h2>
                {inUse && <span className="sx-chip ok">In use</span>}
                <span className="sx-sp" />
                {!inUse && <Button onClick={(e) => use(theme.id, e)}><Check aria-hidden="true" />Use this world</Button>}
              </div>
              <Reveal key={theme.id}><Preview theme={theme} /></Reveal>
              <p className="th-story" aria-live="polite">
                {still ? theme.story : <TextAnimate key={theme.id} as="span" by="word" animation="blurInUp" startOnView={false} duration={0.5}>{theme.story}</TextAnimate>}
              </p>
              <div className="th-traits">{theme.traits.split(' · ').map((x) => <span key={x} className="sx-chip">{x}</span>)}</div>
            </div>
            <div className="th-sheet" data-theme={theme.id}>
              <div className="th-sh">
                <h3 className="sx-eyebrow">Palette</h3>
                <div className="th-sw8">{SWATCHES.map((v) => <span key={v} title={v}><i style={{ background: `var(${v})` }} /><small>{v.slice(2)}</small></span>)}</div>
                <div className="th-stat">{STATUS.map(([v, l]) => <span key={v}><i style={{ background: `var(${v})` }} />{l}</span>)}</div>
              </div>
              <div className="th-sh">
                <h3 className="sx-eyebrow">Type</h3>
                <div className="th-spec">Aa</div>
                <p className="sx-dim">{t.display || '…'} headings · {t.font || '…'} text</p>
                <p className="sx-help">Every label, table and button uses this face. Nothing is set in a fixed font.</p>
              </div>
              <div className="th-sh">
                <h3 className="sx-eyebrow">Shape</h3>
                <div className="th-shape"><i className="b" /><i className="f" /><i className="c" /></div>
                <p className="sx-dim">Controls {t.btn || '…'} · fields {t.field || '…'} · cards {t.card || '…'}</p>
              </div>
            </div>
          </div>
          <aside className="th-side" aria-label="Worlds">
            {group(true, 'Dark rooms')}
            {group(false, 'Daylight')}
            <div className="th-qs">
              <Tip label="Quick switch appears when a second world is installed.">
                <span tabIndex={0} className="th-qs-t">
                  <button type="button" role="switch" aria-checked={false} disabled={THEMES.length < 2} className="sx-switch" aria-label="Quick switch between worlds" />
                </span>
              </Tip>
              <span className="sx-help">Quick switch appears when a second world is installed.</span>
            </div>
            <p className="sx-help th-note" aria-live="polite">{note}</p>
          </aside>
        </div>
      </section>
    </TooltipProvider>
  )
}
