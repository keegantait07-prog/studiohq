import { THEMES, type Theme } from './themes'
import { BrandMark, Icon } from './Icons'

const BEATS = [
  { t: 'Glass Hours', ch: 'dark', k: '8A' },
  { t: 'Night Drive', ch: 'drill', k: '5A' },
  { t: 'Lowrider', ch: 'g-funk', k: '10B' }
]
const WAVE = [4, 9, 6, 13, 10, 16, 8, 12, 17, 11, 7, 14, 18, 9, 5, 12, 15, 8, 11, 6, 10, 14, 7, 5]

function Mini({ theme }: { theme: Theme }) {
  return (
    <div className="tmini" data-theme={theme.id} aria-hidden>
      <div className="tm-side">
        <div className="tm-brandrow"><BrandMark /><span>Studio HQ</span></div>
        <span className="tm-nav"><Icon name="dashboard" />Dashboard</span>
        <span className="tm-nav on"><Icon name="vault" />Beat Vault</span>
        <span className="tm-nav"><Icon name="crm" />Pitch CRM</span>
        <span className="tm-nav"><Icon name="sounds" />Sounds</span>
      </div>
      <div className="tm-main">
        <div className="tm-tabs"><b className="on">all</b><b>wip</b><b>finished</b></div>
        {BEATS.map((b, i) => (
          <div key={b.t} className={`tm-row ${i === 1 ? 'sel' : ''}`}>
            <i className="pl" /><span className="tt">{b.t}</span><span className="ch">{b.ch}</span><span className="ky" style={{ color: ['var(--sent)', 'var(--wip)', 'var(--finished)'][i] }}>{b.k}</span>
          </div>
        ))}
        <div className="tm-sw">{['--panel', '--sel', '--dim', '--text', '--ember', '--accent'].map((v) => <i key={v} style={{ background: `var(${v})` }} />)}</div>
      </div>
      <div className="tm-player">
        <i className="bp" />
        <div className="tm-wave">{WAVE.map((h, i) => <i key={i} className={i < 9 ? 'p' : ''} style={{ height: h }} />)}</div>
      </div>
    </div>
  )
}

export function ThemesView({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const group = (dark: boolean, title: string) => (
    <>
      <h3 className="tgroup">{title}</h3>
      <div className="tgrid" role="radiogroup" aria-label={title}>
        {THEMES.filter((t) => t.dark === dark).map((t) => (
          <button key={t.id} role="radio" aria-checked={t.id === current} className={`tcard ${t.id === current ? 'on' : ''}`} onClick={() => onPick(t.id)}>
            <Mini theme={t} />
            <div className="tcard-meta">
              <h4>{t.name}{t.id === current && <em>In use</em>}</h4>
              <p>{t.story}</p>
              <small>{t.traits}</small>
            </div>
          </button>
        ))}
      </div>
    </>
  )
  return (
    <div className="themesv">
      <header>
        <h2>Themes</h2>
        <p className="help">Pick how Studio HQ looks. The change is instant and stays on this Mac.</p>
      </header>
      {group(true, 'Dark rooms')}
      {group(false, 'Daylight')}
    </div>
  )
}
