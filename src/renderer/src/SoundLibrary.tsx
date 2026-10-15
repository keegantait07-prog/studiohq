import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SOUND_KINDS, type SoundKind, type SoundList, type SoundRow, type SoundStatus } from '@shared/types'
import { displayKey } from '@shared/key'
import { Waveform } from './Waveform'
import { DupesDialog } from './DupesDialog'
import { fmtBpm } from './format'

const ROW = 34
const SEP = '/'
const group = (k: SoundKind) => (['kick', 'snare', 'clap', 'hat', 'perc', '808'].includes(k) ? 'g1' : ['bass', 'melody', 'vocal'].includes(k) ? 'g2' : 'g3')
const fmtLen = (u: number | null) => (u == null ? '' : u < 10 ? u.toFixed(2) + 's' : `${Math.floor(u / 60)}:${String(Math.floor(u % 60)).padStart(2, '0')}`)
const fmtSize = (n: number) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB')

interface Node { name: string; path: string; kids: Map<string, Node>; count: number }

function buildTree(roots: string[], dirs: string[], counts: number[]): Node[] {
  const top = roots.map((r) => ({ name: r.endsWith('FL project MIDI') ? 'FL project MIDI (made from your projects)' : r.split(SEP).pop() || r, path: r, kids: new Map<string, Node>(), count: 0 }))
  const orphans: Node = { name: 'Outside library folders', path: '', kids: new Map(), count: 0 }
  dirs.forEach((d, i) => {
    const n = counts[i]
    if (!n) return
    const root = top.find((r) => d === r.path || d.startsWith(r.path + SEP))
    if (!root) { orphans.count += n; orphans.kids.set(d, { name: d, path: d, kids: new Map(), count: n }); return }
    root.count += n
    let cur = root
    for (const seg of d.slice(root.path.length + 1).split(SEP).filter(Boolean)) {
      const p = cur.path + SEP + seg
      let next = cur.kids.get(seg)
      if (!next) cur.kids.set(seg, (next = { name: seg, path: p, kids: new Map(), count: 0 }))
      next.count += n
      cur = next
    }
  })
  if (orphans.count) top.push(orphans)
  return top
}

interface Props {
  data: SoundList | null
  roots: string[]
  status: SoundStatus
  query: string
  onQuery: (q: string) => void
  projectSel: number | null
  onProjectSel: (id: number | null) => void
  onReload: () => void
  onPauseMain: () => void
  toast: (m: string) => void
}

