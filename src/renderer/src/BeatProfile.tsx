import { useEffect } from 'react'
import { STATUSES, type Beat, type BeatDetail, type Status } from '@shared/types'
import { displayKey } from '@shared/key'
import { fmtBpm, fmtDur } from './format'
import { readiness } from './readiness'
import { Waveform } from './Waveform'
import { usePlayerTime, type PlayerClock } from './player'

/** Monochrome generated cover: no image needed, the beat's own shape (thumb) is the art. */
export function CoverArt({ beat, big }: { beat: Beat; big?: boolean }) {
  const bars = beat.thumb.length ? beat.thumb : Array.from({ length: 28 }, (_, i) => 40 + ((i * 37) % 55))
  const max = Math.max(1, ...bars)
  return (
    <div className={`cover ${big ? 'big' : ''}`} aria-hidden>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {bars.map((v, i) => {
          const h = Math.max(3, (v / max) * 54)
          const w = 100 / bars.length
          return <rect key={i} x={i * w + w * 0.18} y={50 - h / 2} width={w * 0.64} height={h} rx={w * 0.3} />
        })}
      </svg>
      <span className="cv-initial">{beat.title.trim().charAt(0).toUpperCase() || '·'}</span>
    </div>
  )
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`spill st-${status}`}>{status === 'wip' ? 'WIP' : status}</span>
}

/** The full-screen profile for one beat: art and waveform on the left, huge chrome title on the right, the release checklist, prev/next and a counter. Esc closes. */
export function BeatProfile({ beat, detail, order, player, onClose, onGo, onPlay, onStatus, onEdit, onSeek }: {
  beat: Beat; detail: BeatDetail | null; order: Beat[]; player: PlayerClock & { id: number | null; playing: boolean; duration: number }
  onClose: () => void; onGo: (id: number) => void; onPlay: (id: number) => void; onStatus: (s: Status) => void; onEdit: () => void
  onSeek?: (frac: number) => void
}) {
  const time = usePlayerTime(player)
  const mine = player.id === beat.id
  const playing = mine && player.playing
  const progress = mine && player.duration ? time / player.duration : 0
  const idx = Math.max(0, order.findIndex((b) => b.id === beat.id))
  const prev = order[idx - 1], next = order[idx + 1]
  const r = readiness(beat)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose() }
      else if (e.key === 'ArrowRight' && next) { if (e.shiftKey) return; e.preventDefault(); e.stopImmediatePropagation(); onGo(next.id) }
      else if (e.key === 'ArrowLeft' && prev) { if (e.shiftKey) return; e.preventDefault(); e.stopImmediatePropagation(); onGo(prev.id) }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose, onGo, prev, next])
  const tags = [...beat.tags.genre, ...beat.tags.vibe, ...beat.tags.artist]
  return (
    <div className="profile" role="dialog" aria-modal="true" aria-label={beat.title}>
      <button className="pf-close" onClick={onClose} aria-label="Close">Close <kbd>Esc</kbd></button>
      <div className="pf-body" key={beat.id}>
        <div className="pf-art">
          <CoverArt beat={beat} big />
          {detail && detail.id === beat.id && detail.peaks.length > 0 && (
            <div className="pf-wave"><Waveform peaks={detail.peaks} progress={progress} onSeek={onSeek} height={64} /></div>
          )}
        </div>
        <div className="pf-info">
          <div className="ph-eyebrow">{beat.ext === 'flp' ? 'FL Studio project' : beat.ext.toUpperCase()}{beat.versionLabel ? ` · ${beat.versionLabel}` : ''}</div>
          <h2 className="pf-title">{beat.title}</h2>
          <div className="pf-pills">
            <StatusPill status={beat.status} />
            <span className="spill ghost">{fmtBpm(beat.bpm)} BPM</span>
            <span className="spill ghost">{displayKey(beat.key) || 'no key'}</span>
            <span className="spill ghost">{fmtDur(beat.duration)}</span>
          </div>
          {beat.credits && <div className="pf-credits">{beat.credits}</div>}
          {tags.length > 0 && <div className="pf-tags">{tags.slice(0, 8).map((t, i) => <span key={`${t}-${i}`} className="spill mini">{t}</span>)}</div>}

          <div className="pf-h">Release checklist <em>{r.done} / {r.total}</em></div>
          <ul className="pf-check">
            {r.steps.map((s) => <li key={s.id} className={s.done ? 'done' : ''}><i aria-hidden>{s.done ? '✓' : ''}</i>{s.label}</li>)}
          </ul>

          <div className="pf-h">Stage</div>
          <div className="pf-stages">
            {STATUSES.map((s) => <button key={s} className={`fpill ${beat.status === s ? 'on' : ''}`} onClick={() => onStatus(s)}>{s === 'wip' ? 'WIP' : s}</button>)}
          </div>

          <div className="pf-actions">
            <button className="primary" onClick={() => onPlay(beat.id)}>{playing ? 'Pause' : 'Play'}</button>
            <button className="ghost" onClick={onEdit}>Edit details</button>
          </div>
        </div>
      </div>
      <nav className="pf-nav" aria-label="Neighbours">
        <button disabled={!prev} onClick={() => prev && onGo(prev.id)}>← <span>{prev?.title ?? ''}</span></button>
        <span className="pf-count">{idx + 1} / {order.length}</span>
        <button disabled={!next} onClick={() => next && onGo(next.id)}><span>{next?.title ?? ''}</span> →</button>
      </nav>
    </div>
  )
}
