import { useEffect, useState } from 'react'
import { STATUSES, TAG_KINDS, type Beat, type BeatDetail, type Pitch, type Post, type ProjectSection, type Sale, type SplitGroup, type Status, type TagKind, type VaultKind } from '@shared/types'
import { clickable } from './a11y'
import { displayKey, camelot } from '@shared/key'
import { artPng } from './genart'
import { keyColor } from './keyColor'
import { ago, fmtBpm, fmtDur } from './format'
import { readiness } from './readiness'
import { errMsg, fmtDay, money } from './salesUtils'
import { ReleaseCard } from './ReleaseCard'
import { Waveform } from './Waveform'
import { usePlayerTime, type PlayerClock } from './player'

const KIND_LABEL: Record<TagKind, string> = { vibe: 'Vibe', genre: 'Genre', artist: 'Type beat artist' }
const LOOP_KIND_LABEL: Record<TagKind, string> = { vibe: 'Vibe', genre: 'Genre', artist: 'Sounds like (artist)' }

function TagEditor({ kind, label, values, suggestions, onChange }: { kind: TagKind; label: string; values: string[]; suggestions: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim().toLowerCase()
    if (v && !values.includes(v)) onChange([...values, v])
    setDraft('')
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className="chips">
        {values.map((v) => (
          <span key={v} className={`chip ${kind}`}>
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`remove ${v}`}>×</button>
          </span>
        ))}
        <input
          list={`dl-${kind}`}
          value={draft}
          placeholder="add…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1)) }}
          onBlur={add}
        />
        <datalist id={`dl-${kind}`}>{suggestions.filter((s) => !values.includes(s)).slice(0, 40).map((s) => <option key={s} value={s} />)}</datalist>
      </div>
    </div>
  )
}

type InspPlayer = PlayerClock & { id: number | null; duration: number; seek: (t: number) => void }

/** The inspector waveform. While this beat plays it follows the playhead and seeks on click; otherwise it is static. */
function LiveWave({ peaks, player }: { peaks: number[]; player: InspPlayer }) {
  const time = usePlayerTime(player)
  return <Waveform peaks={peaks} height={96} progress={player.duration ? time / player.duration : 0} onSeek={(f) => player.duration && player.seek(f * player.duration)} />
}

interface Props {
  beat: BeatDetail
  /** which vault this is: loops have no sales, splits or videos */
  kind: VaultKind
  allTags: Record<TagKind, string[]>
  onSelect: (id: number) => void
  onPlay: (id: number) => void
  refresh: () => void
  pitchedTo: { pitch: Pitch; contact: string; response: '' | 'liked' | 'passed' }[]
  onPitch: () => void
  onOpenContact: (id: number) => void
  sales: Sale[]
  splitGroup?: SplitGroup
  onLogSale: () => void
  onEditSplits: () => void
  onSheet: () => void
  onError: (m: string) => void
  posts: Post[]
  onContent: () => void
  onFeedback: () => void
  compatible: Beat[]
  projectSection: ProjectSection | null
  onProjectSounds: (id: number) => void
  player?: InspPlayer
}