export function SoundLibrary({ data, roots: settingsRoots, status, query, onQuery, projectSel, onProjectSel, onReload, onPauseMain, toast }: Props) {
  const roots = data?.roots?.length ? data.roots : settingsRoots
  const [side, setSide] = useState<'folders' | 'projects'>('folders')
  const [projQ, setProjQ] = useState('')
  const [part, setPart] = useState<'all' | 'samples' | 'midi'>('all')
  const projects = data?.projects ?? []
  const project = projectSel != null ? projects.find((x) => x.id === projectSel) ?? null : null
  const collection = useMemo(() => (project ? new Set([...project.samples, ...project.midis]) : null), [project])
  const [kinds, setKinds] = useState<Set<SoundKind>>(new Set())
  const [favOnly, setFavOnly] = useState(false)
  const [shape, setShape] = useState<'all' | 'oneshot' | 'loop'>('all')
  const [folder, setFolder] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [active, setActive] = useState<number | null>(null)
  const [anchor, setAnchor] = useState<number>(-1)
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('shq-autoplay') !== '0' } catch { return true } })
  const [loop, setLoop] = useState(false)
  const [sort, setSort] = useState<{ by: 'n' | 'u' | 'k' | 'b' | 's'; dir: 1 | -1 }>({ by: 'n', dir: 1 })
  const [tagDraft, setTagDraft] = useState('')
  const [dupes, setDupes] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [peaks, setPeaks] = useState<number[]>([])
  const list = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [viewH, setViewH] = useState(600)
  const audio = useRef<HTMLAudioElement | null>(null)
  const byIdRef = useRef(new Map<number, SoundRow>())

  const items = data?.items ?? []
  const dirs = data?.dirs ?? []
  const hay = useMemo(() => items.map((s) => `${s.n} ${dirs[s.d]} ${s.t.join(' ')} ${s.k}`.toLowerCase()), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(items.map((s) => [s.id, s])), [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const out: SoundRow[] = []
    items.forEach((s, i) => {
      if (kinds.size && !kinds.has(s.k)) return
      if (favOnly && !s.f) return
      const isLoop = s.k === 'loop' || (s.u ?? 0) > 3
      if (shape === 'loop' && !isLoop) return
      if (shape === 'oneshot' && isLoop) return
      if (collection && !collection.has(s.id)) return
      if (collection && part === 'midi' && s.k !== 'midi') return
      if (collection && part === 'samples' && s.k === 'midi') return
      if (folder) { const d = dirs[s.d]; if (d !== folder && !d.startsWith(folder + SEP)) return }
      for (const w of words) if (!hay[i].includes(w)) return
      out.push(s)
    })
    const { by, dir } = sort
    return out.sort((a, b) => {
      const x = by === 'n' ? a.n.toLowerCase() : by === 'k' ? a.k : (a[by] ?? -1)
      const y = by === 'n' ? b.n.toLowerCase() : by === 'k' ? b.k : (b[by] ?? -1)
      return (x < y ? -1 : x > y ? 1 : 0) * dir
    })
  }, [data, kinds, favOnly, shape, folder, query, sort, collection, part]) // eslint-disable-line react-hooks/exhaustive-deps

  byIdRef.current = byId
  const counts = useMemo(() => { const c = new Array(dirs.length).fill(0); items.forEach((s) => c[s.d]++); return c }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildTree(roots, dirs, counts), [roots, dirs, counts])
  useEffect(() => { setOpen((o) => (o.size ? o : new Set(roots))) }, [roots])

  // ---- preview audio ----
  useEffect(() => {
    const a = new Audio()
    audio.current = a
    a.addEventListener('timeupdate', () => setTime(a.currentTime))
    a.addEventListener('play', () => setPlaying(true))
    a.addEventListener('pause', () => setPlaying(false))
    a.addEventListener('ended', () => setPlaying(false))
    a.addEventListener('loadedmetadata', () => setDur(isFinite(a.duration) ? a.duration : 0))
    return () => { a.pause(); a.src = '' }
  }, [])
  useEffect(() => { if (audio.current) audio.current.loop = loop }, [loop])

  const play = useCallback((id: number) => {
    const a = audio.current!
    if (byIdRef.current.get(id)?.k === 'midi') { toast('MIDI has no audio preview. Drag it into FL Studio (piano roll or playlist).'); return }
    onPauseMain()
    a.src = `shqa://sound/${id}`
    a.currentTime = 0
    a.play().catch(() => {})
  }, [onPauseMain, toast])

  const seq = useRef(0)
  useEffect(() => {
    setPeaks([])
    const s = active != null ? byId.get(active) : undefined
    if (!s || s.k === 'midi' || s.s > 15e6 || (s.u ?? 0) > 90) return
    const id = ++seq.current
    ;(async () => {
      try {
        const buf = await (await fetch(`shqa://sound/${s.id}`)).arrayBuffer()
        const ctx = new AudioContext()
        const dec = await ctx.decodeAudioData(buf)
        ctx.close()
        const ch = dec.getChannelData(0), n = 160, step = Math.max(1, Math.floor(ch.length / n))
        const out: number[] = []
        for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(ch.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(ch[j])); out.push(m) }
        const top = Math.max(...out, 1e-6)
        if (id === seq.current) setPeaks(out.map((v) => Math.round(Math.sqrt(v / top) * 255)))
      } catch { /* undecodable: no waveform */ }
    })()
  }, [active, byId])

  // ---- selection ----
  const select = (i: number, e?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }, autoplay = true) => {
    const s = filtered[i]
    if (!s) return
    if (e?.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]
      setSel(new Set(filtered.slice(a, b + 1).map((x) => x.id)))
    } else if (e?.metaKey || e?.ctrlKey) {
      setSel((p) => { const n = new Set(p); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n })
      setAnchor(i)
    } else {
      setSel(new Set([s.id])); setAnchor(i)
    }
    setActive(s.id)
    if (autoplay && auto && !e?.shiftKey && !e?.metaKey && !e?.ctrlKey) play(s.id)
  }
  const activeIdx = active != null ? filtered.findIndex((s) => s.id === active) : -1
  const ids = () => (sel.size ? [...sel] : active != null ? [active] : [])

  const toggleFav = async () => {
    const target = ids()
    if (!target.length) return
    const make = !target.every((id) => byId.get(id)?.f)
    await window.api.soundsFav(target, make)
    onReload()
  }
  const addTag = async () => {
    const t = tagDraft.trim()
    if (!t || !ids().length) return
    await window.api.soundsTag(ids(), t.split(',').map((x) => x.trim()), [])
    setTagDraft(''); onReload()
  }

  useEffect(() => {
    const el = list.current
    if (!el) return
    setViewH(el.clientHeight)
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const ensureVisible = (i: number) => {
    const el = list.current
    if (!el) return
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW
    else if ((i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW - el.clientHeight
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      const mod = e.metaKey || e.ctrlKey
      if (typing || dupes) return
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(new Set(filtered.map((s) => s.id))); return }
      if (mod) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const i = Math.max(0, Math.min(filtered.length - 1, (activeIdx < 0 ? (e.key === 'ArrowDown' ? -1 : filtered.length) : activeIdx) + (e.key === 'ArrowDown' ? 1 : -1)))
        select(i, { shiftKey: e.shiftKey })
        ensureVisible(i)
      } else if (e.key === ' ') {
        e.preventDefault()
        const a = audio.current!
        if (!a.src && active != null) play(active)
        else a.paused ? (onPauseMain(), a.play().catch(() => {})) : a.pause()
      } else if (e.key === 'Enter' && active != null) play(active)
      else if (e.key.toLowerCase() === 'f') toggleFav()
      else if (e.key.toLowerCase() === 'l') setLoop((l) => !l)
      else if (e.key === 'Escape') setSel(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- tree rendering ----
  const toggle = (p: string) => setOpen((o) => { const n = new Set(o); n.has(p) ? n.delete(p) : n.add(p); return n })
  const renderNode = (n: Node, depth: number): React.ReactNode => (
    <div key={n.path}>
      <div className={`tnode ${folder === n.path ? 'sel' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setFolder(folder === n.path ? null : n.path)}>
        <span className="tcaret" onClick={(e) => { e.stopPropagation(); toggle(n.path) }}>{n.kids.size ? (open.has(n.path) ? '▾' : '▸') : ''}</span>
        <span className="tname" title={n.path}>{n.name}</span><span className="tcount">{n.count}</span>
      </div>
      {open.has(n.path) && [...n.kids.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((k) => renderNode(k, depth + 1))}
    </div>
  )

  const start = Math.max(0, Math.floor(scroll / ROW) - 6)
  const end = Math.min(filtered.length, start + Math.ceil(viewH / ROW) + 14)
  const selTags = useMemo(() => { const m = new Map<string, number>(); for (const id of sel) for (const t of byId.get(id)?.t ?? []) m.set(t, (m.get(t) ?? 0) + 1); return [...m] }, [sel, byId])
  const rootOf = (d: string) => roots.find((r) => d.startsWith(r)) ?? ''
  const head = (by: typeof sort.by, label: string, cls = '') => <span className={`sh ${cls}`} onClick={() => setSort((s) => ({ by, dir: s.by === by ? (-s.dir as 1 | -1) : 1 }))}>{label}{sort.by === by ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
  const activeSound = active != null ? byId.get(active) : undefined

  return (
    <section className="soundv">
      <div className="sales-head">
        <h2>Sound Library</h2>
        <span className="dim">{items.length.toLocaleString()} sounds{status.phase !== 'idle' ? ` · ${status.phase === 'reading' ? `reading file info ${status.done.toLocaleString()}/${status.total.toLocaleString()}` : status.phase === 'hashing' ? `comparing files ${status.done}/${status.total}` : 'scanning folders…'}` : ''}</span>
        <div className="grow" />
        <button onClick={() => setDupes(true)}>Find duplicates</button>
        <button onClick={() => window.api.soundsScan().then(onReload)} disabled={status.phase === 'scanning'}>Rescan</button>
      </div>
      <div className="snd-tools">
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search name, folder, tag…" style={{ maxWidth: 280 }} />
        <div className="kchips">
          {SOUND_KINDS.filter((k) => k !== 'other').map((k) => <button key={k} className={`tab ${kinds.has(k) ? 'on' : ''}`} onClick={() => setKinds((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })}>{k}</button>)}
        </div>
        <div className="seg" style={{ width: 'auto' }}>{([['all', 'All'], ['oneshot', 'One-shots'], ['loop', 'Loops']] as const).map(([k, l]) => <button key={k} className={shape === k ? 'on' : ''} onClick={() => setShape(k)}>{l}</button>)}</div>
        <button className={favOnly ? 'primary' : ''} onClick={() => setFavOnly((f) => !f)}>★ Favorites</button>
      </div>

      <div className="snd-split">
        <aside className="snd-tree">
          <div className="seg" style={{ margin: '0 8px 8px' }}>
            <button className={side === 'folders' ? 'on' : ''} onClick={() => setSide('folders')}>Folders</button>
            <button className={side === 'projects' ? 'on' : ''} onClick={() => setSide('projects')}>FL projects {projects.length || ''}</button>
          </div>
          {side === 'folders' ? (
            <>
              <div className={`tnode ${folder === null && !project ? 'sel' : ''}`} onClick={() => { setFolder(null); onProjectSel(null) }}><span className="tcaret" /><span className="tname">All folders</span><span className="tcount">{items.length}</span></div>
              {tree.map((n) => renderNode(n, 0))}
              {!roots.length && <p className="help" style={{ padding: 8 }}>Add a sounds folder in Settings.</p>}
            </>
          ) : (
            <>
              <input style={{ margin: '0 8px 6px', width: 'calc(100% - 16px)' }} value={projQ} onChange={(e) => setProjQ(e.target.value)} placeholder="Find a project…" />
              {projects.filter((x) => !projQ || x.name.toLowerCase().includes(projQ.toLowerCase())).map((x) => (
                <div key={x.id} className={`tnode ${projectSel === x.id ? 'sel' : ''}`} style={{ paddingLeft: 10 }} onClick={() => { onProjectSel(projectSel === x.id ? null : x.id); setFolder(null); setPart('all') }} title={x.path}>
                  <span className="tname">{x.name}</span><span className="tcount">{x.samples.length}{x.midis.length ? ` + ${x.midis.length}♪` : ''}</span>
                </div>
              ))}
              {!projects.length && <p className="help" style={{ padding: 8 }}>No FL projects read yet. They are picked up from your project folders on each scan.</p>}
            </>
          )}
        </aside>

        <div className="snd-main">
          {project && (
            <div className="pbanner">
              <div className="pb-top">
                <b>{project.name}</b>{project.beatTitle && <span className="dim"> · beat “{project.beatTitle}”</span>}
                <div className="grow" />
                <div className="seg" style={{ width: 'auto' }}>{([['all', `All ${project.samples.length + project.midis.length}`], ['samples', `Samples ${project.samples.length}`], ['midi', `MIDI ${project.midis.length}`]] as const).map(([k, l]) => <button key={k} className={part === k ? 'on' : ''} onClick={() => setPart(k)}>{l}</button>)}</div>
                <button onClick={() => window.api.projectOpen(project.id)}>Open in FL</button>
                <button onClick={() => window.api.projectReveal(project.id)}>Show in Finder</button>
                <button onClick={() => onProjectSel(null)}>×</button>
              </div>
              <div className="dim pb-sub">
                {project.samples.length} sample{project.samples.length === 1 ? '' : 's'} used{project.byName ? ` (${project.byName} found by file name, not by original path)` : ''} · {project.midis.length} MIDI pattern{project.midis.length === 1 ? '' : 's'} exported{project.partial ? ' · this older project could only be read partly' : ''}
              </div>
              {project.missing.length > 0 && (
                <details className="pb-missing"><summary>{project.missing.length} sample{project.missing.length === 1 ? '' : 's'} not found on this Mac</summary>
                  <div>{project.missing.slice(0, 60).map((m) => <div key={m.ref} className="dim" title={m.ref}>{m.name}{m.channel && m.channel !== m.name ? ` (channel “${m.channel}”)` : ''}</div>)}{project.missing.length > 60 && <div className="dim">…and {project.missing.length - 60} more</div>}</div>
                </details>
              )}
            </div>
          )}
          <div className="srow2 shead2"><span /><span>{head('n', 'Name')}</span>{head('k', 'Type')}<span>Tags</span>{head('u', 'Length', 'r')}{head('b', 'BPM', 'r')}<span>Key</span>{head('s', 'Size', 'r')}<span>Folder</span></div>
          <div className="svirt" ref={list} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
            <div style={{ height: filtered.length * ROW, position: 'relative' }}>
              {filtered.slice(start, end).map((s, k) => {
                const i = start + k
                const on = sel.has(s.id)
                return (
                  <div key={s.id} className={`srow2 ${on ? 'sel' : ''} ${active === s.id ? 'act' : ''}`} style={{ position: 'absolute', top: i * ROW, left: 0, right: 0, height: ROW }}
                    draggable onDragStart={(e) => { e.preventDefault(); window.api.startDrag('sound', on ? [...sel] : [s.id]) }}
                    onClick={(e) => select(i, e)} onDoubleClick={() => play(s.id)}>
                    <button className={`star ${s.f ? 'on' : ''}`} onClick={async (e) => { e.stopPropagation(); await window.api.soundsFav([s.id], !s.f); onReload() }} aria-label="favorite">{s.f ? '★' : '☆'}</button>
                    <span className="sname" title={s.n}>{s.n}</span>
                    <span><i className={`kdot ${group(s.k)}`} />{s.k}</span>
                    <span className="stags">{s.t.slice(0, 3).map((t) => <span key={t} className="chip">{t}</span>)}</span>
                    <span className="r mono dim">{s.k === 'midi' ? `${s.m ?? ''} notes` : fmtLen(s.u)}</span>
                    <span className="r mono">{s.b ? fmtBpm(s.b) : ''}</span>
                    <span className="mono dim">{displayKey(s.y)}</span>
                    <span className="r mono dim">{fmtSize(s.s)}</span>
                    <span className="dim sfolder" title={dirs[s.d]}>{dirs[s.d].slice(rootOf(dirs[s.d]).length + 1)}</span>
                  </div>
                )
              })}
              {data && !filtered.length && <div className="empty">{items.length ? 'No sounds match.' : 'No sounds found yet. Add a folder in Settings, then Rescan.'}</div>}
            </div>
          </div>

          <div className="snd-bottom">
            {sel.size > 0 ? (
              <div className="selbar">
                <b>{sel.size} selected</b>
                <div className="chips" style={{ background: 'transparent', border: 0, padding: 0 }}>
                  {selTags.map(([t, c]) => <span key={t} className="chip">{t}{c < sel.size ? ` (${c})` : ''}<button onClick={async () => { await window.api.soundsTag([...sel], [], [t]); onReload() }}>×</button></span>)}
                  <input value={tagDraft} placeholder="add tag, press Enter" onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTag() }} style={{ width: 170 }} />
                </div>
                <button onClick={toggleFav}>★ Favorite</button>
                {sel.size === 1 && <button onClick={() => window.api.soundsReveal([...sel][0])}>Reveal</button>}
                <span className="dim">Drag a row into FL Studio</span>
              </div>
            ) : <div className="selbar dim">Click to preview · ↑↓ browse · F favorite · L loop · drag a row into your DAW</div>}
            <div className="pv">
              <button className="big-play" style={{ width: 34, height: 34, fontSize: 12 }} onClick={() => { const a = audio.current!; if (!a.src && active != null) play(active); else a.paused ? (onPauseMain(), a.play().catch(() => {})) : a.pause() }}>{playing ? '❚❚' : '▶'}</button>
              <div className="pv-name"><b>{activeSound?.n ?? 'Nothing selected'}</b><span className="dim mono">{activeSound ? (activeSound.k === 'midi' ? `MIDI · ${activeSound.m ?? ''} notes · drag into FL` : `${fmtLen(activeSound.u)} · ${activeSound.e}`) : ''}</span></div>
              <div style={{ flex: 1, minWidth: 0 }}><Waveform peaks={peaks} progress={dur ? time / dur : 0} height={40} onSeek={(f) => { const a = audio.current!; if (dur) { a.currentTime = f * dur; if (a.paused) a.play().catch(() => {}) } }} /></div>
              <label className="check small"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem('shq-autoplay', e.target.checked ? '1' : '0') } catch { /* ignore */ } }} /> Auto-play</label>
              <label className="check small"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label>
            </div>
          </div>
        </div>
      </div>
      {dupes && <DupesDialog roots={roots} onClose={() => setDupes(false)} onDone={(m) => { setDupes(false); toast(m); onReload() }} />}
    </section>
  )
}
