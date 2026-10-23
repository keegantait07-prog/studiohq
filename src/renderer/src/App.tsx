import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATUSES, type Beat, type BeatDetail, type ContentData, type CrmData, type FeedbackData, type SoundList, type SoundStatus, type StudioSession, type SalesData, type Sale, type ScanStatus, type Settings as AppSettings, type Status, type TagKind, type NetlifyStatus } from '@shared/types'
import { displayKey } from '@shared/key'
import { parseQuery } from './query'
import { keysCompatible, bpmCompatible } from '@shared/key'
import { usePlayer } from './player'
import { Thumb, Waveform } from './Waveform'
import { artUrl } from './genart'
import { SonicMap } from './SonicMap'
import { Cleanup } from './Cleanup'
import { hotspot, takesOf } from './audition'
import { keyColor } from './keyColor'
import { Detail } from './Detail'
import { Palette, type Command } from './Palette'
import { Settings } from './Settings'
import { Crm } from './Crm'
import { PitchDialog } from './PitchDialog'
import { isDue } from './crmUtils'
import { SalesView } from './Sales'
import { LogSaleDialog } from './LogSaleDialog'
import { SplitsDialog } from './SplitsDialog'
import { errMsg } from './salesUtils'
import { ContentView } from './Content'
import { startOfDay } from './suggest'
import { SoundLibrary } from './SoundLibrary'
import { FeedbackView } from './FeedbackView'
import { FeedbackDialog } from './FeedbackDialog'
import { Dashboard } from './Dashboard'
import { fmtClock } from './dashUtils'
import { ago, fmtBpm, fmtDur } from './format'

interface Row { beat: Beat; count: number }

function rank(b: Beat): number {
  if (b.versionLabel === 'final') return 3e13 + b.mtime
  const v = b.versionLabel.match(/^v(\d+)$/)
  if (v) return 2e13 + +v[1] * 1e11 + b.mtime / 1e3
  if (b.versionLabel === 'stems') return b.mtime - 1e13
  return 1e13 + b.mtime
}

