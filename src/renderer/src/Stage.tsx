import { useMemo, useState } from 'react'
import type { Beat, BeatDetail } from '@shared/types'
import { usePlayerTime, type Player } from './player'
import { keyHue } from './keyColor'
import { displayKey } from '@shared/key'
import { fmtDur } from './format'
import { Dial, Switch, VFader } from './controls'
import { StageViz } from './StageViz'

interface Props {
  /** Beats that have audio (FL projects without a preview are left out). */
  beats: Beat[]
  player: Player
  detail: BeatDetail | null
  audition: boolean
  onAudition: (on: boolean) => void
  onPlay: (id: number) => void
  onOpenVault: (query: string) => void
}

const BPM_MIN = 60
const BPM_MAX = 200
const CRATE_SHOWN = 14

function StageClock({ player, fallback }: { player: Player; fallback: number | null }) {
  const time = usePlayerTime(player)
  return <span className="mono">{fmtDur(time)} / {fmtDur(player.duration || fallback || null)}</span>
}

/**
 * The Now Playing screen. The visualizer fills the view; glass pods float over it with the controls.
 * Every control does something: the dials set the player's volume and speed, the switches set audition mode, looping and pitch lock,
 * and the two BPM faders pick a crate of beats you can play from right here or open in the Vault.
 */
export function Stage({ beats, player, detail, audition, onAudition, onPlay, onOpenVault }: Props) {
  const [lo, setLo] = useState(BPM_MIN)
  const [hi, setHi] = useState(BPM_MAX)
  const narrowed = lo > BPM_MIN || hi < BPM_MAX

  const crate = useMemo(() => {
    const seen = new Set<number>()
    return beats
      .filter((b) => !narrowed || (b.bpm != null && b.bpm >= lo && b.bpm <= hi))
      .sort((a, b) => b.mtime - a.mtime)
      .filter((b) => (seen.has(b.groupId) ? false : (seen.add(b.groupId), true))) // one entry per beat, not per version
  }, [beats, lo, hi, narrowed])

  const hue = keyHue(detail?.key ?? null)
  const key = displayKey(detail?.key ?? null)

  return (
    <section className="stagev" aria-label="Stage">
      <StageViz peaks={detail?.peaks ?? []} duration={player.duration} playing={player.playing} getTime={player.getTime} hue={hue} />
      <div className="stage-ui">
        <header className="glass stage-top">
          <h2>{detail?.title ?? 'Nothing playing'}</h2>
          <div className="stage-meta">
            {detail ? <><span className="mono">{detail.bpm ?? '–'} bpm</span><span className="mono">{key || 'no key'}</span><StageClock player={player} fallback={detail.duration} /></> : <span className="dim">Pick a beat from the crate below.</span>}
          </div>
        </header>

        <div className="glass pod-left">
          <Dial label="Volume" value={player.volume} min={0} max={1} step={0.01} def={1} format={(v) => `${Math.round(v * 100)}%`} onChange={player.setVolume} />
          <Dial label="Speed" value={player.rate} min={0.5} max={1.5} step={0.01} def={1} format={(v) => `${v.toFixed(2)}×`} onChange={player.setRate} />
        </div>

        <div className="glass pod-right">
          <div className="switches">
            <Switch label="Audition" on={audition} onChange={onAudition} hint="Play beats from their fullest part as you move through them" />
            <Switch label="Loop" on={player.loop} onChange={player.setLoop} hint="Repeat the current beat" />
            <Switch label="Keep pitch" on={player.keepPitch} onChange={player.setKeepPitch} hint="Off, speed changes pitch like a tape machine" />
          </div>
          <div className="faders">
            <VFader label="Low bpm" value={lo} min={BPM_MIN} max={BPM_MAX} step={1} def={BPM_MIN} onChange={(v) => setLo(Math.min(v, hi - 1))} />
            <VFader label="High bpm" value={hi} min={BPM_MIN} max={BPM_MAX} step={1} def={BPM_MAX} onChange={(v) => setHi(Math.max(v, lo + 1))} />
          </div>
        </div>

        <div className="glass pod-bottom">
          <div className="crate-head">
            <b>Crate</b>
            <span className="dim">{crate.length} {crate.length === 1 ? 'beat' : 'beats'}{narrowed ? `, ${lo} to ${hi} bpm` : ''}</span>
            <span className="grow" />
            {narrowed && <button onClick={() => onOpenVault(`${lo}-${hi}`)}>Open in Vault</button>}
          </div>
          {crate.length === 0 ? (
            <p className="dim crate-empty">No beats between {lo} and {hi} bpm. Move the faders apart.</p>
          ) : (
            <div className="crate">
              {crate.slice(0, CRATE_SHOWN).map((b) => (
                <button key={b.id} className={`chipbeat ${player.id === b.id ? 'on' : ''}`} onClick={() => onPlay(b.id)} title={`Play ${b.title}`}>
                  <span className="t">{b.title}</span>
                  <span className="mono dim">{b.bpm ?? '–'}</span>
                </button>
              ))}
              {crate.length > CRATE_SHOWN && <span className="dim crate-more">+{crate.length - CRATE_SHOWN} more</span>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
