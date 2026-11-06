import { memo, useMemo, useState } from 'react'
import { LANES, LANE_LABEL, type BeatCard, type Lane, type SinceSummary, type Track } from '@shared/tracks'
import { displayKey } from '@shared/key'
import { clickable } from './a11y'
import { Thumb } from './Waveform'
import { keyColor } from './keyColor'
import { fmtBpm } from './format'
import { money } from './salesUtils'

const TRACKS = [['finish', 'Finish', 'F'], ['pitch', 'Pitch', 'P'], ['post', 'Post', 'V'], ['sell', 'Sell', '$']] as const
const LANE_HINT: Record<Lane, string> = { inbox: 'Finish and tag', ready: 'Done, not out yet', out: 'Pitched or posted', earning: 'Has made money' }

/** The four tracks as stamps. Each has a letter as well as a colour, so the state never rests on colour alone. */
export function TrackStamps({ tracks }: { tracks: BeatCard['tracks'] }) {
  return (
    <div className="stamps">
      {TRACKS.map(([k, name, glyph]) => { const t: Track = tracks[k]; return <span key={k} className={`stamp s-${t.state}`} title={`${name}: ${t.label}`} aria-label={`${name}: ${t.label}`}>{glyph}</span> })}
    </div>
  )
}

/** The four tracks written out, at the top of the Beat Sheet. */
export function TrackStrip({ card }: { card: BeatCard }) {
  return (
    <div className="trackstrip">
      {TRACKS.map(([k, name, glyph]) => { const t: Track = card.tracks[k]; return (
        <div key={k} className="tk"><span className={`stamp s-${t.state}`} aria-hidden>{glyph}</span><div><b>{name}</b><span>{t.label}</span></div></div>
      ) })}
    </div>
  )
}

const Card = memo(function Card({ c, selected, playing, onOpen, onPlay, onAction }: { c: BeatCard; selected: boolean; playing: boolean; onOpen: (id: number) => void; onPlay: (id: number) => void; onAction: (c: BeatCard) => void }) {
  const b = c.beat
  const canPlay = b.ext !== 'flp' || b.hasPreview
  return (
    <article className={`lcard ${selected ? 'sel' : ''} ${c.urgent ? 'urgent' : ''} ${playing ? 'playing' : ''}`} {...clickable(() => onOpen(b.id))}>
      <div className="lc-top">
        <button className="lc-play" disabled={!canPlay} aria-label={`Play ${b.title}`} onClick={(e) => { e.stopPropagation(); onPlay(b.id) }}>{playing ? '❚❚' : '▶'}</button>
        <div className="lc-title">
          <b>{b.title}</b>
          <span className="lc-meta">
            {b.bpm != null && <span>{fmtBpm(b.bpm)}</span>}
            {b.key && <span style={{ color: keyColor(b.key) }}>{displayKey(b.key)}{b.keyConfidence === 'low' ? '?' : ''}</span>}
            {c.versions > 1 && <span>{c.versions} versions</span>}
          </span>
        </div>
      </div>
      {b.thumb.length > 0 && <Thumb data={b.thumb} />}
      <div className="lc-foot">
        <TrackStamps tracks={c.tracks} />
        {c.next.kind === 'none'
          ? <span className="lc-done">{c.next.label}</span>
          : <button className={c.urgent ? 'primary' : ''} onClick={(e) => { e.stopPropagation(); onAction(c) }}>{c.next.label}</button>}
      </div>
    </article>
  )
})

interface Props {
  cards: BeatCard[]
  since: SinceSummary | null
  selectedId: number | null
  playingId: number | null
  loaded: boolean
  onOpen: (id: number) => void
  onPlay: (id: number) => void
  onAction: (c: BeatCard) => void
  onDismissSince: () => void
  onSettings: () => void
  onSearch: () => void
}

export function Line({ cards, since, selectedId, playingId, loaded, onOpen, onPlay, onAction, onDismissSince, onSettings, onSearch }: Props) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? cards.filter((c) => [c.beat.title, ...c.beat.tags.vibe, ...c.beat.tags.genre, ...c.beat.tags.artist].some((x) => x.toLowerCase().includes(t))) : cards
  }, [cards, q])
  const lanes = useMemo(() => {
    const m: Record<Lane, BeatCard[]> = { inbox: [], ready: [], out: [], earning: [] }
    for (const c of shown) m[c.lane].push(c)
    return m
  }, [shown])

  const news = since ? [
    since.bounces && `${since.bounces} new bounce${since.bounces === 1 ? '' : 's'}`,
    since.replies && `${since.replies} repl${since.replies === 1 ? 'y' : 'ies'}`,
    since.sales && `${since.sales} sale${since.sales === 1 ? '' : 's'} · ${money(since.earned)}`,
    since.comments && `${since.comments} new comment${since.comments === 1 ? '' : 's'}`,
    since.due && `${since.due} follow-up${since.due === 1 ? '' : 's'} due`,
    since.overdue && `${since.overdue} post${since.overdue === 1 ? '' : 's'} overdue`
  ].filter(Boolean) as string[] : []

  if (loaded && !cards.length) return (
    <main className="main line wide">
      <div className="line-empty">
        <h2>Your line is empty</h2>
        <p className="dim">Point Studio HQ at your beat and FL project folders, and everything you've made lands here.</p>
        <button className="primary" onClick={onSettings}>Choose your folders</button>
      </div>
    </main>
  )

  return (
    <main className={`main line ${selectedId == null ? 'wide' : ''}`}>
      <header className="line-head">
        <h2>The Line</h2>
        <div className="since">
          {news.length ? <><b>Since you left</b>{news.map((n) => <span key={n}>{n}</span>)}<button className="ghost" aria-label="Clear" onClick={onDismissSince}>×</button></> : <span className="dim">All caught up</span>}
        </div>
        <input className="line-q" value={q} placeholder="Filter by title or tag" aria-label="Filter the line" onChange={(e) => setQ(e.target.value)} />
        <button className="ghost" onClick={onSearch}>Search everything <kbd>⌘K</kbd></button>
      </header>
      <div className="lanes">
        {LANES.map((l) => (
          <section key={l} className={`lane lane-${l}`} aria-label={LANE_LABEL[l]}>
            <header><h3>{LANE_LABEL[l]}</h3><span className="lane-n">{lanes[l].length}</span><span className="lane-hint">{LANE_HINT[l]}</span></header>
            <div className="lane-cards">
              {lanes[l].map((c) => <Card key={c.groupId} c={c} selected={selectedId === c.beat.id} playing={playingId === c.beat.id} onOpen={onOpen} onPlay={onPlay} onAction={onAction} />)}
              {!lanes[l].length && <p className="lane-none">{q ? 'No match' : 'Nothing here'}</p>}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