export function App() {
  const [beats, setBeats] = useState<Beat[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [collections, setCollections] = useState<{ name: string; q: string }[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('shq.collections') ?? ''); if (Array.isArray(v)) return v } catch { /* first run */ }
    return [{ name: 'Ready to pitch', q: 'finished, unsent' }, { name: 'Needs info', q: 'needsinfo' }, { name: 'Stale WIPs', q: 'stale' }]
  })
  const [naming, setNaming] = useState<string | null>(null)
  const [whatsNew, setWhatsNew] = useState(() => { try { return localStorage.getItem('shq.seen') !== '2.0' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('shq.collections', JSON.stringify(collections)) } catch { /* private mode */ } }, [collections])
  const openCollection = (q: string) => { setView('vault'); setStatusTab('all'); setQuery(q) }
  const [statusTab, setStatusTab] = useState<Status | 'all'>('all')
  const [collapse, setCollapse] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<BeatDetail | null>(null)
  const [playingDetail, setPlayingDetail] = useState<BeatDetail | null>(null)
  const [allTags, setAllTags] = useState<Record<TagKind, string[]>>({ vibe: [], genre: [], artist: [] })
  const [scan, setScan] = useState<ScanStatus>({ pending: 0, done: 0, total: 0 })
  const [palette, setPalette] = useState(false)
  const [settings, setSettings] = useState(false)
  const [view, setView] = useState<'dashboard' | 'vault' | 'map' | 'crm' | 'sales' | 'content' | 'sounds' | 'feedback'>('dashboard')
  const [crm, setCrm] = useState<CrmData | null>(null)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [netlify, setNetlify] = useState<NetlifyStatus | null>(null)
  const [crmSel, setCrmSel] = useState<number | null>(null)
  const [pitchDlg, setPitchDlg] = useState<{ contactId?: number; beatIds?: number[] } | null>(null)
  const [newContactSignal, setNewContactSignal] = useState(0)
  const [tick, setTick] = useState(0)
  const [salesData, setSalesData] = useState<SalesData>({ sales: [], licenses: [], groups: [] })
  const [saleDlg, setSaleDlg] = useState<{ beatId?: number; edit?: Sale } | null>(null)
  const [splitsDlg, setSplitsDlg] = useState<{ groupId: number; title: string } | null>(null)
  const [salesQuery, setSalesQuery] = useState('')
  const [sounds, setSounds] = useState<SoundList | null>(null)
  const [soundStatus, setSoundStatus] = useState<SoundStatus>({ phase: 'idle', done: 0, total: 0 })
  const [soundQuery, setSoundQuery] = useState('')
  const [soundProject, setSoundProject] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<FeedbackData>({ links: [], comments: [] })
  const [fbDlg, setFbDlg] = useState<{ beatIds?: number[] } | null>(null)
  const [sessions, setSessions] = useState<StudioSession[]>([])
  const [clock, setClock] = useState(Date.now())
  const reloadSounds = useCallback(async () => { setSounds(await window.api.soundsList()) }, [])
  const reloadFeedback = useCallback(async () => { setFeedback(await window.api.feedbackAll()) }, [])
  const reloadSessions = useCallback(async () => { setSessions(await window.api.sessionsAll()) }, [])
  useEffect(() => {
    reloadSounds(); reloadFeedback(); reloadSessions()
    const a = window.api.onSoundsStatus(setSoundStatus)
    const b = window.api.onSoundsChanged(reloadSounds)
    const c = window.api.onFeedbackChanged(() => { reloadFeedback(); reloadSessions() })
    return () => { a(); b(); c() }
  }, [reloadSounds, reloadFeedback, reloadSessions])
  const openSession = sessions.find((x) => x.endedAt == null)
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(t) }, [])
  const unseenFeedback = useMemo(() => feedback.comments.filter((c) => !c.seen).length, [feedback.comments])
  const [content, setContent] = useState<ContentData>({ posts: [], videos: [] })
  const [contentBeat, setContentBeat] = useState<number | null>(null)
  const reloadContent = useCallback(async () => { setContent(await window.api.contentAll()) }, [])
  useEffect(() => { reloadContent() }, [beats, reloadContent])
  const overduePosts = useMemo(() => content.posts.filter((p) => p.status === 'planned' && startOfDay(p.date) < startOfDay(Date.now())).length, [content.posts, tick])
  const [toastMsg, setToastMsg] = useState('')
  const toast = useCallback((m: string) => { setToastMsg(m); setTimeout(() => setToastMsg((cur) => (cur === m ? '' : cur)), 4500) }, [])
  const reloadSales = useCallback(async () => { setSalesData(await window.api.salesAll()) }, [])
  useEffect(() => { reloadSales() }, [beats, reloadSales])
  const search = useRef<HTMLInputElement>(null)
  const player = usePlayer()

  const reload = useCallback(async () => {
    setBeats(await window.api.listBeats())
    setAllTags(await window.api.allTags())
    setLoaded(true)
  }, [])

  useEffect(() => {
    reload()
    let t: ReturnType<typeof setTimeout> | null = null
    const off1 = window.api.onBeatsChanged(() => { if (!t) t = setTimeout(() => { t = null; reload() }, 250) })
    const off2 = window.api.onScanStatus(setScan)
    return () => { off1(); off2() }
  }, [reload])

  const reloadCrm = useCallback(async () => {
    setCrm(await window.api.crmAll())
    setAppSettings(await window.api.getSettings())
    setNetlify(await window.api.netlifyStatus())
  }, [])
  useEffect(() => {
    reloadCrm()
    const off = window.api.onCrmChanged(reloadCrm)
    const offNav = window.api.onNavigate((v) => setView(v))
    const iv = setInterval(() => setTick((t) => t + 1), 60000) // re-evaluate "due" as time passes
    window.addEventListener('focus', reloadCrm)
    return () => { off(); offNav(); clearInterval(iv); window.removeEventListener('focus', reloadCrm) }
  }, [reloadCrm])
  const dueCount = useMemo(() => (crm ? crm.pitches.filter((p) => isDue(p)).length : 0), [crm, tick])
  const pitchedTo = useMemo(() => {
    if (!crm || selectedId == null) return []
    return crm.pitches.filter((p) => p.beats.some((b) => b.beatId === selectedId)).map((p) => ({
      pitch: p, contact: crm.contacts.find((c) => c.id === p.contactId)?.name ?? '?', response: p.beats.find((b) => b.beatId === selectedId)!.response
    }))
  }, [crm, selectedId])

  useEffect(() => {
    if (selectedId == null) return setDetail(null)
    window.api.getBeat(selectedId).then(setDetail)
  }, [selectedId, beats])

  useEffect(() => {
    if (player.id == null) return setPlayingDetail(null)
    window.api.getBeat(player.id).then(setPlayingDetail)
  }, [player.id, beats])

  const parsed = useMemo(() => parseQuery(query), [query])
  const rows: Row[] = useMemo(() => {
    const match = beats.filter((b) => (statusTab === 'all' || b.status === statusTab) && parsed.test(b))
    if (!collapse) return match.map((beat) => ({ beat, count: 1 }))
    const groups = new Map<number, Beat[]>()
    for (const b of match) (groups.get(b.groupId) ?? groups.set(b.groupId, []).get(b.groupId)!).push(b)
    const out: Row[] = []
    for (const g of groups.values()) {
      const primary = g.reduce((a, b) => (rank(b) > rank(a) ? b : a))
      out.push({ beat: primary, count: g.length })
    }
    return out.sort((a, b) => b.beat.mtime - a.beat.mtime)
  }, [beats, parsed, statusTab, collapse])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: beats.length }
    for (const b of beats) c[b.status] = (c[b.status] ?? 0) + 1
    return c
  }, [beats])

  const selectedIdx = rows.findIndex((r) => r.beat.id === selectedId || (collapse && r.beat.groupId === beats.find((b) => b.id === selectedId)?.groupId))
  const move = useCallback((d: number) => {
    if (!rows.length) return
    const i = Math.max(0, Math.min(rows.length - 1, (selectedIdx < 0 ? (d > 0 ? -1 : rows.length) : selectedIdx) + d))
    setSelectedId(rows[i].beat.id)
    document.querySelector(`[data-row="${rows[i].beat.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [rows, selectedIdx])

  const setStatus = async (id: number, s: Status) => { try { await window.api.updateBeat(id, { status: s }) } catch (e) { toast(errMsg(e)) } reload() }
  const hasAudio = useCallback((id: number) => { const b = beats.find((x) => x.id === id); return !!b && (b.ext !== 'flp' || b.hasPreview) }, [beats])
  const safePlay = useCallback((id: number, at?: number) => {
    if (!hasAudio(id)) { toast('This FL project has no audio yet. Put Studio HQ Bridge on the Master and play it once; closing the project keeps a loop to preview.'); return }
    player.play(id, at)
  }, [hasAudio, player, toast])
  const [audition, setAudition] = useState(false)
  const [cleanup, setCleanup] = useState(false)
  // audition mode: picking a beat plays it from its fullest part, so you can flick through the vault like a record bin
  useEffect(() => {
    if (!audition || selectedId == null) return
    const b = beats.find((x) => x.id === selectedId)
    if (b && b.ext !== 'flp') player.play(b.id, hotspot(b) ?? undefined)
  }, [selectedId, audition]) // eslint-disable-line react-hooks/exhaustive-deps
  const flipTake = useCallback(() => {
    if (player.id == null) return
    const takes = takesOf(beats, player.id)
    if (takes.length < 2) return toast('Only one take of this beat. Export another version to A/B them.')
    const i = takes.findIndex((t) => t.id === player.id)
    const next = takes[(i + 1) % takes.length]
    player.play(next.id, player.time)
    toast(`${i === 0 ? 'B' : 'A'}: ${next.versionLabel || next.filename}`)
  }, [beats, player, toast])
  const [reindexing, setReindexing] = useState(false)
  const lastReindex = useRef(0)
  const reindexNow = useCallback(async (loud: boolean) => {
    if (loud === false && Date.now() - lastReindex.current < 60000) return // focus changes are frequent: at most once a minute
    lastReindex.current = Date.now()
    setReindexing(true)
    try {
      const r = await window.api.reindexProjects()
      if (r.added) toast(`Found ${r.added} new FL project${r.added > 1 ? 's' : ''} and added ${r.added > 1 ? 'them' : 'it'} to the Vault`)
      else if (loud) toast('No new FL projects.')
      reload()
    } catch { if (loud) toast('Could not read your FL project folders.') }
    setReindexing(false)
  }, [reload, toast])
  useEffect(() => {
    const t = setTimeout(() => reindexNow(false), 1500) // each time Studio HQ starts
    const onFocus = () => reindexNow(false)
    window.addEventListener('focus', onFocus)
    return () => { clearTimeout(t); window.removeEventListener('focus', onFocus) }
  }, [reindexNow])
  const audioBeats = useMemo(() => beats.filter((b) => b.ext !== 'flp'), [beats])
  const compatible = useMemo(() => {
    const d = detail
    if (!d || !d.key || !d.bpm) return []
    const seen = new Set<number>([d.groupId])
    return audioBeats
      .filter((b) => keysCompatible(d.key, b.key) && bpmCompatible(d.bpm, b.bpm))
      .sort((a, b) => Math.abs(a.bpm! - d.bpm!) - Math.abs(b.bpm! - d.bpm!))
      .filter((b) => (seen.has(b.groupId) ? false : (seen.add(b.groupId), true)))
      .slice(0, 8)
  }, [audioBeats, detail])

  const playBeat = (id: number) => { setSelectedId(id); safePlay(id) }

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return }
      if (mod && e.key === '0') { e.preventDefault(); setView('dashboard'); return }
      if (mod && e.key === '5') { e.preventDefault(); setView('sounds'); return }
      if (mod && e.key === '6') { e.preventDefault(); setView('feedback'); return }
      if (mod && e.key === '1') { e.preventDefault(); setView('vault'); return }
      if (mod && e.key === '2') { e.preventDefault(); setView('crm'); return }
      if (mod && e.key === '3') { e.preventDefault(); setView('sales'); return }
      if (mod && e.key === '4') { e.preventDefault(); setView('content'); return }
      if (mod && e.key === ',') { e.preventDefault(); setSettings(true); return }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); search.current?.focus(); search.current?.select(); return }
      if (e.key === 'Escape') {
        if (palette) return setPalette(false)
        if (settings) return setSettings(false)
        if (typing) { (t as HTMLInputElement).blur(); return }
        if (query) return setQuery('')
      }
      if (typing || palette || settings || pitchDlg || saleDlg || splitsDlg || mod) return
      if (view !== 'vault') return
      if (e.key === '/') { e.preventDefault(); search.current?.focus() }
      else if (e.key === ' ') { e.preventDefault(); player.id == null && selectedId != null ? safePlay(selectedId) : player.toggle() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); player.skip(e.shiftKey ? 15 : 5) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); player.skip(e.shiftKey ? -15 : -5) }
      else if (e.key === 'Enter' && selectedId != null) playBeat(selectedId)
      else if (/^[1-5]$/.test(e.key) && selectedId != null) setStatus(selectedId, STATUSES[+e.key - 1])
      else if (e.key.toLowerCase() === 'g') setCollapse((c) => !c)
      else if (e.key.toLowerCase() === 'a') { setAudition((a) => { toast(a ? 'Audition mode off' : 'Audition mode on. Moving through beats plays each from its fullest part.'); return !a }) }
      else if (e.key.toLowerCase() === 'b') flipTake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const commands: Command[] = [
    { id: 'go-dash', label: 'Go to Dashboard', hint: '⌘0', run: () => setView('dashboard') },
    { id: 'cleanup', label: 'Clean up FL projects…', run: () => setCleanup(true) },
    { id: 'go-map', label: 'Go to Sonic Map', run: () => setView('map') },
    { id: 'audition', label: audition ? 'Turn audition mode off' : 'Turn audition mode on', hint: 'A', run: () => setAudition((a) => !a) },
    { id: 'go-sounds', label: 'Go to Sound Library', hint: '⌘5', run: () => setView('sounds') },
    { id: 'go-feedback', label: 'Go to Feedback', hint: '⌘6', run: () => setView('feedback') },
    { id: 'new-feedback', label: 'New feedback link…', run: () => setFbDlg({}) },
    { id: 'session', label: openSession ? 'Stop studio session' : 'Start studio session', run: async () => { await (openSession ? window.api.stopSession() : window.api.startSession()); reloadSessions() } },
    { id: 'go-vault', label: 'Go to Beat Vault', hint: '⌘1', run: () => setView('vault') },
    { id: 'go-crm', label: 'Go to Pitch CRM', hint: '⌘2', run: () => setView('crm') },
    { id: 'go-sales', label: 'Go to Sales & Collabs', hint: '⌘3', run: () => setView('sales') },
    { id: 'go-content', label: 'Go to Content Machine', hint: '⌘4', run: () => setView('content') },
    { id: 'log-sale', label: 'Log a sale…', run: () => setSaleDlg({}) },
    { id: 'new-pitch', label: 'New pitch…', run: () => setPitchDlg({}) },
    { id: 'new-contact', label: 'New contact…', run: () => { setView('crm'); setNewContactSignal((n) => n + 1) } },
    { id: 'settings', label: 'Open settings (folders, backup)', hint: '⌘,', run: () => setSettings(true) },
    { id: 'group', label: collapse ? 'Show every file (ungroup versions)' : 'Group versions of the same beat', hint: 'G', run: () => setCollapse((c) => !c) },
    { id: 'backup', label: 'Back up database now', run: () => { window.api.backup() } },
    ...STATUSES.map((s) => ({ id: 's-' + s, label: `Filter: ${s}`, run: () => setStatusTab(s) })),
    { id: 'all', label: 'Clear filters', run: () => { setStatusTab('all'); setQuery('') } }
  ]

  const scanning = scan.pending > 0
  return (
    <div className="app">
      <div className="titlebar" />
      <nav className="side">
        <div className="brand">Studio HQ</div>
        <a className={`nav ${view === 'dashboard' ? 'on' : ''}`} onClick={() => setView('dashboard')}>Dashboard</a>
        <a className={`nav ${view === 'vault' ? 'on' : ''}`} onClick={() => setView('vault')}>Beat Vault <span>{beats.length}</span></a>
        <div className="colls">
          {collections.map((c) => (
            <a key={c.name} className={`coll ${view === 'vault' && query === c.q ? 'on' : ''}`} onClick={() => openCollection(c.q)} title={c.q}>
              <span>{c.name}</span><button className="x" aria-label="remove" onClick={(e) => { e.stopPropagation(); setCollections(collections.filter((x) => x !== c)) }}>×</button>
            </a>
          ))}
        </div>
        <a className={`nav ${view === 'map' ? 'on' : ''}`} onClick={() => setView('map')}>Sonic Map <span>◎</span></a>
        <a className={`nav ${view === 'crm' ? 'on' : ''}`} onClick={() => setView('crm')}>Pitch CRM {dueCount > 0 ? <span className="badge">{dueCount}</span> : <span>{crm?.contacts.length ?? 0}</span>}</a>
        <a className={`nav ${view === 'sales' ? 'on' : ''}`} onClick={() => setView('sales')}>Sales & Collabs <span>{salesData.sales.length}</span></a>
        <a className={`nav ${view === 'content' ? 'on' : ''}`} onClick={() => setView('content')}>Content {overduePosts > 0 ? <span className="badge">{overduePosts}</span> : <span>{content.posts.filter((p) => p.status === 'posted').length}</span>}</a>
        <a className={`nav ${view === 'sounds' ? 'on' : ''}`} onClick={() => setView('sounds')}>Sound Library <span>{sounds ? sounds.items.length.toLocaleString() : ''}</span></a>
        <a className={`nav ${view === 'feedback' ? 'on' : ''}`} onClick={() => setView('feedback')}>Feedback {unseenFeedback > 0 ? <span className="badge">{unseenFeedback}</span> : <span>{feedback.links.length}</span>}</a>
        <div className="grow" />
        {openSession && <a className="timerpill" onClick={() => setView('dashboard')} title="Studio session running">● {fmtClock(clock - openSession.startedAt)}</a>}
        <button className="ghost" onClick={() => setSettings(true)}>Settings <kbd>⌘,</kbd></button>
      </nav>

      {view === 'dashboard' ? (
        <Dashboard
          beats={beats} crm={crm} content={content} sales={salesData} feedback={feedback} sessions={sessions} settings={appSettings} now={clock}
          onGo={setView} onQuery={openCollection} onOpenBeat={(id) => { setView('vault'); setStatusTab('all'); setQuery(''); setSelectedId(id) }}
          onOpenContact={(id) => { setCrmSel(id); setView('crm') }} onPitchBeat={(id) => setPitchDlg({ beatIds: [id] })}
          onMakeVideo={(id) => { setContentBeat(id); setView('content') }} onSetStatus={setStatus} reloadSessions={reloadSessions}
        />
      ) : view === 'map' ? (
        <SonicMap beats={beats} onQuery={openCollection} onPlay={(id) => { setSelectedId(id); safePlay(id) }} onOpen={(id) => { setView('vault'); setStatusTab('all'); setQuery(''); setSelectedId(id) }} />
      ) : view === 'sounds' ? (
        <SoundLibrary data={sounds} roots={appSettings?.soundFolders ?? []} status={soundStatus} query={soundQuery} onQuery={setSoundQuery} projectSel={soundProject} onProjectSel={setSoundProject} onReload={reloadSounds} onPauseMain={() => { if (player.playing) player.toggle() }} toast={toast} />
      ) : view === 'feedback' ? (
        <FeedbackView data={feedback} beats={audioBeats} onNew={() => setFbDlg({})} onPlayAt={(id, at) => safePlay(id, at)} reload={reloadFeedback} toast={toast} />
      ) : view === 'content' ? (
        <ContentView
          beats={audioBeats} sales={salesData.sales} content={content} settings={appSettings} beatId={contentBeat} onSelectBeat={setContentBeat}
          onPlayAt={(id, at) => safePlay(id, at)} reload={reloadContent} reloadBeats={reload} toast={toast}
        />
      ) : view === 'sales' ? (
        <SalesView
          data={salesData} query={salesQuery} onQuery={setSalesQuery} onLog={() => setSaleDlg({})} onEdit={(sale) => setSaleDlg({ edit: sale })}
          onSplits={setSplitsDlg} reload={() => { reload(); reloadSales() }} toast={toast}
          onSheet={async (gid) => { try { const f = await window.api.exportSplitSheet(gid); if (f) toast(`Split sheet saved: ${f.split('/').pop()}`); reloadSales() } catch (e) { toast(errMsg(e)) } }}
          onOpenBeat={(id) => { setView('vault'); setStatusTab('all'); setQuery(''); setSelectedId(id) }}
        />
      ) : view === 'crm' && crm ? (
        <Crm
          crm={crm} myName={appSettings?.producerName ?? ''} selected={crmSel} onSelect={setCrmSel} onPitch={(id) => setPitchDlg({ contactId: id })}
          onOpenBeat={(id) => { setView('vault'); setStatusTab('all'); setQuery(''); setSelectedId(id) }} reload={reloadCrm} newContactSignal={newContactSignal}
        />
      ) : (<>
      <main className="main">
        <header className="toolbar">
          <div className="searchbox">
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: dark, 140+ bpm, unsold, finished, Cm…   ( / )" spellCheck={false} />
            {query && <button onClick={() => setQuery('')}>×</button>}
          </div>
          <button className="ghost" onClick={() => setPalette(true)}>Search everything <kbd>⌘K</kbd></button>
        </header>
        <div className="subbar">
          <div className="tabs">
            {(['all', ...STATUSES] as const).map((s) => (
              <button key={s} className={`tab ${statusTab === s ? 'on' : ''}`} onClick={() => setStatusTab(s)}>{s} <span>{counts[s] ?? 0}</span></button>
            ))}
          </div>
          <div className="chips-inline">{parsed.chips.map((c, i) => <span key={i} className="qchip">{c}</span>)}</div>
          {query.trim() && !collections.some((c) => c.q === query) && (naming == null
            ? <button className="ghost" onClick={() => setNaming(query.length > 24 ? '' : query)} title="Keep this search in the sidebar">Save search</button>
            : <span className="savesearch"><input autoFocus value={naming} placeholder="Name it" onChange={(e) => setNaming(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && naming.trim()) { setCollections([...collections, { name: naming.trim(), q: query }]); setNaming(null) } if (e.key === 'Escape') setNaming(null) }} />
              <button className="primary" disabled={!naming.trim()} onClick={() => { setCollections([...collections, { name: naming.trim(), q: query }]); setNaming(null) }}>Save</button></span>)}
          <button className="ghost" onClick={() => setCleanup(true)} title="Sift through FL projects and move the ones you don't want to the Trash">Clean up projects…</button>
          <button className="ghost" disabled={reindexing} onClick={() => reindexNow(true)} title="Look for new FL Studio projects now">{reindexing ? 'Scanning…' : 'Rescan FL projects'}</button>
          <label className="check small"><input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} /> Group versions</label>
        </div>

        <div className="table">
          <div className="thead">
            <span /><span>Beat</span><span>Tags</span><span className="r">BPM</span><span>Key</span><span className="r">Length</span><span>Status</span><span className="r">Added</span>
          </div>
          <div className="tbody">
            {rows.map(({ beat: b, count }) => {
              const sel = b.id === selectedId || (collapse && selectedIdx >= 0 && rows[selectedIdx]?.beat.id === b.id)
              const isPlaying = player.id === b.id && player.playing
              return (
                <div key={b.id} data-row={b.id} className={`row ${sel ? 'sel' : ''}`} onClick={() => setSelectedId(b.id)} onDoubleClick={() => playBeat(b.id)}>
                  <button className={`play ${isPlaying ? 'on' : ''} ${b.ext === 'flp' && !b.hasPreview ? 'off' : ''}`} onClick={(e) => { e.stopPropagation(); if (b.ext === 'flp' && !b.hasPreview) return toast('FL project with no preview yet. Play it once with Studio HQ Bridge on the Master and close it.'); player.id === b.id ? player.toggle() : playBeat(b.id) }} aria-label="play">{isPlaying ? '❚❚' : b.ext === 'flp' && !b.hasPreview ? '–' : '▶'}</button>
                  <div className="name">
                    <img className="arttile" alt="" src={artUrl({ seed: `g${b.groupId}`, peaks: b.thumb, key: b.key, bpm: b.bpm })} />
                    {b.ext === 'flp' ? <span className="projthumb" title={b.hasPreview ? 'FL Studio project, preview loop' : 'FL Studio project, no audio yet'}>{b.hasPreview ? 'FL loop' : 'FL project'}</span> : <Thumb data={b.thumb} />}
                    <div className="nt">
                      <div className="t">{b.title}{count > 1 && <em className="ver-badge">{count} versions</em>}{!collapse && b.versionLabel && <em className="ver-badge">{b.versionLabel}</em>}</div>
                      {b.credits && <div className="sub">{b.credits}</div>}
                    </div>
                  </div>
                  <div className="tg">{[...b.tags.genre.map((t) => ['genre', t]), ...b.tags.vibe.map((t) => ['vibe', t]), ...b.tags.artist.map((t) => ['artist', t])].slice(0, 4).map(([k, t]) => <span key={k + t} className={`chip ${k}`}>{t}</span>)}</div>
                  <span className={`r mono ${b.bpmConfidence === 'low' ? 'warn' : ''}`} title={b.bpmConfidence === 'low' ? 'Low confidence. Check half/double time.' : ''}>{fmtBpm(b.bpm)}{!b.analyzed && b.bpm == null ? '…' : ''}</span>
                  <span className="mono keycell" style={b.key ? { color: keyColor(b.key) } : undefined}>{b.key && <i className="kdotc" style={{ background: keyColor(b.key) }} />}{displayKey(b.key) || (b.analyzed ? '–' : '…')}</span>
                  <span className="r mono dim">{fmtDur(b.duration)}</span>
                  <span><i className={`dot st-${b.status}`} />{b.status}</span>
                  <span className="r dim">{ago(b.mtime)}</span>
                </div>
              )
            })}
            {loaded && !rows.length && (
              <div className="empty">
                {beats.length === 0 ? (scanning ? 'Importing your beats…' : <>No beats yet. Add a folder in <a onClick={() => setSettings(true)}>Settings</a>.</>) : 'No beats match.'}
              </div>
            )}
          </div>
        </div>
      </main>

      {detail ? (
        <Detail beat={detail} allTags={allTags} onSelect={setSelectedId} onPlay={playBeat} refresh={reload} pitchedTo={pitchedTo} onPitch={() => setPitchDlg({ beatIds: [detail.id] })} onOpenContact={(id) => { setCrmSel(id); setView('crm') }}
          sales={salesData.sales.filter((x) => x.groupId === detail.groupId)} splitGroup={salesData.groups.find((g) => g.groupId === detail.groupId)}
          onLogSale={() => setSaleDlg({ beatId: detail.id })} onEditSplits={() => setSplitsDlg({ groupId: detail.groupId, title: detail.title })}
          onSheet={async () => { try { const f = await window.api.exportSplitSheet(detail.groupId); if (f) toast(`Split sheet saved: ${f.split('/').pop()}`); reloadSales() } catch (e) { toast(errMsg(e)) } }}
          projectSection={sounds?.projects.find((x) => x.path === detail.projectPath) ?? null} onProjectSounds={(id) => { setSoundProject(id); setView('sounds') }}
          compatible={compatible} onFeedback={() => setFbDlg({ beatIds: [detail.id] })} posts={content.posts.filter((x) => x.beatId === detail.id)} onContent={() => { setContentBeat(detail.id); setView('content') }}
          onError={toast} />
      ) : (
        <aside className="detail empty-detail"><p>Select a beat</p><p className="dim">↑ ↓ to move · Space to play · 1–5 sets status</p></aside>
      )}
      </>)}

      <footer className="player">
        <button className="big-play" onClick={() => (player.id == null && selectedId != null ? safePlay(selectedId) : player.toggle())}>{player.playing ? '❚❚' : '▶'}</button>
        <div className="now">
          <div className="t">{playingDetail?.title ?? 'Nothing playing'}</div>
          <div className="sub mono">{fmtDur(player.time)} / {fmtDur(player.duration || playingDetail?.duration || null)}</div>
        </div>
        <div className="wavewrap">
          <Waveform peaks={playingDetail?.peaks ?? []} progress={player.duration ? player.time / player.duration : 0} onSeek={(f) => player.duration && player.seek(f * player.duration)} />
        </div>
        <div className="pchips">
          <button className={`pchip2 ${audition ? 'on' : ''}`} onClick={() => setAudition((a) => !a)} title="Audition mode (A): play beats from their fullest part as you move through them">Audition</button>
          <button className="pchip2" onClick={flipTake} disabled={player.id == null || takesOf(beats, player.id).length < 2} title="A/B the takes of this beat at the same moment (B)">A/B</button>
        </div>
        {scanning && <div className="scan">Analyzing {scan.total - scan.pending}/{scan.total}<div className="bar"><div style={{ width: `${((scan.total - scan.pending) / Math.max(1, scan.total)) * 100}%` }} /></div></div>}
      </footer>

      {palette && <Palette beats={beats} contacts={crm?.contacts ?? []} sales={salesData.sales} sounds={sounds?.items ?? []} onPickSound={(x) => { setSoundQuery(x.n); setView('sounds') }} onPickSale={(sale) => { setSalesQuery(sale.beatTitle); setView('sales') }} commands={commands} onPickBeat={(b) => { setView('vault'); playBeat(b.id) }} onPickContact={(c) => { setCrmSel(c.id); setView('crm') }} onClose={() => setPalette(false)} />}
      {whatsNew && (
        <div className="overlay" onClick={() => { try { localStorage.setItem('shq.seen', '2.0') } catch { /* ok */ } setWhatsNew(false) }}>
          <div className="modal whatsnew" onClick={(e) => e.stopPropagation()}>
            <header><h2>Studio HQ 2.0</h2></header>
            <ul>
              <li><b>Save to Studio HQ from FL.</b> One click in the plugin adds the project as a beat. No recording.</li>
              <li><b>Preview loops.</b> Beats you never exported keep a 4-bar loop, saved when you close the project.</li>
              <li><b>MP3-only bounces.</b> Recordings are converted to MP3 and the WAV is removed.</li>
              <li><b>Smart collections.</b> Save any search to the sidebar: “Ready to pitch”, “Needs info”, “Stale WIPs” are there already.</li>
              <li><b>Plays well with.</b> Camelot key codes, and beats that mix with the one you have open.</li>
              <li><b>Catalog health.</b> The dashboard shows what is missing a BPM, key or tags, and jumps you to it.</li>
              <li><b>CSV export.</b> Settings → Export beats and sales.</li>
              <li><b>New look</b> for the app and the plugin.</li>
            </ul>
            <button className="primary" onClick={() => { try { localStorage.setItem('shq.seen', '2.0') } catch { /* ok */ } setWhatsNew(false) }}>Let’s go</button>
          </div>
        </div>
      )}
      {cleanup && <Cleanup onClose={() => setCleanup(false)} onChanged={() => { reload(); reloadSounds() }} />}
      {settings && <Settings onClose={() => { setSettings(false); reload(); reloadCrm() }} />}
      {fbDlg && (
        <FeedbackDialog beats={audioBeats} initial={fbDlg.beatIds} hasToken={!!netlify?.hasToken} onClose={() => { setFbDlg(null); reloadFeedback() }} onBuilt={() => { reloadFeedback(); setView('feedback') }} />
      )}
      {saleDlg && crm && (
        <LogSaleDialog
          beats={audioBeats} sales={salesData.sales} licenses={salesData.licenses} contacts={crm.contacts} beatId={saleDlg.beatId} edit={saleDlg.edit}
          onClose={() => setSaleDlg(null)} onSaved={(m) => { setSaleDlg(null); toast(m); reload(); reloadSales(); reloadCrm() }}
        />
      )}
      {splitsDlg && (
        <SplitsDialog groupId={splitsDlg.groupId} title={splitsDlg.title} producerName={appSettings?.producerName ?? ''} onClose={() => setSplitsDlg(null)} onDone={(m) => { setSplitsDlg(null); toast(m); reloadSales() }} />
      )}
      {toastMsg && <div className="toast" onClick={() => setToastMsg('')}>{toastMsg}</div>}
      {pitchDlg && crm && (
        <PitchDialog
          beats={audioBeats} crm={crm} myName={appSettings?.producerName ?? ''} hasToken={!!netlify?.hasToken} contactId={pitchDlg.contactId} beatIds={pitchDlg.beatIds}
          onClose={() => setPitchDlg(null)}
          onLogged={(cid) => { setPitchDlg(null); setCrmSel(cid); setView('crm'); reloadCrm(); reload() }}
        />
      )}
    </div>
  )
}
