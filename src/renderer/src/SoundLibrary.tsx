import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SOUND_KINDS, type SoundKind, type SoundList, type SoundRow, type SoundStatus } from '@shared/types'
import { displayKey } from '@shared/key'
import { Waveform } from './Waveform'
import { DupesDialog } from './DupesDialog'
import { fmtBpm } from './format'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Heart, Play, Pause, Search, Copy, RefreshCw, ChevronRight, ChevronDown, GripVertical, Folder as FolderIcon, X } from 'lucide-react'
import { ScrollArea } from '@/components/lib/scroll-area'
import { TooltipProvider } from '@/components/lib/tooltip'
import { Button, Chip, IconBtn, Seg, useHoverCapable } from './makeUi'
import './make.css'

const ROW = 44
const XP = 58 // height of the hover-expand panel (S53 HoverExpand pattern)
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
  const start = Math.max(0, Math.floor(scroll / ROW) - 6)
  const end = Math.min(filtered.length, start + Math.ceil(viewH / ROW) + 14)
  const selTags = useMemo(() => { const m = new Map<string, number>(); for (const id of sel) for (const t of byId.get(id)?.t ?? []) m.set(t, (m.get(t) ?? 0) + 1); return [...m] }, [sel, byId])
  const rootOf = (d: string) => roots.find((r) => d.startsWith(r)) ?? ''
  const activeSound = active != null ? byId.get(active) : undefined

  const still = useReducedMotion()
  const hoverOK = useHoverCapable()
  const [hov, setHov] = useState<number | null>(null)
  const hovS = hov != null ? filtered[hov] : undefined
  const togglePlay = () => { const a = audio.current!; if (!a.src && active != null) play(active); else a.paused ? (onPauseMain(), a.play().catch(() => {})) : a.pause() }
  const statusText = status.phase !== 'idle' ? ` · ${status.phase === 'reading' ? `reading file info ${status.done.toLocaleString()}/${status.total.toLocaleString()}` : status.phase === 'hashing' ? `comparing files ${status.done}/${status.total}` : 'scanning folders…'}` : ''
  const relDir = (d: number) => dirs[d].slice(rootOf(dirs[d]).length + 1) || dirs[d]
  const allFav = ids().length > 0 && ids().every((id) => byId.get(id)?.f)
  const sortAttr = (by: typeof sort.by) => (sort.by === by ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none') as 'ascending' | 'descending' | 'none'
  const th = (by: typeof sort.by, label: string, cls = '') => (
    <button type="button" role="columnheader" aria-sort={sortAttr(by)} className={`mk-th ${cls}`} onClick={() => setSort((s) => ({ by, dir: s.by === by ? (-s.dir as 1 | -1) : 1 }))}>{label}{sort.by === by ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button>
  )

  const renderNode = (n: Node, depth: number): React.ReactNode => (
    <div key={n.path}>
      <div className={`mk-node ${folder === n.path ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        <button type="button" className="mk-caret" aria-label={open.has(n.path) ? 'Collapse' : 'Expand'} aria-expanded={n.kids.size ? open.has(n.path) : undefined} disabled={!n.kids.size} onClick={() => toggle(n.path)}>{n.kids.size ? (open.has(n.path) ? <ChevronDown /> : <ChevronRight />) : null}</button>
        <button type="button" className="mk-nname" title={n.path} onClick={() => setFolder(folder === n.path ? null : n.path)}>{n.name}</button>
        <span className="mk-n">{n.count}</span>
      </div>
      {open.has(n.path) && [...n.kids.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((k) => renderNode(k, depth + 1))}
    </div>
  )

  return (
    <TooltipProvider>
    <section className="mk-sounds">
      <aside className="mk-tree" aria-label="Library">
        <div className="mk-tree-h">
          <Seg full label="Library side" value={side} onChange={setSide} options={[{ v: 'folders', label: 'Folders' }, { v: 'projects', label: `FL projects ${projects.length || ''}` }]} />
          {side === 'projects' && <label className="mk-field"><Search aria-hidden="true" /><input value={projQ} onChange={(e) => setProjQ(e.target.value)} placeholder="Find a project…" aria-label="Find a project" /></label>}
        </div>
        <ScrollArea className="mk-scroll">
          <div className="mk-tlist">
            {side === 'folders' ? (
              <>
                <div className={`mk-node ${folder === null && !project ? 'on' : ''}`}>
                  <span className="mk-caret" />
                  <button type="button" className="mk-nname" onClick={() => { setFolder(null); onProjectSel(null) }}>All folders</button>
                  <span className="mk-n">{items.length}</span>
                </div>
                {tree.map((n) => renderNode(n, 0))}
                {!roots.length && <p className="mk-help">Add a sounds folder in Settings.</p>}
              </>
            ) : (
              <>
                {projects.filter((x) => !projQ || x.name.toLowerCase().includes(projQ.toLowerCase())).map((x) => (
                  <button key={x.id} type="button" className={`mk-proj ${projectSel === x.id ? 'on' : ''}`} title={x.path} onClick={() => { onProjectSel(projectSel === x.id ? null : x.id); setFolder(null); setPart('all') }}>
                    <b>{x.name}</b><small>{x.samples.length} sample{x.samples.length === 1 ? '' : 's'}{x.midis.length ? ` + ${x.midis.length} MIDI` : ''}{x.missing.length ? <span className="mk-miss"> · {x.missing.length} missing</span> : null}</small>
                  </button>
                ))}
                {!projects.length && <p className="mk-help">No FL projects read yet. They are picked up from your project folders on each scan.</p>}
              </>
            )}
          </div>
        </ScrollArea>
      </aside>

      <div className="mk-list">
        <div className="mk-tools">
          <h2 className="mk-disp">Sounds</h2>
          <span className="mk-dim">{items.length.toLocaleString()} sounds{statusText}</span>
          <label className="mk-field grow"><Search aria-hidden="true" /><input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search name, folder, tag…" aria-label="Search sounds" /></label>
          <Chip on={favOnly} onClick={() => setFavOnly((f) => !f)}><Heart aria-hidden="true" />Favorites</Chip>
          <span className="mk-sp" />
          <Button variant="outline" size="sm" onClick={() => setDupes(true)}><Copy />Find duplicates</Button>
          <Button variant="outline" size="sm" onClick={() => window.api.soundsScan().then(onReload)} disabled={status.phase === 'scanning'}><RefreshCw />Rescan</Button>
        </div>
        <div className="mk-top">
          <div className="mk-filters">
            <Seg label="Shape" value={shape} onChange={setShape} options={[{ v: 'all', label: 'All' }, { v: 'oneshot', label: 'One-shots' }, { v: 'loop', label: 'Loops' }]} />
            <div className="mk-chips" role="group" aria-label="Sound type">
              {SOUND_KINDS.filter((k) => k !== 'other').map((k) => <Chip key={k} on={kinds.has(k)} onClick={() => setKinds((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })}>{k}</Chip>)}
            </div>
          </div>
          {project && (
            <div className="mk-pbanner">
              <div className="mk-pb-top">
                <b>{project.name}</b>{project.beatTitle && <span className="mk-dim"> · beat “{project.beatTitle}”</span>}
                <span className="mk-sp" />
                <Seg label="Project part" value={part} onChange={setPart} options={[{ v: 'all', label: `All ${project.samples.length + project.midis.length}` }, { v: 'samples', label: `Samples ${project.samples.length}` }, { v: 'midi', label: `MIDI ${project.midis.length}` }]} />
                <Button variant="outline" size="xs" onClick={() => window.api.projectOpen(project.id)}>Open in FL</Button>
                <Button variant="outline" size="xs" onClick={() => window.api.projectReveal(project.id)}>Show in Finder</Button>
                <IconBtn label="Close project" onClick={() => onProjectSel(null)}><X /></IconBtn>
              </div>
              <div className="mk-dim mk-pb-sub">
                {project.samples.length} sample{project.samples.length === 1 ? '' : 's'} used{project.byName ? ` (${project.byName} found by file name, not by original path)` : ''} · {project.midis.length} MIDI pattern{project.midis.length === 1 ? '' : 's'} exported{project.partial ? ' · newer or unusual project format: samples found, MIDI not available' : ''}
              </div>
              {project.missing.length > 0 && (
                <details className="mk-pb-missing"><summary>{project.missing.length} sample{project.missing.length === 1 ? '' : 's'} not found on this Mac</summary>
                  <div>{project.missing.slice(0, 60).map((m) => <div key={m.ref} className="mk-dim" title={m.ref}>{m.name}{m.channel && m.channel !== m.name ? ` (channel “${m.channel}”)` : ''}</div>)}{project.missing.length > 60 && <div className="mk-dim">…and {project.missing.length - 60} more</div>}</div>
                </details>
              )}
            </div>
          )}
        </div>
        <div className="mk-thead mk-sgrid" role="row"><span /><span />{th('n', 'Name')}{th('k', 'Type')}<span className="c-tags">Tags</span>{th('u', 'Length', 'r')}{th('b', 'BPM', 'r')}<span>Key</span>{th('s', 'Size', 'r c-size')}</div>
        <div className="mk-rows" ref={list} onScroll={(e) => { setScroll(e.currentTarget.scrollTop); setHov(null) }} role="rowgroup">
          <div style={{ height: filtered.length * ROW, position: 'relative' }} onMouseLeave={() => setHov(null)}>
            {filtered.slice(start, end).map((s, k) => {
              const i = start + k
              const on = sel.has(s.id)
              return (
                <div key={s.id} className={`mk-sr mk-sgrid ${on ? 'sel' : ''} ${active === s.id ? 'act' : ''}`} style={{ top: i * ROW, height: ROW }} role="row"
                  draggable onDragStart={(e) => { e.preventDefault(); window.api.startDrag('sound', on ? [...sel] : [s.id]) }}
                  onMouseEnter={() => setHov(i)}
                  onClick={(e) => select(i, e)} onDoubleClick={() => play(s.id)}>
                  <button type="button" className={`mk-fav ${s.f ? 'on' : ''}`} aria-pressed={s.f} aria-label={s.f ? 'Remove favorite' : 'Favorite'} onClick={async (e) => { e.stopPropagation(); await window.api.soundsFav([s.id], !s.f); onReload() }}><Heart /></button>
                  <button type="button" className="mk-p" aria-label={`Preview ${s.n}`} onClick={(e) => { e.stopPropagation(); select(i, undefined, false); play(s.id) }}>{playing && active === s.id ? <Pause /> : <Play />}</button>
                  <span className="mk-nm"><b title={s.n}>{s.n}</b><small title={dirs[s.d]}>{relDir(s.d)}</small></span>
                  <span className="mk-type"><i className={`mk-kdot ${group(s.k)}`} />{s.k}</span>
                  <span className="mk-tg c-tags">{s.t.slice(0, 2).map((t) => <span key={t} className="mk-tag">{t}</span>)}</span>
                  <span className="r mono mk-dim">{s.k === 'midi' ? `${s.m ?? ''} notes` : fmtLen(s.u)}</span>
                  <span className="r mono">{s.b ? fmtBpm(s.b) : ''}</span>
                  <span className="mono mk-dim">{displayKey(s.y)}</span>
                  <span className="r mono mk-dim c-size">{fmtSize(s.s)}</span>
                </div>
              )
            })}
            <AnimatePresence>
              {hoverOK && hov != null && hovS && (
                <motion.div key={hovS.id} className="mk-xp" style={{ top: (hov + 1) * ROW }} aria-hidden="true"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: XP, opacity: 1, transition: { duration: still ? 0 : 0.26, delay: still ? 0 : 0.14, ease: [0.23, 1, 0.32, 1] } }}
                  exit={{ height: 0, opacity: 0, transition: { duration: still ? 0 : 0.12 } }}>
                  <div className="mk-xp-in">
                    <span className="mk-xp-path"><FolderIcon />{dirs[hovS.d]}</span>
                    <span className="mk-xp-tags">{hovS.t.length ? hovS.t.map((t) => <span key={t} className="mk-tag">{t}</span>) : <span className="mk-dim">no tags</span>}<span className="mk-dim mono">{hovS.e} · {fmtSize(hovS.s)}</span></span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {!data && <div className="mk-empty"><b>Loading your library…</b></div>}
            {data && !filtered.length && <div className="mk-empty"><b>{items.length ? 'No sounds match.' : 'No sounds found yet.'}</b>{items.length ? 'Clear a filter or change the search.' : 'Add a folder in Settings, then Rescan.'}</div>}
          </div>
        </div>
        <div className="mk-hint">
          <span><kbd>Click</kbd> preview</span><span><kbd>↑</kbd><kbd>↓</kbd> browse</span><span><kbd>F</kbd> favorite</span><span><kbd>L</kbd> loop</span><span>drag a row into your DAW</span>
          <span className="mk-sp" />
          <label className="mk-lbl"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem('shq-autoplay', e.target.checked ? '1' : '0') } catch { /* ignore */ } }} />Auto-play</label>
          <label className="mk-lbl"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />Loop</label>
        </div>
      </div>

      <aside className="mk-insp" aria-label="Preview">
        <div className="mk-pv">
          <Waveform peaks={peaks} progress={dur ? time / dur : 0} height={96} onSeek={(f) => { const a = audio.current!; if (dur) { a.currentTime = f * dur; if (a.paused) a.play().catch(() => {}) } }} />
        </div>
        <div className="mk-pvc">
          <IconBtn label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>{playing ? <Pause /> : <Play />}</IconBtn>
          <div className="mk-pv-name"><b>{sel.size > 1 ? `${sel.size} selected` : activeSound?.n ?? 'Nothing selected'}</b><span className="mk-dim mono">{sel.size > 1 ? 'Drag them into FL Studio together' : activeSound ? (activeSound.k === 'midi' ? `MIDI · ${activeSound.m ?? ''} notes` : `${fmtLen(activeSound.u)} · ${activeSound.e}`) : 'Click a sound to preview it.'}</span></div>
        </div>
        <ScrollArea className="mk-scroll">
          {activeSound && (
            <div className="mk-insp-body">
              <dl className="mk-kv">
                <dt>Folder</dt><dd title={dirs[activeSound.d]}>{relDir(activeSound.d)}</dd>
                <dt>Length</dt><dd>{activeSound.k === 'midi' ? `${activeSound.m ?? ''} notes` : fmtLen(activeSound.u) || '–'}</dd>
                <dt>BPM</dt><dd>{activeSound.b ? fmtBpm(activeSound.b) : '–'}</dd>
                <dt>Key</dt><dd>{displayKey(activeSound.y) || '–'}</dd>
                <dt>Size</dt><dd>{fmtSize(activeSound.s)}</dd>
              </dl>
              <div className="mk-tagbox">
                <span className="mk-eyebrow">Tags</span>
                <div className="mk-chips">
                  {selTags.map(([t, c]) => <span key={t} className="mk-tag rm">{t}{c < sel.size ? ` (${c})` : ''}<button type="button" aria-label={`Remove tag ${t}`} onClick={async () => { await window.api.soundsTag([...sel], [], [t]); onReload() }}><X /></button></span>)}
                </div>
                <input className="mk-in" value={tagDraft} placeholder="add tag, press Enter" aria-label="Add tag" onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTag() }} />
              </div>
              <div className="mk-row">
                <Button variant="outline" size="sm" onClick={toggleFav}><Heart />{allFav ? 'Favorited' : 'Favorite'}</Button>
                {sel.size === 1 && <Button variant="outline" size="sm" onClick={() => window.api.soundsReveal([...sel][0])}>Reveal</Button>}
              </div>
              <div className="mk-drag" draggable onDragStart={(e) => { e.preventDefault(); window.api.startDrag('sound', ids()) }}>
                <GripVertical aria-hidden="true" /><span><b>Drag into FL Studio</b><small>a row, or this handle onto a channel</small></span>
              </div>
            </div>
          )}
        </ScrollArea>
      </aside>
      {dupes && <DupesDialog roots={roots} onClose={() => setDupes(false)} onDone={(m) => { setDupes(false); toast(m); onReload() }} />}
    </section>
    </TooltipProvider>
  )
}