export function Detail({ beat, kind, allTags, onSelect, onPlay, refresh, pitchedTo, onPitch, onOpenContact, sales, splitGroup, onLogSale, onEditSplits, onSheet, onError, posts, onContent, onFeedback, compatible, projectSection, onProjectSounds, player }: Props) {
  const [title, setTitle] = useState(beat.title)
  const [bpm, setBpm] = useState(fmtBpm(beat.bpm).replace('–', ''))
  const [key, setKey] = useState(displayKey(beat.key))
  const [notes, setNotes] = useState(beat.notes)
  const [label, setLabel] = useState(beat.versionLabel)
  useEffect(() => {
    setTitle(beat.title); setBpm(fmtBpm(beat.bpm).replace('–', '')); setKey(displayKey(beat.key)); setNotes(beat.notes); setLabel(beat.versionLabel)
  }, [beat.id, beat.title, beat.bpm, beat.key, beat.notes, beat.versionLabel])

  const save = async (patch: Parameters<typeof window.api.updateBeat>[1]) => { try { await window.api.updateBeat(beat.id, patch) } catch (e) { onError(errMsg(e)) } refresh() }
  const setBpmNum = (n: number | null) => save({ bpm: n })
  const projectName = beat.projectPath?.split('/').slice(-2).join(' / ')
  const rd = readiness(beat)
  const stage = beat.status === 'wip' ? 'In progress' : beat.status[0].toUpperCase() + beat.status.slice(1)
  const sentence = `${stage} ${ago(beat.mtime)}. ${pitchedTo.length ? `${kind === 'loop' ? 'Sent' : 'Pitched'} to ${pitchedTo.length}` : kind === 'loop' ? 'Not sent' : 'Not pitched'}${kind === 'loop' ? '.' : `, ${posts.length ? `${posts.length} post${posts.length === 1 ? '' : 's'}` : 'not posted'}.`}`
  const makeCover = async () => { try { const ok = await window.api.saveCover(beat.id, await artPng({ seed: `g${beat.groupId}`, peaks: beat.thumb, key: beat.key, bpm: beat.bpm })); if (ok) refresh() } catch (e) { onError(errMsg(e)) } }

  return (
    <aside className="insp" data-s={beat.status}>
      <div className="i-wave">
        {player && player.id === beat.id ? <LiveWave peaks={beat.peaks} player={player} /> : <Waveform peaks={beat.peaks} height={96} progress={0} />}
      </div>
      <section className="i-head">
        <input className="title-input" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== beat.title && save({ title })} />
        <p className="i-sub">{sentence}</p>
        <div className="filename" title={beat.path}>{beat.filename}</div>
        {beat.ext === 'flp' && (
          <div className="notice proj-note">
            <b>FL project, no audio yet.</b> Studio HQ found this project in FL Studio. When you export a bounce into your beat folder it links up automatically
            (or use <i>Link .flp…</i> on the bounce). Until then you can track it, tag it, and open it in FL.
            <div style={{ marginTop: 8 }}><button onClick={() => window.api.openProject(beat.id)}>Open in FL Studio</button></div>
          </div>
        )}
        <div className="status-row" role="group" aria-label="Stage">
          {STATUSES.map((s: Status, i) => (
            <button key={s} data-s={s} className={`st st-${s} ${beat.status === s ? 'on' : ''}`} aria-pressed={beat.status === s} onClick={() => save({ status: s })} title={`Press ${i + 1}`}>{s === 'wip' ? 'WIP' : s}</button>
          ))}
        </div>
      </section>

      <section className="i-kvs">
        <div className="kv">
          <span>BPM</span>
          <div className="bpm-edit">
            <input aria-label="BPM" value={bpm} onChange={(e) => setBpm(e.target.value)} onBlur={() => { const n = parseFloat(bpm); if (!isNaN(n) && n !== beat.bpm) setBpmNum(n) }} />
            <button onClick={() => beat.bpm && setBpmNum(Math.round(beat.bpm * 2 * 10) / 10)} title="Double">×2</button>
            <button onClick={() => beat.bpm && setBpmNum(Math.round(beat.bpm / 2 * 10) / 10)} title="Halve">÷2</button>
          </div>
          <em>{beat.bpmSource}{beat.bpmConfidence === 'low' ? ' · low confidence' : ''}</em>
        </div>
        <div className="kv">
          <span>Key</span>
          <input aria-label="Key" value={key} placeholder="e.g. Cm, F#" onChange={(e) => setKey(e.target.value)} onBlur={() => key !== displayKey(beat.key) && save({ key })} />
          <em>{camelot(beat.key) && <i className="cam" style={{ background: keyColor(beat.key) }} title="Camelot wheel code">{camelot(beat.key)}</i>} {beat.keySource}{beat.keyConfidence === 'low' ? ' · low confidence' : ''}</em>
        </div>
        <div className="kv"><span>Length</span><b>{fmtDur(beat.duration)}</b><em>{beat.ext.toUpperCase()} · {(beat.size / 1e6).toFixed(1)} MB{!beat.analyzed && ' · analyzing…'}</em></div>
        <div className="kv"><span>Versions</span><b>{beat.versions.length}</b><em>{beat.versionLabel || 'main'}</em></div>
      </section>

      <section className="i-checks">
        <h3>Details <span>{rd.done} of {rd.total} filled in</span></h3>
        {rd.steps.map((s) => (
          <div key={s.id} className={`check ${s.done ? 'ok' : ''}`}>
            <i className="box" aria-hidden="true">{s.done ? '✓' : ''}</i><span>{s.label}</span>
            {s.id === 'cover' ? <button onClick={makeCover} title={s.done ? 'Draw a new cover from this beat' : 'Draw a cover from this beat: key colour, tempo and waveform'}>{s.done ? 'Redraw' : 'Draw one'}</button> : <span />}
          </div>
        ))}
      </section>

      <section className="acts">
        {beat.ext !== 'flp' && <button className="primary" onClick={onPitch} disabled={beat.status === 'sold'}>{beat.status === 'sold' ? 'Sold. Can’t pitch' : kind === 'loop' ? 'Send this loop…' : 'Pitch this beat…'}</button>}
        <button onClick={() => window.api.reveal(beat.id)}>Reveal in Finder</button>
        {beat.ext !== 'flp' && <button onClick={async () => { await window.api.reanalyze(beat.id) }}>Re-analyze</button>}
      </section>

      <section className="i-more">
      {TAG_KINDS.map((k) => (
        <TagEditor key={k} kind={k} label={(kind === 'loop' ? LOOP_KIND_LABEL : KIND_LABEL)[k]} values={beat.tags[k]} suggestions={allTags[k]} onChange={async (v) => { await window.api.setTags(beat.id, { ...beat.tags, [k]: v }); refresh() }} />
      ))}

      {beat.credits && <div className="field"><label>Credits (from filename)</label><div className="credits">{beat.credits}</div></div>}

      <div className="field">
        <label>FL Studio project {beat.projectPath && beat.projectConfidence != null && beat.projectConfidence < 1 && <span className="src">guessed {Math.round(beat.projectConfidence * 100)}%</span>}</label>
        {beat.projectPath ? (
          <div className="project">
            <span title={beat.projectPath}>{projectName}</span>
            <button onClick={() => window.api.openProject(beat.id)}>Open in FL</button>
            <button onClick={() => window.api.linkProject(beat.id)}>Change</button>
            <button onClick={() => save({ projectPath: null })} aria-label="unlink">×</button>
          </div>
        ) : (
          <button className="wide" onClick={() => window.api.linkProject(beat.id)}>Link .flp…</button>
        )}
      </div>

      {projectSection && (projectSection.samples.length > 0 || projectSection.midis.length > 0) && (
        <button className="wide" onClick={() => onProjectSounds(projectSection.id)}>Samples & MIDI from this project ({projectSection.samples.length} + {projectSection.midis.length} MIDI)</button>
      )}

      <div className="field">
        <label>Notes</label>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== beat.notes && save({ notes })} />
      </div>

      {compatible.length > 0 && (
        <div className="field">
          <label>Plays well with ({compatible.length})</label>
          <div className="versions">
            {compatible.map((c) => (
              <div key={c.id} className="ver compat" {...clickable(() => onSelect(c.id))} onDoubleClick={() => onPlay(c.id)}>
                <span className="vl">{camelot(c.key)}</span>
                <span className="vf">{c.title}</span>
                <span className="vd">{fmtBpm(c.bpm)}</span>
              </div>
            ))}
          </div>
          <div className="meta-line">Same or neighbouring key on the Camelot wheel, and a tempo within 6% (or half/double).</div>
        </div>
      )}

      <div className="field">
        <label>Versions ({beat.versions.length})</label>
        <div className="versions">
          {beat.versions.map((v) => (
            <div key={v.id} className={`ver ${v.id === beat.id ? 'cur' : ''}`} {...clickable(() => onSelect(v.id))} onDoubleClick={() => onPlay(v.id)}>
              <span className="vl">{v.versionLabel || 'main'}</span>
              <span className="vf">{v.filename}</span>
              <span className="vd">{fmtDur(v.duration)}</span>
            </div>
          ))}
        </div>
        <div className="ver-label">
          <label>This file’s version label</label>
          <input value={label} placeholder="v1, final, stems…" onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== beat.versionLabel && save({ versionLabel: label })} />
        </div>
      </div>

      {kind === 'beat' && beat.ext !== 'flp' && (
        <ReleaseCard
          beat={beat} pitchedTo={pitchedTo} sales={sales} splitGroup={splitGroup} onSheet={onSheet} onOpenContact={onOpenContact}
          reloadKey={[beat.id, beat.status, sales.length, pitchedTo.map((x) => x.pitch.status).join(','), posts.map((x) => x.status).join(','), splitGroup?.parties, splitGroup?.pubTotal, splitGroup?.masterTotal, splitGroup?.sheetAt].join('|')}
          on={{ content: onContent, pitch: onPitch, feedback: onFeedback, splits: onEditSplits, sale: onLogSale }}
        />
      )}

      {kind === 'loop' && beat.ext !== 'flp' && (<>
      <div className="field">
        <label>{kind === 'loop' ? 'Sent to' : 'Pitched to'} ({pitchedTo.length})</label>
        {pitchedTo.map(({ pitch, contact, response }) => (
          <div key={pitch.id} className="ver" style={{ gridTemplateColumns: '1fr auto auto' }} {...clickable(() => onOpenContact(pitch.contactId))}>
            <span>{contact}</span><span className="dim">{new Date(pitch.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span className={`pst ps-${pitch.status}`}>{response === 'liked' ? '♥ ' : response === 'passed' ? '✕ ' : ''}{pitch.status}</span>
          </div>
        ))}
      </div>
      </>)}

      </section>
    </aside>
  )
}
