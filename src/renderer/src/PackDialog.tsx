import { useEffect, useMemo, useState } from 'react'
import type { Beat, BeatDetail, ContentData, ContentPackRequest, Platform, VizStyle } from '@shared/types'
import { bestSection, nextFreeDate, platformLabel } from './suggest'
import { keyColor } from './keyColor'

// The looks that are a real place or object. The dashboard-style ones stay in the video builder for anyone who wants them.
const LOOKS: { id: VizStyle; label: string }[] = [
  { id: 'vinyl', label: 'Vinyl' }, { id: 'tape', label: 'Tape' }, { id: 'riso', label: 'Riso print' }, { id: 'ridge', label: 'Ridge' }, { id: 'phosphor', label: 'Phosphor' },
  { id: 'score', label: 'Score' }, { id: 'ink', label: 'Ink' }, { id: 'typewriter', label: 'Typewriter' }, { id: 'bauhaus', label: 'Bauhaus' }
]
const SOCIAL: Platform[] = ['shorts', 'tiktok', 'instagram']

/** Any CSS colour as #rrggbb, which is what the video scenes read. */
function toHex(color: string): string {
  const c = document.createElement('canvas').getContext('2d')!
  c.fillStyle = '#ff6b3d'
  c.fillStyle = color
  return /^#/.test(String(c.fillStyle)) ? String(c.fillStyle) : '#ff6b3d'
}

interface Props { beat: Beat; content: ContentData; onClose: () => void; onStart: (r: ContentPackRequest) => void; onCustom: () => void }

export function PackDialog({ beat, content, onClose, onStart, onCustom }: Props) {
  const [detail, setDetail] = useState<BeatDetail | null>(null)
  // a different look per beat, so a run of posts doesn't look like a template
  const [look, setLook] = useState<VizStyle>(LOOKS[beat.groupId % LOOKS.length].id)
  const [vertical, setVertical] = useState(true)
  const [full, setFull] = useState(true)
  const [draft, setDraft] = useState(true)
  const [plan, setPlan] = useState<Platform[]>(SOCIAL)
  const [artists, setArtists] = useState(beat.tags.artist.join(', '))
  const [suggested, setSuggested] = useState<string[]>([])

  useEffect(() => {
    window.api.getBeat(beat.id).then(setDetail)
    if (!beat.tags.artist.length) window.api.ytSuggestArtists(beat.id).then(setSuggested).catch(() => {})
  }, [beat.id, beat.tags.artist.length])

  const clipLength = 30
  const clipStart = useMemo(() => (detail?.duration ? bestSection(detail.peaks, detail.duration, clipLength, detail.bpm) : 0), [detail])
  const names = artists.split(',').map((a) => a.trim()).filter(Boolean)
  const nothing = !vertical && !full

  const start = () => onStart({
    beatId: beat.id, look, accent: toHex(keyColor(beat.key)), clipStart, clipLength, vertical, full, draft: draft && full, artists: names,
    plan: vertical ? plan.map((p) => ({ platform: p, date: nextFreeDate(content, p) })) : []
  })

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal pack" onMouseDown={(e) => e.stopPropagation()}>
        <header><h2>Content Pack</h2><button onClick={onClose}>Cancel</button></header>
        <p className="dim">{beat.title}. Everything runs in the background, and nothing goes public: the YouTube draft waits for your review.</p>
        <div className="field"><label>Look</label><select value={look} onChange={(e) => setLook(e.target.value as VizStyle)}>{LOOKS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>
        <label className="check"><input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} /> 30-second vertical clip from the fullest part</label>
        {vertical && (
          <div className="pack-plan">
            <span className="dim">Plan it on</span>
            {SOCIAL.map((p) => <label key={p} className="check small"><input type="checkbox" checked={plan.includes(p)} onChange={(e) => setPlan(e.target.checked ? [...plan, p] : plan.filter((x) => x !== p))} /> {platformLabel(p)}</label>)}
          </div>
        )}
        <label className="check"><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Full-length horizontal video</label>
        <label className="check"><input type="checkbox" checked={draft && full} disabled={!full} onChange={(e) => setDraft(e.target.checked)} /> YouTube draft: title, description, tags and thumbnail</label>
        {draft && full && (
          <div className="field">
            <label>Type-beat artists</label>
            <input value={artists} placeholder="e.g. future, gunna" onChange={(e) => setArtists(e.target.value)} />
            {!names.length && !suggested.length && <p className="help warn">Add at least one, or the pack skips the YouTube draft.</p>}
            {!names.length && suggested.length > 0 && <p className="help">Sounds like: {suggested.map((a) => <button key={a} className="ghost" onClick={() => setArtists(a)}>+ {a}</button>)}</p>}
          </div>
        )}
        <div className="draft-actions">
          <button className="primary" disabled={nothing || !detail} onClick={start}>Make the pack</button>
          <button onClick={onCustom}>Build it by hand instead</button>
        </div>
      </div>
    </div>
  )
}
