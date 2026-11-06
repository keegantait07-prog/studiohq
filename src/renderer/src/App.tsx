import { lazy, useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { STATUSES, type Beat, type BeatDetail, type ContentData, type CrmData, type FeedbackData, type SoundList, type SoundStatus, type StudioSession, type SalesData, type Sale, type ScanStatus, type Settings as AppSettings, type Status, type TagKind, type NetlifyStatus, type VaultKind } from '@shared/types'
import { clickable } from './a11y'
import { ViewGuard } from './ViewGuard'
import { useNow } from './useNow'
import { displayKey } from '@shared/key'
import { parseQuery } from './query'
import { keysCompatible, bpmCompatible } from '@shared/key'
import { usePlayer, usePlayerTime, type PlayerClock } from './player'
import { Thumb, Waveform } from './Waveform'
import { artUrl } from './genart'
const SonicMap = lazy(() => import('./SonicMap').then((m) => ({ default: m.SonicMap })))
import { Cleanup } from './Cleanup'
import { hotspot, takesOf } from './audition'
import { keyColor } from './keyColor'
import { Detail } from './Detail'
import { Palette, type Command } from './Palette'
import { Assistant, type AssistantStatus } from './Assistant'
import { Settings } from './Settings'
import { Crm } from './Crm'
import { PitchDialog } from './PitchDialog'
import { isDue } from './crmUtils'
import { SalesView } from './Sales'
import { LogSaleDialog } from './LogSaleDialog'
import { SplitsDialog } from './SplitsDialog'
import { errMsg } from './salesUtils'
const ContentView = lazy(() => import('./Content').then((m) => ({ default: m.ContentView })))
import { startOfDay } from './suggest'
const SoundLibrary = lazy(() => import('./SoundLibrary').then((m) => ({ default: m.SoundLibrary })))
import { groupRows, type GroupBy } from '@shared/loopGroups'
const KitMaker = lazy(() => import('./KitMaker').then((m) => ({ default: m.KitMaker })))
const Plugins = lazy(() => import('./Plugins').then((m) => ({ default: m.Plugins })))
import { FeedbackView } from './FeedbackView'
import { FeedbackDialog } from './FeedbackDialog'
import { Dashboard } from './Dashboard'
const ThemesView = lazy(() => import('./ThemesView').then((m) => ({ default: m.ThemesView })))
import { BrandMark, Defs, Icon } from './Icons'
import { THEMES, applyTheme, getTheme } from './themes'
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

/** The "0:12 / 3:04" readout. It alone re-renders as the playhead moves. */
function PlayerReadout({ player, fallbackDuration }: { player: PlayerClock & { duration: number }; fallbackDuration: number | null }) {
  const time = usePlayerTime(player)
  return <div className="sub mono">{fmtDur(time)} / {fmtDur(player.duration || fallbackDuration || null)}</div>
}

/** The waveform with its moving progress line. */
function PlayerWave({ player, peaks }: { player: PlayerClock & { duration: number; seek: (t: number) => void }; peaks: number[] }) {
  const time = usePlayerTime(player)
  return <Waveform peaks={peaks} progress={player.duration ? time / player.duration : 0} onSeek={(f) => player.duration && player.seek(f * player.duration)} />
}

/** The running-session timer in the sidebar. It owns the 1-second tick, so the rest of the app does not re-render every second. */
function SessionPill({ startedAt, onClick }: { startedAt: number; onClick: () => void }) {
  const now = useNow(1000)
  return <a className="timerpill" {...clickable(onClick)} title="Studio session running">● {fmtClock(now - startedAt)}</a>
}

export function App() {
  const [beats, setBeats] = useState<Beat[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<'dashboard' | 'vault' | 'loops' | 'map' | 'crm' | 'sales' | 'content' | 'sounds' | 'kits' | 'plugins' | 'feedback' | 'themes'>('dashboard')
  // the Beat Vault and the Loop Vault each keep their own search, status tab and selection
  const vaultKind: VaultKind = view === 'loops' ? 'loop' : 'beat'
  const isLoop = vaultKind === 'loop'
  const [queries, setQueries] = useState<Record<VaultKind, string>>({ beat: '', loop: '' })
  const [tabs, setTabs] = useState<Record<VaultKind, Status | 'all'>>({ beat: 'all', loop: 'all' })
  const [selectedIds, setSelectedIds] = useState<Record<VaultKind, number | null>>({ beat: null, loop: null })
  const query = queries[vaultKind]
  const statusTab = tabs[vaultKind]
  const selectedId = selectedIds[vaultKind]
  const setQuery = useCallback((q: string) => setQueries((o) => ({ ...o, [vaultKind]: q })), [vaultKind])
  const setStatusTab = useCallback((t: Status | 'all') => setTabs((o) => ({ ...o, [vaultKind]: t })), [vaultKind])
  const setSelectedId = useCallback((id: number | null) => setSelectedIds((o) => ({ ...o, [vaultKind]: id })), [vaultKind])
  const [loops, setLoops] = useState<Beat[]>([])
  const [loopTags, setLoopTags] = useState<Record<TagKind, string[]>>({ vibe: [], genre: [], artist: [] })
  const [loopCollections, setLoopCollections] = useState<{ name: string; q: string }[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('shq.loopCollections') ?? ''); if (Array.isArray(v)) return v } catch { /* first run */ }
    return [{ name: 'Ready to send', q: 'finished, unsent' }, { name: 'Needs info', q: 'needsinfo' }]
  })
  useEffect(() => { try { localStorage.setItem('shq.loopCollections', JSON.stringify(loopCollections)) } catch { /* private mode */ } }, [loopCollections])
  const [collections, setCollections] = useState<{ name: string; q: string }[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('shq.collections') ?? ''); if (Array.isArray(v)) return v } catch { /* first run */ }
    return [{ name: 'Ready to pitch', q: 'finished, unsent' }, { name: 'Needs info', q: 'needsinfo' }, { name: 'Stale WIPs', q: 'stale' }]
  })
  const [naming, setNaming] = useState<string | null>(null)
  const [whatsNew, setWhatsNew] = useState(() => { try { return localStorage.getItem('shq.seen') !== '2.0' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('shq.collections', JSON.stringify(collections)) } catch { /* private mode */ } }, [collections])
  const openCollection = (q: string) => { setView('vault'); setTabs((o) => ({ ...o, beat: 'all' })); setQueries((o) => ({ ...o, beat: q })) }
  const openLoopCollection = (q: string) => { setView('loops'); setTabs((o) => ({ ...o, loop: 'all' })); setQueries((o) => ({ ...o, loop: q })) }
  const colls = isLoop ? loopCollections : collections
  const setColls = isLoop ? setLoopCollections : setCollections
  const [collapse, setCollapse] = useState(true)
  // Loop Vault sections: how the list is grouped and which sections are folded shut (both remembered)
  const [groupBy, setGroupBy] = useState<GroupBy>(() => { try { const v = localStorage.getItem('shq.loopGroupBy'); return v === 'folder' || v === 'bpm' || v === 'key' || v === 'none' ? v : 'folder' } catch { return 'folder' } })
  const [shut, setShut] = useState<Set<string>>(() => { try { return new Set<string>(JSON.parse(localStorage.getItem('shq.loopShut') ?? '[]')) } catch { return new Set<string>() } })
  useEffect(() => { try { localStorage.setItem('shq.loopGroupBy', groupBy) } catch { /* private window */ } }, [groupBy])
  useEffect(() => { try { localStorage.setItem('shq.loopShut', JSON.stringify([...shut])) } catch { /* private window */ } }, [shut])
  const [detail, setDetail] = useState<BeatDetail | null>(null)
  const [playingDetail, setPlayingDetail] = useState<BeatDetail | null>(null)
  const [allTags, setAllTags] = useState<Record<TagKind, string[]>>({ vibe: [], genre: [], artist: [] })
  const [scan, setScan] = useState<ScanStatus>({ pending: 0, done: 0, total: 0 })
  const [palette, setPalette] = useState(false)
  const [settings, setSettings] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantMounted, setAssistantMounted] = useState(false)
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus>('idle')
  useEffect(() => { if (assistantOpen) setAssistantMounted(true) }, [assistantOpen])
  const [theme, setTheme] = useState(getTheme)
  const pickTheme = useCallback((id: string) => { applyTheme(id); setTheme(id) }, [])
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
  useEffect(() => { document.documentElement.toggleAttribute('data-playing', player.playing) }, [player.playing])

  const reload = useCallback(async () => {
    setBeats(await window.api.listBeats())
    setLoops(await window.api.listLoops())
    setAllTags(await window.api.allTags('beat'))
    setLoopTags(await window.api.allTags('loop'))
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
  }, [selectedId, beats, loops])

  useEffect(() => {
    if (player.id == null) return setPlayingDetail(null)
    window.api.getBeat(player.id).then(setPlayingDetail)
  }, [player.id, beats, loops])

  const parsed = useMemo(() => parseQuery(query), [query])
  const list = isLoop ? loops : beats
  const everything = useMemo(() => beats.concat(loops), [beats, loops])
  const rows: Row[] = useMemo(() => {
    const match = list.filter((b) => (statusTab === 'all' || b.status === statusTab) && parsed.test(b))
    if (!collapse) return match.map((beat) => ({ beat, count: 1 }))
    const groups = new Map<number, Beat[]>()
    for (const b of match) (groups.get(b.groupId) ?? groups.set(b.groupId, []).get(b.groupId)!).push(b)
    const out: Row[] = []
    for (const g of groups.values()) {
      const primary = g.reduce((a, b) => (rank(b) > rank(a) ? b : a))
      out.push({ beat: primary, count: g.length })
    }
    return out.sort((a, b) => b.beat.mtime - a.beat.mtime)
  }, [list, parsed, statusTab, collapse])

  const grouped = isLoop && groupBy !== 'none'
  const sections = useMemo(() => (isLoop ? groupRows(rows, groupBy, appSettings?.loopFolders ?? []) : [{ key: 'all', label: '', rows }]), [isLoop, rows, groupBy, appSettings?.loopFolders])
  const secId = (k: string) => `${groupBy}|${k}`
  const isShut = (k: string) => grouped && shut.has(secId(k))
  // what you can actually see and move through: rows inside a folded section are skipped
  const navRows = useMemo(() => sections.flatMap((s) => (grouped && shut.has(`${groupBy}|${s.key}`) ? [] : s.rows)), [sections, shut, groupBy, grouped])
  const toggleSec = (k: string) => setShut((s) => { const n = new Set(s); const id = secId(k); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const setAllSecs = (fold: boolean) => setShut((s) => { const n = new Set(s); for (const sec of sections) { if (fold) n.add(secId(sec.key)); else n.delete(secId(sec.key)) } return n })

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: list.length }
    for (const b of list) c[b.status] = (c[b.status] ?? 0) + 1
    return c
  }, [list])

  const selectedIdx = rows.findIndex((r) => r.beat.id === selectedId || (collapse && r.beat.groupId === list.find((b) => b.id === selectedId)?.groupId))
  const move = useCallback((d: number) => {
    if (!navRows.length) return
    const at = navRows.findIndex((r) => r.beat.id === selectedId || (collapse && r.beat.groupId === list.find((b) => b.id === selectedId)?.groupId))
    const i = Math.max(0, Math.min(navRows.length - 1, (at < 0 ? (d > 0 ? -1 : navRows.length) : at) + d))
    setSelectedId(navRows[i].beat.id)
    document.querySelector(`[data-row="${navRows[i].beat.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [navRows, selectedId, collapse, list])

  const setStatus = async (id: number, s: Status) => { try { await window.api.updateBeat(id, { status: s }) } catch (e) { toast(errMsg(e)) } reload() }
  const hasAudio = useCallback((id: number) => { const b = everything.find((x) => x.id === id); return !!b && (b.ext !== 'flp' || b.hasPreview) }, [everything])
  const safePlay = useCallback((id: number, at?: number) => {
    if (!hasAudio(id)) { toast('This FL project has no audio yet. Put Studio HQ Bridge on the Master and play it once; closing the project keeps a loop to preview.'); return }
    player.play(id, at)
  }, [hasAudio, player, toast])
  const [audition, setAudition] = useState(false)
  const [cleanup, setCleanup] = useState(false)
  // audition mode: picking a beat plays it from its fullest part, so you can flick through the vault like a record bin
  useEffect(() => {
    if (!audition || selectedId == null) return
    const b = list.find((x) => x.id === selectedId)
    if (b && b.ext !== 'flp') player.play(b.id, hotspot(b) ?? undefined)
  }, [selectedId, audition]) // eslint-disable-line react-hooks/exhaustive-deps
  const flipTake = useCallback(() => {
    if (player.id == null) return
    const takes = takesOf(everything, player.id)
    if (takes.length < 2) return toast(`Only one take of this ${isLoop ? 'loop' : 'beat'}. Export another version to A/B them.`)
    const i = takes.findIndex((t) => t.id === player.id)
    const next = takes[(i + 1) % takes.length]
    player.play(next.id, player.getTime())
    toast(`${i === 0 ? 'B' : 'A'}: ${next.versionLabel || next.filename}`)
  }, [everything, player, toast, isLoop])
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
  const audioLoops = useMemo(() => loops.filter((b) => b.ext !== 'flp'), [loops])
  const audioList = isLoop ? audioLoops : audioBeats
  const compatible = useMemo(() => {
    const d = detail
    if (!d || !d.key || !d.bpm) return []
    const seen = new Set<number>([d.groupId])
    return audioList
      .filter((b) => keysCompatible(d.key, b.key) && bpmCompatible(d.bpm, b.bpm))
      .sort((a, b) => Math.abs(a.bpm! - d.bpm!) - Math.abs(b.bpm! - d.bpm!))
      .filter((b) => (seen.has(b.groupId) ? false : (seen.add(b.groupId), true)))
      .slice(0, 8)
  }, [audioList, detail])

  const playBeat = (id: number) => { setSelectedId(id); safePlay(id) }
  /** Jump to an item in whichever vault holds it, clearing that vault's filters so it is visible. */
  const openItem = (id: number, play = false) => {
    const k: VaultKind = loops.some((l) => l.id === id) ? 'loop' : 'beat'
    setView(k === 'loop' ? 'loops' : 'vault')
    setTabs((o) => ({ ...o, [k]: 'all' })); setQueries((o) => ({ ...o, [k]: '' })); setSelectedIds((o) => ({ ...o, [k]: id }))
    if (play) safePlay(id)
  }

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
      if (mod && e.key === '7') { e.preventDefault(); setView('themes'); return }
      if (mod && e.key === '8') { e.preventDefault(); setView('loops'); return }
      if (mod && e.key === '1') { e.preventDefault(); setView('vault'); return }
      if (mod && e.key === '2') { e.preventDefault(); setView('crm'); return }
      if (mod && e.key === '3') { e.preventDefault(); setView('sales'); return }
      if (mod && e.key === '4') { e.preventDefault(); setView('content'); return }
      if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); setAssistantOpen((o) => !o); return }
      if (mod && e.key === ',') { e.preventDefault(); setSettings(true); return }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); search.current?.focus(); search.current?.select(); return }
      if (e.key === 'Escape') {
        if (palette) return setPalette(false)
        if (settings) return setSettings(false)
        if (assistantOpen && !e.isComposing) return setAssistantOpen(false)
        if (typing) { (t as HTMLInputElement).blur(); return }
        if (query) return setQuery('')
      }
      if (typing || palette || settings || pitchDlg || saleDlg || splitsDlg || mod) return
      if (view !== 'vault' && view !== 'loops') return
      if (e.key === '/') { e.preventDefault(); search.current?.focus() }
      else if (e.key === ' ') { e.preventDefault(); player.id == null && selectedId != null ? safePlay(selectedId) : player.toggle() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); player.skip(e.shiftKey ? 15 : 5) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); player.skip(e.shiftKey ? -15 : -5) }
      else if (e.key === 'Enter' && selectedId != null) playBeat(selectedId)
      else if (/^[1-5]$/.test(e.key) && selectedId != null) setStatus(selectedId, STATUSES[+e.key - 1])
      else if (e.key.toLowerCase() === 'g') setCollapse((c) => !c)
      else if (e.key.toLowerCase() === 'a') { setAudition((a) => { toast(a ? 'Audition mode off' : `Audition mode on. Moving through ${isLoop ? 'loops' : 'beats'} plays each from its fullest part.`); return !a }) }
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
    { id: 'go-themes', label: 'Go to Themes', hint: '⌘7', run: () => setView('themes') },
    ...THEMES.map((t) => ({ id: 'theme-' + t.id, label: `Theme: ${t.name}`, run: () => pickTheme(t.id) })),
    { id: 'go-feedback', label: 'Go to Feedback', hint: '⌘6', run: () => setView('feedback') },
    { id: 'new-feedback', label: 'New feedback link…', run: () => setFbDlg({}) },
    { id: 'session', label: openSession ? 'Stop studio session' : 'Start studio session', run: async () => { await (openSession ? window.api.stopSession() : window.api.startSession()); reloadSessions() } },
    { id: 'go-vault', label: 'Go to Beat Vault', hint: '⌘1', run: () => setView('vault') },
    { id: 'go-loops', label: 'Go to Loop Vault', hint: '⌘8', run: () => setView('loops') },
    { id: 'go-crm', label: 'Go to Pitch CRM', hint: '⌘2', run: () => setView('crm') },
    { id: 'go-sales', label: 'Go to Sales & Collabs', hint: '⌘3', run: () => setView('sales') },
    { id: 'go-content', label: 'Go to Content Machine', hint: '⌘4', run: () => setView('content') },
    { id: 'log-sale', label: 'Log a sale…', run: () => setSaleDlg({}) },
    { id: 'new-pitch', label: 'New pitch…', run: () => setPitchDlg({}) },
    { id: 'new-contact', label: 'New contact…', run: () => { setView('crm'); setNewContactSignal((n) => n + 1) } },
    { id: 'assistant', label: 'Open Studio Assistant', hint: '⌘J', run: () => setAssistantOpen(true) },
    { id: 'settings', label: 'Open settings (folders, backup)', hint: '⌘,', run: () => setSettings(true) },
    { id: 'group', label: collapse ? 'Show every file (ungroup versions)' : `Group versions of the same ${isLoop ? 'loop' : 'beat'}`, hint: 'G', run: () => setCollapse((c) => !c) },
    { id: 'backup', label: 'Back up database now', run: () => { window.api.backup() } },
    ...STATUSES.map((s) => ({ id: 's-' + s, label: `Filter: ${s}`, run: () => setStatusTab(s) })),
    { id: 'all', label: 'Clear filters', run: () => { setStatusTab('all'); setQuery('') } }
  ]

  const scanning = scan.pending > 0
  return (
    <div className="app">
      <Defs />
      <div className="titlebar" />
      <nav className="side">
        <div className="brand"><BrandMark /><span>Studio HQ</span></div>
        <a className={`nav ${view === 'dashboard' ? 'on' : ''}`} {...clickable(() => setView('dashboard'))}><em className="nl"><Icon name="dashboard" />Dashboard</em></a>
        <a className={`nav ${view === 'vault' ? 'on' : ''}`} {...clickable(() => setView('vault'))}><em className="nl"><Icon name="vault" />Beat Vault</em> <span>{beats.length}</span></a>
        <div className="colls">
          {collections.map((c) => (
            <a key={c.name} className={`coll ${view === 'vault' && queries.beat === c.q ? 'on' : ''}`} {...clickable(() => openCollection(c.q))} title={c.q}>
              <span>{c.name}</span><button className="x" aria-label="remove" onClick={(e) => { e.stopPropagation(); setCollections(collections.filter((x) => x !== c)) }}>×</button>
            </a>
          ))}
        </div>
        <a className={`nav ${view === 'loops' ? 'on' : ''}`} {...clickable(() => setView('loops'))}><em className="nl"><Icon name="loops" />Loop Vault</em> <span>{loops.length}</span></a>
        <div className="colls">
          {loopCollections.map((c) => (
            <a key={c.name} className={`coll ${view === 'loops' && queries.loop === c.q ? 'on' : ''}`} {...clickable(() => openLoopCollection(c.q))} title={c.q}>
              <span>{c.name}</span><button className="x" aria-label="remove" onClick={(e) => { e.stopPropagation(); setLoopCollections(loopCollections.filter((x) => x !== c)) }}>×</button>
            </a>
          ))}
        </div>
        <a className={`nav ${view === 'map' ? 'on' : ''}`} {...clickable(() => setView('map'))}><em className="nl"><Icon name="map" />Sonic Map</em> <span>◎</span></a>
        <a className={`nav ${view === 'crm' ? 'on' : ''}`} {...clickable(() => setView('crm'))}><em className="nl"><Icon name="crm" />Pitch CRM</em> {dueCount > 0 ? <span className="badge">{dueCount}</span> : <span>{crm?.contacts.length ?? 0}</span>}</a>
        <a className={`nav ${view === 'sales' ? 'on' : ''}`} {...clickable(() => setView('sales'))}><em className="nl"><Icon name="sales" />Sales & Collabs</em> <span>{salesData.sales.length}</span></a>
        <a className={`nav ${view === 'content' ? 'on' : ''}`} {...clickable(() => setView('content'))}><em className="nl"><Icon name="content" />Content</em> {overduePosts > 0 ? <span className="badge">{overduePosts}</span> : <span>{content.posts.filter((p) => p.status === 'posted').length}</span>}</a>
        <a className={`nav ${view === 'sounds' ? 'on' : ''}`} {...clickable(() => setView('sounds'))}><em className="nl"><Icon name="sounds" />Sound Library</em> <span>{sounds ? sounds.items.length.toLocaleString() : ''}</span></a>
        <a className={`nav ${view === 'kits' ? 'on' : ''}`} {...clickable(() => setView('kits'))}><em className="nl"><Icon name="kits" />Kit Maker</em> <span></span></a>
        <a className={`nav ${view === 'plugins' ? 'on' : ''}`} {...clickable(() => setView('plugins'))}><em className="nl"><Icon name="plugins" />Plugins</em> <span></span></a>
        <a className={`nav ${view === 'feedback' ? 'on' : ''}`} {...clickable(() => setView('feedback'))}><em className="nl"><Icon name="feedback" />Feedback</em> {unseenFeedback > 0 ? <span className="badge">{unseenFeedback}</span> : <span>{feedback.links.length}</span>}</a>
        <a className={`nav ${view === 'themes' ? 'on' : ''}`} {...clickable(() => setView('themes'))}><em className="nl"><Icon name="themes" />Themes</em> <span>{THEMES.find((t) => t.id === theme)?.name}</span></a>
        <div className="grow" />
        {openSession && <SessionPill startedAt={openSession.startedAt} onClick={() => setView('dashboard')} />}
        <button className={`ghost as-btn ${assistantOpen ? 'on' : ''}`} onClick={() => setAssistantOpen((o) => !o)} title="Ask the assistant to look things up or make changes (⌘J)">
          <em className="nl"><Icon name="assistant" />Assistant</em>
          {assistantStatus === 'approval' ? <span className="badge">approve</span> : assistantStatus === 'working' ? <span className="as-dot" title="Working…" /> : <kbd>⌘J</kbd>}
        </button>
        <button className="ghost" onClick={() => setSettings(true)}><em className="nl"><Icon name="settings" />Settings</em> <kbd>⌘,</kbd></button>
      </nav>

      {view === 'dashboard' ? (
        <Dashboard
          beats={beats} crm={crm} content={content} sales={salesData} feedback={feedback} sessions={sessions} settings={appSettings}
          onGo={setView} onQuery={openCollection} onOpenBeat={(id) => openItem(id)}
          onOpenContact={(id) => { setCrmSel(id); setView('crm') }} onPitchBeat={(id) => setPitchDlg({ beatIds: [id] })}
          onMakeVideo={(id) => { setContentBeat(id); setView('content') }} onSetStatus={setStatus} reloadSessions={reloadSessions}
        />
      ) : view === 'themes' ? (
        <ViewGuard name="Themes"><ThemesView current={theme} onPick={pickTheme} /></ViewGuard>
      ) : view === 'map' ? (
        <ViewGuard name="Sonic Map"><SonicMap beats={beats} onQuery={openCollection} onPlay={(id) => { setSelectedId(id); safePlay(id) }} onOpen={(id) => openItem(id)} /></ViewGuard>
      ) : view === 'sounds' ? (
        <ViewGuard name="Sound Library"><SoundLibrary data={sounds} roots={appSettings?.soundFolders ?? []} status={soundStatus} query={soundQuery} onQuery={setSoundQuery} projectSel={soundProject} onProjectSel={setSoundProject} onReload={reloadSounds} onPauseMain={() => { if (player.playing) player.toggle() }} toast={toast} /></ViewGuard>
      ) : view === 'kits' ? (
        <ViewGuard name="Kit Maker"><KitMaker data={sounds} onPauseMain={() => { if (player.playing) player.toggle() }} toast={toast} /></ViewGuard>
      ) : view === 'plugins' ? (
        <ViewGuard name="Plugins"><Plugins toast={toast} /></ViewGuard>
      ) : view === 'feedback' ? (
        <FeedbackView data={feedback} beats={audioBeats} onNew={() => setFbDlg({})} onPlayAt={(id, at) => safePlay(id, at)} reload={reloadFeedback} toast={toast} />
      ) : view === 'content' ? (
        <ViewGuard name="Content"><ContentView
          beats={audioBeats} sales={salesData.sales} content={content} settings={appSettings} beatId={contentBeat} onSelectBeat={setContentBeat}
          onPlayAt={(id, at) => safePlay(id, at)} reload={reloadContent} reloadBeats={reload} toast={toast} playId={player.id} playing={player.playing} playClock={player}
        /></ViewGuard>
      ) : view === 'sales' ? (
        <SalesView
          data={salesData} query={salesQuery} onQuery={setSalesQuery} onLog={() => setSaleDlg({})} onEdit={(sale) => setSaleDlg({ edit: sale })}
          onSplits={setSplitsDlg} reload={() => { reload(); reloadSales() }} toast={toast}
          onSheet={async (gid) => { try { const f = await window.api.exportSplitSheet(gid); if (f) toast(`Split sheet saved: ${f.split('/').pop()}`); reloadSales() } catch (e) { toast(errMsg(e)) } }}
          onOpenBeat={(id) => openItem(id)}
        />
      ) : view === 'crm' && crm ? (
        <Crm
          crm={crm} myName={appSettings?.producerName ?? ''} selected={crmSel} onSelect={setCrmSel} onPitch={(id) => setPitchDlg({ contactId: id })}
          onOpenBeat={(id) => openItem(id)} reload={reloadCrm} newContactSignal={newContactSignal}
        />
      ) : (<>
      <main className="main">
        <header className="toolbar">
          <div className="searchbox">
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isLoop ? 'Search: dark, 140+ bpm, unsent, sent, Cm…   ( / )' : 'Search: dark, 140+ bpm, unsold, finished, Cm…   ( / )'} spellCheck={false} />
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
          {query.trim() && !colls.some((c) => c.q === query) && (naming == null
            ? <button className="ghost" onClick={() => setNaming(query.length > 24 ? '' : query)} title="Keep this search in the sidebar">Save search</button>
            : <span className="savesearch"><input autoFocus value={naming} placeholder="Name it" onChange={(e) => setNaming(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && naming.trim()) { setColls([...colls, { name: naming.trim(), q: query }]); setNaming(null) } if (e.key === 'Escape') setNaming(null) }} />
              <button className="primary" disabled={!naming.trim()} onClick={() => { setColls([...colls, { name: naming.trim(), q: query }]); setNaming(null) }}>Save</button></span>)}
          {!isLoop && <button className="ghost" onClick={() => setCleanup(true)} title="Sift through FL projects and move the ones you don't want to the Trash">Clean up projects…</button>}
          {!isLoop && <button className="ghost" disabled={reindexing} onClick={() => reindexNow(true)} title="Look for new FL Studio projects now">{reindexing ? 'Scanning…' : 'Rescan FL projects'}</button>}
          <label className="check small"><input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} /> Group versions</label>
          {isLoop && (
            <>
              <label className="check small">Group by <select className="grp" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}><option value="folder">Folder</option><option value="bpm">BPM</option><option value="key">Key</option><option value="none">None</option></select></label>
              {grouped && <><button className="ghost" onClick={() => setAllSecs(true)}>Collapse all</button><button className="ghost" onClick={() => setAllSecs(false)}>Expand all</button></>}
            </>
          )}
        </div>

        <div className="table">
          <div className="thead">
            <span /><span>{isLoop ? 'Loop' : 'Beat'}</span><span>Tags</span><span className="r">BPM</span><span>Key</span><span className="r">Length</span><span>Status</span><span className="r">Added</span>
          </div>
          <div className="tbody">
            {sections.map((sec) => (
              <Fragment key={sec.key}>
                {grouped && (
                  <div className="secrow" {...clickable(() => toggleSec(sec.key))} title={isShut(sec.key) ? 'Click to open' : 'Click to fold'}>
                    <span className="caret">{isShut(sec.key) ? '▸' : '▾'}</span><b>{sec.label}</b><span className="dim">{sec.rows.length} {isLoop ? (sec.rows.length === 1 ? 'loop' : 'loops') : ''}</span>
                  </div>
                )}
                {!isShut(sec.key) && sec.rows.map(({ beat: b, count }) => {
              const sel = b.id === selectedId || (collapse && selectedIdx >= 0 && rows[selectedIdx]?.beat.id === b.id)
              const isPlaying = player.id === b.id && player.playing
              return (
                <div key={b.id} data-row={b.id} className={`row ${sel ? 'sel' : ''}`} {...clickable(() => setSelectedId(b.id))} onDoubleClick={() => playBeat(b.id)}>
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
              </Fragment>
            ))}
            {loaded && !rows.length && (
              <div className="empty">
                {list.length === 0 ? (scanning ? `Importing your ${isLoop ? 'loops' : 'beats'}…` : <>No {isLoop ? 'loops' : 'beats'} yet. Add a folder in <a onClick={() => setSettings(true)}>Settings</a>.</>) : `No ${isLoop ? 'loops' : 'beats'} match.`}
              </div>
            )}
          </div>
        </div>
      </main>

      {detail ? (
        <Detail beat={detail} kind={vaultKind} allTags={isLoop ? loopTags : allTags} onSelect={setSelectedId} onPlay={playBeat} refresh={reload} pitchedTo={pitchedTo} onPitch={() => setPitchDlg({ beatIds: [detail.id] })} onOpenContact={(id) => { setCrmSel(id); setView('crm') }}
          sales={salesData.sales.filter((x) => x.groupId === detail.groupId)} splitGroup={salesData.groups.find((g) => g.groupId === detail.groupId)}
          onLogSale={() => setSaleDlg({ beatId: detail.id })} onEditSplits={() => setSplitsDlg({ groupId: detail.groupId, title: detail.title })}
          onSheet={async () => { try { const f = await window.api.exportSplitSheet(detail.groupId); if (f) toast(`Split sheet saved: ${f.split('/').pop()}`); reloadSales() } catch (e) { toast(errMsg(e)) } }}
          projectSection={sounds?.projects.find((x) => x.path === detail.projectPath) ?? null} onProjectSounds={(id) => { setSoundProject(id); setView('sounds') }}
          compatible={compatible} onFeedback={() => setFbDlg({ beatIds: [detail.id] })} posts={content.posts.filter((x) => x.beatId === detail.id)} onContent={() => { setContentBeat(detail.id); setView('content') }}
          onError={toast} />
      ) : (
        <aside className="detail empty-detail"><p>Select a {isLoop ? 'loop' : 'beat'}</p><p className="dim">↑ ↓ to move · Space to play · 1–5 sets status</p></aside>
      )}
      </>)}

      <footer className="player">
        <button className="big-play" onClick={() => (player.id == null && selectedId != null ? safePlay(selectedId) : player.toggle())}>{player.playing ? '❚❚' : '▶'}</button>
        <div className="now">
          <div className="t">{playingDetail?.title ?? 'Nothing playing'}</div>
          <PlayerReadout player={player} fallbackDuration={playingDetail?.duration ?? null} />
        </div>
        <div className="wavewrap">
          <PlayerWave player={player} peaks={playingDetail?.peaks ?? []} />
        </div>
        <div className="pchips">
          <button className={`pchip2 ${audition ? 'on' : ''}`} onClick={() => setAudition((a) => !a)} title="Audition mode (A): play beats from their fullest part as you move through them">Audition</button>
          <button className="pchip2" onClick={flipTake} disabled={player.id == null || takesOf(beats, player.id).length < 2} title="A/B the takes of this beat at the same moment (B)">A/B</button>
        </div>
        {scanning && <div className="scan">Analyzing {scan.total - scan.pending}/{scan.total}<div className="bar"><div style={{ width: `${((scan.total - scan.pending) / Math.max(1, scan.total)) * 100}%` }} /></div></div>}
      </footer>

      {palette && <Palette beats={everything} contacts={crm?.contacts ?? []} sales={salesData.sales} sounds={sounds?.items ?? []} onPickSound={(x) => { setSoundQuery(x.n); setView('sounds') }} onPickSale={(sale) => { setSalesQuery(sale.beatTitle); setView('sales') }} commands={commands} onPickBeat={(b) => openItem(b.id, true)} onPickContact={(c) => { setCrmSel(c.id); setView('crm') }} onClose={() => setPalette(false)} />}
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
      {assistantMounted && <Assistant hidden={!assistantOpen} onBusy={setAssistantStatus} onClose={() => setAssistantOpen(false)} />}
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
      {toastMsg && <div className="toast" role="status" aria-live="polite" onClick={() => setToastMsg('')}>{toastMsg}</div>}
      {pitchDlg && crm && (
        <PitchDialog
          beats={audioList} crm={crm} myName={appSettings?.producerName ?? ''} hasToken={!!netlify?.hasToken} contactId={pitchDlg.contactId} beatIds={pitchDlg.beatIds}
          onClose={() => setPitchDlg(null)}
          onLogged={(cid) => { setPitchDlg(null); setCrmSel(cid); setView('crm'); reloadCrm(); reload() }}
        />
      )}
    </div>
  )
}
