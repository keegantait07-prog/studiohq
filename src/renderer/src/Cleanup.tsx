import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CleanupItem } from '@shared/types'
import { displayKey } from '@shared/key'
import { artUrl } from './genart'
import { keyColor } from './keyColor'
import { ago, fmtBpm } from './format'

const DAY = 86400000
const mb = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB')
const protectedStatus = (it: CleanupItem) => it.status === 'finished' || it.status === 'sent' || it.status === 'sold'

type Filter = 'all' | 'never' | 'exported' | 'old' | 'marked'
type Sort = 'oldest' | 'newest' | 'largest' | 'name'
const FILTERS: { id: Filter; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every project in your FL folders' },
  { id: 'never', label: 'Never exported', hint: 'No bounce found for these' },
  { id: 'exported', label: 'Exported', hint: 'A bounce exists, so the project is safe to let go' },
  { id: 'old', label: 'Older than 90 days', hint: 'Not opened in a quarter' },
  { id: 'marked', label: 'Marked', hint: 'What will go to the Trash' }
]

export function Cleanup({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<CleanupItem[] | null>(null)
  const [marks, setMarks] = useState<Set<number>>(new Set())
  const [sel, setSel] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('never')
  const [sort, setSort] = useState<Sort>('oldest')
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [withBackups, setWithBackups] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [playing, setPlaying] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  const load = useCallback(async () => { setItems(await window.api.cleanupList()) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const a = new Audio(); audio.current = a; a.onended = () => setPlaying(null); return () => { a.pause() } }, [])

  const shown = useMemo(() => {
    if (!items) return []
    const now = Date.now(), s = q.trim().toLowerCase()
    const f = items.filter((it) => {
      if (s && !`${it.name} ${it.title ?? ''}`.toLowerCase().includes(s)) return false
      if (filter === 'never') return it.bounces === 0
      if (filter === 'exported') return it.bounces > 0
      if (filter === 'old') return now - it.mtime > 90 * DAY
      if (filter === 'marked') return marks.has(it.id)
      return true
    })
    const by: Record<Sort, (a: CleanupItem, b: CleanupItem) => number> = {
      oldest: (a, b) => a.mtime - b.mtime, newest: (a, b) => b.mtime - a.mtime, largest: (a, b) => b.size - a.size, name: (a, b) => a.name.localeCompare(b.name)
    }
    return [...f].sort(by[sort])
  }, [items, filter, sort, q, marks])

  const cur = items?.find((i) => i.id === sel) ?? null
  const markedItems = useMemo(() => (items ?? []).filter((i) => marks.has(i.id)), [items, marks])
  const markedBytes = markedItems.reduce((a, i) => a + i.size + (withBackups ? i.backupBytes : 0), 0)
  const markedBackups = markedItems.reduce((a, i) => a + i.backups, 0)

  const stop = () => { audio.current?.pause(); setPlaying(null) }
  useEffect(stop, [sel]) // eslint-disable-line react-hooks/exhaustive-deps
  const togglePlay = () => {
    const a = audio.current
    if (!a || !cur?.playId) return
    if (playing === cur.id) return stop()
    a.src = `shqa://beat/${cur.playId}`
    a.play().then(() => setPlaying(cur.id)).catch(() => setMsg('Could not play that one.'))
  }
  const toggleMark = (id: number) => setMarks((m) => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n })
  const step = useCallback((d: number) => {
    if (!shown.length) return
    const i = shown.findIndex((x) => x.id === sel)
    const n = shown[Math.max(0, Math.min(shown.length - 1, (i < 0 ? (d > 0 ? -1 : shown.length) : i) + d))]
    setSel(n.id)
    document.querySelector(`[data-cid="${n.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [shown, sel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'
      if (e.key === 'Escape') { e.stopPropagation(); return confirm ? setConfirm(false) : typing ? (t as HTMLInputElement).blur() : onClose() }
      if (typing || confirm || busy) return
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); step(1) }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); step(-1) }
      else if ((e.key === 'x' || e.key === 'Delete' || e.key === 'Backspace') && cur) { e.preventDefault(); toggleMark(cur.id); step(1) }
      else if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if (e.key === 'o' && cur) window.api.projectOpen(cur.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const selectShown = () => setMarks((m) => { const n = new Set(m); for (const it of shown) if (!protectedStatus(it)) n.add(it.id); return n })
  const skipped = shown.filter(protectedStatus).length

  const doTrash = async () => {
    setBusy(true)
    try {
      const r = await window.api.cleanupTrash([...marks], withBackups)
      setMsg(`Moved ${r.trashed} project${r.trashed === 1 ? '' : 's'}${r.backups ? ` and ${r.backups} autosave backup${r.backups === 1 ? '' : 's'}` : ''} to the Trash (${mb(r.bytes)}). Restore from the Trash in Finder if you change your mind.${r.failed.length ? ` ${r.failed.length} could not be moved: ${r.failed[0]}` : ''}`)
      setMarks(new Set()); setSel(null); setConfirm(false)
      await load(); onChanged()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Something went wrong, nothing was deleted.') }
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal cleanup" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>Clean up FL projects</h2>
            <p className="help">{items ? `${items.length} projects · ${mb(items.reduce((a, i) => a + i.size, 0))}` : 'Reading your projects…'}. Mark the ones you do not want and they move to the Trash, never deleted outright.</p>
          </div>
          <button onClick={onClose}>Close</button>
        </header>

        <div className="cl-bar">
          <div className="seg">{FILTERS.map((f) => <button key={f.id} className={filter === f.id ? 'on' : ''} title={f.hint} onClick={() => setFilter(f.id)}>{f.label}{f.id === 'marked' && marks.size ? ` ${marks.size}` : ''}</button>)}</div>
          <input type="text" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="largest">Largest first</option><option value="name">Name</option>
          </select>
        </div>

        <div className="cl-body">
          <div className="cl-list">
            {items && shown.length === 0 && <p className="help dim" style={{ padding: 20 }}>Nothing matches this filter.</p>}
            {shown.map((it) => (
              <div key={it.id} data-cid={it.id} className={`cl-row ${it.id === sel ? 'sel' : ''} ${marks.has(it.id) ? 'mk' : ''}`} onClick={() => setSel(it.id)}>
                <input type="checkbox" checked={marks.has(it.id)} onChange={() => toggleMark(it.id)} onClick={(e) => e.stopPropagation()} aria-label="mark for the Trash" />
                <div className="cl-name"><b>{it.name}</b><span className="dim">{ago(it.mtime)} · {mb(it.size)} · {it.samples} samples · {it.midis} MIDI</span></div>
                <div className="cl-tags">
                  {it.bounces > 0 ? <em className="cb ok">exported</em> : <em className="cb">no bounce</em>}
                  {it.status && protectedStatus(it) && <em className={`cb st-${it.status}`}>{it.status}</em>}
                  {it.backups > 0 && <em className="cb">{it.backups} backups</em>}
                </div>
              </div>
            ))}
          </div>

          <aside className="cl-pane">
            {cur ? (
              <>
                <img className="cl-art" alt="" src={artUrl({ seed: cur.groupId ? `g${cur.groupId}` : `p${cur.id}`, peaks: cur.thumb, key: cur.key, bpm: cur.bpm })} />
                <h3>{cur.title ?? cur.name}</h3>
                <div className="dim cl-path" title={cur.path}>{cur.path.replace(/^.*\/Projects\//, '')}</div>
                <div className="cl-facts">
                  <span>Last edited <b>{ago(cur.mtime)}</b></span><span>Size <b>{mb(cur.size)}</b></span>
                  <span>Samples <b>{cur.samples}</b></span><span>MIDI <b>{cur.midis}</b></span>
                  {cur.bpm && <span>Tempo <b>{fmtBpm(cur.bpm)}</b></span>}
                  {cur.key && <span>Key <b style={{ color: keyColor(cur.key) }}>{displayKey(cur.key)}</b></span>}
                </div>
                <p className="help">{cur.bounces > 0 ? `Exported: ${cur.bounces} bounce${cur.bounces === 1 ? '' : 's'} in your vault stay where they are.` : 'Never exported. This project is the only copy of the idea.'}
                  {cur.backups > 0 ? ` ${cur.backups} FL autosave backups (${mb(cur.backupBytes)}).` : ''}</p>
                <div className="actions">
                  <button disabled={!cur.playId} onClick={togglePlay} title={cur.playId ? 'Space' : 'No audio to play for this project'}>{playing === cur.id ? 'Stop' : cur.playId ? 'Listen' : 'No audio'}</button>
                  <button onClick={() => window.api.projectOpen(cur.id)} title="O">Open in FL</button>
                  <button onClick={() => window.api.projectReveal(cur.id)}>Show in Finder</button>
                </div>
                <button className={`cl-mark ${marks.has(cur.id) ? 'on' : ''}`} onClick={() => { toggleMark(cur.id); step(1) }}>{marks.has(cur.id) ? 'Marked for the Trash (X to undo)' : 'Mark for the Trash (X)'}</button>
                {protectedStatus(cur) && <p className="notice">This beat is marked <b>{cur.status}</b> in your vault, so Select all skips it.</p>}
              </>
            ) : <div className="cl-empty"><p className="help">Pick a project to see it. <kbd>↑</kbd><kbd>↓</kbd> move, <kbd>X</kbd> marks it for the Trash, <kbd>Space</kbd> listens, <kbd>O</kbd> opens it in FL.</p></div>}
          </aside>
        </div>

        {msg && <p className="notice">{msg}</p>}
        {!confirm ? (
          <footer className="cl-foot">
            <span><b>{marks.size}</b> marked{marks.size ? ` · ${mb(markedBytes)}` : ''}</span>
            <button onClick={selectShown} disabled={!shown.length} title={skipped ? `Skips ${skipped} finished/sent/sold` : ''}>Mark all shown{skipped ? ` (skips ${skipped})` : ''}</button>
            <button onClick={() => setMarks(new Set())} disabled={!marks.size}>Clear marks</button>
            <span className="grow" />
            <button className="danger" disabled={!marks.size} onClick={() => { setMsg(''); setConfirm(true) }}>Move to Trash…</button>
          </footer>
        ) : (
          <footer className="cl-foot confirm">
            <div>
              <b>Move {marks.size} project{marks.size === 1 ? '' : 's'} ({mb(markedBytes)}) to the Trash?</b>
              <div className="dim">{markedItems.slice(0, 4).map((i) => i.name).join(', ')}{markedItems.length > 4 ? ` and ${markedItems.length - 4} more` : ''}. Only the .flp files move; samples and exported audio are untouched.</div>
              {markedBackups > 0 && <label className="check small"><input type="checkbox" checked={withBackups} onChange={(e) => setWithBackups(e.target.checked)} /> Also move their {markedBackups} FL autosave backups</label>}
            </div>
            <button onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
            <button className="danger" onClick={doTrash} disabled={busy}>{busy ? 'Moving…' : 'Move to Trash'}</button>
          </footer>
        )}
      </div>
    </div>
  )
}
