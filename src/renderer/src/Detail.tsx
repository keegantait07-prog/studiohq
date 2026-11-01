import { useEffect, useState } from 'react'
import { STATUSES, TAG_KINDS, type Beat, type BeatDetail, type Pitch, type Post, type ProjectSection, type Sale, type SplitGroup, type Status, type TagKind, type VaultKind } from '@shared/types'
import { displayKey, camelot } from '@shared/key'
import { artUrl, artPng } from './genart'
import { keyColor } from './keyColor'
import { fmtBpm, fmtDur } from './format'
import { errMsg, fmtDay, money } from './salesUtils'
import { SiteCard } from './SiteCard'

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
}

export function Detail({ beat, kind, allTags, onSelect, onPlay, refresh, pitchedTo, onPitch, onOpenContact, sales, splitGroup, onLogSale, onEditSplits, onSheet, onError, posts, onContent, onFeedback, compatible, projectSection, onProjectSounds }: Props) {
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

  return (
    <aside className="detail">
      <div className="arthero">
        <img src={artUrl({ seed: `g${beat.groupId}`, peaks: beat.thumb, key: beat.key, bpm: beat.bpm })} alt="" />
        <div className="arthero-side">
          <button onClick={async () => { try { const ok = await window.api.saveCover(beat.id, await artPng({ seed: `g${beat.groupId}`, peaks: beat.thumb, key: beat.key, bpm: beat.bpm })); if (ok) refresh() } catch (e) { onError(errMsg(e)) } }}>Use as cover art</button>
          <span className="help">{beat.coverPath ? 'A cover is set for videos.' : 'Drawn from this beat: key colour, tempo and waveform.'}</span>
        </div>
      </div>
      <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== beat.title && save({ title })} />
      <div className="filename" title={beat.path}>{beat.filename}</div>

      {beat.ext === 'flp' && (
        <div className="notice proj-note">
          <b>FL project, no audio yet.</b> Studio HQ found this project in FL Studio. When you export a bounce into your beat folder it links up automatically
          (or use <i>Link .flp…</i> on the bounce). Until then you can track it, tag it, and open it in FL.
          <div style={{ marginTop: 8 }}><button onClick={() => window.api.openProject(beat.id)}>Open in FL Studio</button></div>
        </div>
      )}
      <div className="status-row">
        {STATUSES.map((s: Status, i) => (
          <button key={s} className={`st st-${s} ${beat.status === s ? 'on' : ''}`} onClick={() => save({ status: s })} title={`Press ${i + 1}`}>{s}</button>
        ))}
      </div>

      <div className="two">
        <div className="field">
          <label>BPM {beat.bpmSource && <span className="src">{beat.bpmSource}{beat.bpmConfidence === 'low' ? ' · low confidence' : ''}</span>}</label>
          <div className="bpm-edit">
            <input value={bpm} onChange={(e) => setBpm(e.target.value)} onBlur={() => { const n = parseFloat(bpm); if (!isNaN(n) && n !== beat.bpm) setBpmNum(n) }} />
            <button onClick={() => beat.bpm && setBpmNum(Math.round(beat.bpm * 2 * 10) / 10)} title="Double">×2</button>
            <button onClick={() => beat.bpm && setBpmNum(Math.round(beat.bpm / 2 * 10) / 10)} title="Halve">÷2</button>
          </div>
        </div>
        <div className="field">
          <label>Key {camelot(beat.key) && <span className="cam" style={{ background: keyColor(beat.key) }} title="Camelot wheel code">{camelot(beat.key)}</span>} {beat.keySource && <span className="src">{beat.keySource}</span>}</label>
          <input value={key} placeholder="e.g. Cm, F#" onChange={(e) => setKey(e.target.value)} onBlur={() => key !== displayKey(beat.key) && save({ key })} />
        </div>
      </div>
      <div className="meta-line">{fmtDur(beat.duration)} · {beat.ext.toUpperCase()} · {(beat.size / 1e6).toFixed(1)} MB{!beat.analyzed && ' · analyzing…'}</div>

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
              <div key={c.id} className="ver compat" onClick={() => onSelect(c.id)} onDoubleClick={() => onPlay(c.id)}>
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
            <div key={v.id} className={`ver ${v.id === beat.id ? 'cur' : ''}`} onClick={() => onSelect(v.id)} onDoubleClick={() => onPlay(v.id)}>
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

      {kind === 'beat' && <SiteCard beat={beat} />}

      {beat.ext !== 'flp' && (<>
      <div className="field">
        <label>{kind === 'loop' ? 'Sent to' : 'Pitched to'} ({pitchedTo.length})</label>
        {pitchedTo.map(({ pitch, contact, response }) => (
          <div key={pitch.id} className="ver" style={{ gridTemplateColumns: '1fr auto auto' }} onClick={() => onOpenContact(pitch.contactId)}>
            <span>{contact}</span><span className="dim">{new Date(pitch.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span className={`pst ps-${pitch.status}`}>{response === 'liked' ? '♥ ' : response === 'passed' ? '✕ ' : ''}{pitch.status}</span>
          </div>
        ))}
        <button className="wide" onClick={onPitch} disabled={beat.status === 'sold'}>{beat.status === 'sold' ? 'Sold. Can’t pitch' : kind === 'loop' ? 'Send this loop…' : 'Pitch this beat…'}</button>
      </div>

      {kind === 'beat' && (<>
      <div className="field">
        <label>Sales ({sales.length})</label>
        {sales.map((x) => (
          <div key={x.id} className="ver" style={{ gridTemplateColumns: '1fr auto auto' }}>
            <span>{x.exclusive ? '🔒 ' : ''}{x.licenseName} · {x.buyer}</span><span className="dim">{fmtDay(x.soldAt)}</span><span className="mono">{money(x.price)}</span>
          </div>
        ))}
        <button className="wide" onClick={onLogSale} disabled={sales.some((x) => x.exclusive)}>{sales.some((x) => x.exclusive) ? '🔒 Sold exclusively' : 'Log a sale…'}</button>
      </div>

      <div className="field">
        <label>Splits {splitGroup?.parties ? `(${splitGroup.parties} people)` : ''}</label>
        {splitGroup?.parties ? (
          <div className="meta-line" style={{ marginTop: 0 }}>
            Publishing {splitGroup.pubTotal}% · Master {splitGroup.masterTotal}%{(Math.abs(splitGroup.pubTotal - 100) > 0.01 || Math.abs(splitGroup.masterTotal - 100) > 0.01) && <span className="warn"> (not 100%)</span>}
            {splitGroup.sheetAt ? ` · sheet ${fmtDay(splitGroup.sheetAt)}` : ''}
          </div>
        ) : <div className="meta-line" style={{ marginTop: 0 }}>No collaborators recorded. You own 100% by default.</div>}
        <div className="actions" style={{ marginTop: 6 }}>
          <button onClick={onEditSplits}>{splitGroup?.parties ? 'Edit splits' : 'Add splits'}</button>
          {splitGroup?.parties ? <button onClick={onSheet} disabled={Math.abs(splitGroup.pubTotal - 100) > 0.01 || Math.abs(splitGroup.masterTotal - 100) > 0.01}>Split sheet PDF</button> : null}
        </div>
      </div>

      <div className="field">
        <label>Content ({posts.filter((x) => x.status === 'posted').length} posted)</label>
        <button className="wide" onClick={onContent}>Make video, titles & tags…</button>
        <button className="wide" style={{ marginTop: 6 }} onClick={onFeedback}>Get timestamped feedback…</button>
      </div>
      </>)}
      </>)}

      <div className="actions">
        <button onClick={() => window.api.reveal(beat.id)}>Reveal in Finder</button>
        {beat.ext !== 'flp' && <button onClick={async () => { await window.api.reanalyze(beat.id) }}>Re-analyze</button>}
      </div>
    </aside>
  )
}
