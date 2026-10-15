import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATUSES, type Beat, type BeatDetail, type CrmData, type ScanStatus, type Settings as AppSettings, type Status, type TagKind, type NetlifyStatus } from '@shared/types'
import { displayKey } from '@shared/key'
import { parseQuery } from './query'
import { usePlayer } from './player'
import { Thumb, Waveform } from './Waveform'
import { Detail } from './Detail'
import { Palette, type Command } from './Palette'
import { Settings } from './Settings'
import { Crm } from './Crm'
import { PitchDialog } from './PitchDialog'
import { isDue } from './crmUtils'
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
  const [statusTab, setStatusTab] = useState<Status | 'all'>('all')
  const [collapse, setCollapse] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<BeatDetail | null>(null)
  const [playingDetail, setPlayingDetail] = useState<BeatDetail | null>(null)
  const [allTags, setAllTags] = useState<Record<TagKind, string[]>>({ vibe: [], genre: [], artist: [] })
  const [scan, setScan] = useState<ScanStatus>({ pending: 0, done: 0, total: 0 })
  const [palette, setPalette] = useState(false)
  const [settings, setSettings] = useState(false)
  const [view, setView] = useState<'vault' | 'crm'>('vault')
  const [crm, setCrm] = useState<CrmData | null>(null)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [netlify, setNetlify] = useState<NetlifyStatus | null>(null)
  const [crmSel, setCrmSel] = useState<number | null>(null)
  const [pitchDlg, setPitchDlg] = useState<{ contactId?: number; beatIds?: number[] } | null>(null)
  const [newContactSignal, setNewContactSignal] = useState(0)
  const [tick, setTick] = useState(0)
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

  const setStatus = async (id: number, s: Status) => { await window.api.updateBeat(id, { status: s }); reload() }
  const playBeat = (id: number) => { setSelectedId(id); player.play(id) }

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return }
      if (mod && e.key === '1') { e.preventDefault(); setView('vault'); return }
      if (mod && e.key === '2') { e.preventDefault(); setView('crm'); return }
      if (mod && e.key === ',') { e.preventDefault(); setSettings(true); return }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); search.current?.focus(); search.current?.select(); return }
      if (e.key === 'Escape') {
        if (palette) return setPalette(false)
        if (settings) return setSettings(false)
        if (typing) { (t as HTMLInputElement).blur(); return }
        if (query) return setQuery('')
      }
      if (typing || palette || settings || pitchDlg || mod) return
      if (view !== 'vault') return
      if (e.key === '/') { e.preventDefault(); search.current?.focus() }
      else if (e.key === ' ') { e.preventDefault(); player.id == null && selectedId != null ? player.play(selectedId) : player.toggle() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); player.skip(e.shiftKey ? 15 : 5) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); player.skip(e.shiftKey ? -15 : -5) }
      else if (e.key === 'Enter' && selectedId != null) playBeat(selectedId)
      else if (/^[1-5]$/.test(e.key) && selectedId != null) setStatus(selectedId, STATUSES[+e.key - 1])
      else if (e.key.toLowerCase() === 'g') setCollapse((c) => !c)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const commands: Command[] = [
    { id: 'go-vault', label: 'Go to Beat Vault', hint: '⌘1', run: () => setView('vault') },
    { id: 'go-crm', label: 'Go to Pitch CRM', hint: '⌘2', run: () => setView('crm') },
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
        <a className={`nav ${view === 'vault' ? 'on' : ''}`} onClick={() => setView('vault')}>Beat Vault <span>{beats.length}</span></a>
        <a className={`nav ${view === 'crm' ? 'on' : ''}`} onClick={() => setView('crm')}>Pitch CRM {dueCount > 0 ? <span className="badge">{dueCount}</span> : <span>{crm?.contacts.length ?? 0}</span>}</a>
        {['Sound Library', 'Sales & Collabs', 'Content', 'Feedback', 'Dashboard'].map((m) => <a key={m} className="nav soon">{m}<span>soon</span></a>)}
        <div className="grow" />
        <button className="ghost" onClick={() => setSettings(true)}>Settings <kbd>⌘,</kbd></button>
      </nav>

      {view === 'crm' && crm ? (
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
                  <button className={`play ${isPlaying ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); player.id === b.id ? player.toggle() : playBeat(b.id) }} aria-label="play">{isPlaying ? '❚❚' : '▶'}</button>
                  <div className="name">
                    <Thumb data={b.thumb} />
                    <div className="nt">
                      <div className="t">{b.title}{count > 1 && <em className="ver-badge">{count} versions</em>}{!collapse && b.versionLabel && <em className="ver-badge">{b.versionLabel}</em>}</div>
                      {b.credits && <div className="sub">{b.credits}</div>}
                    </div>
                  </div>
                  <div className="tg">{[...b.tags.genre.map((t) => ['genre', t]), ...b.tags.vibe.map((t) => ['vibe', t]), ...b.tags.artist.map((t) => ['artist', t])].slice(0, 4).map(([k, t]) => <span key={k + t} className={`chip ${k}`}>{t}</span>)}</div>
                  <span className={`r mono ${b.bpmConfidence === 'low' ? 'warn' : ''}`} title={b.bpmConfidence === 'low' ? 'Low confidence. Check half/double time.' : ''}>{fmtBpm(b.bpm)}{!b.analyzed && b.bpm == null ? '…' : ''}</span>
                  <span className="mono">{displayKey(b.key) || (b.analyzed ? '–' : '…')}</span>
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
        <Detail beat={detail} allTags={allTags} onSelect={setSelectedId} onPlay={playBeat} refresh={reload} pitchedTo={pitchedTo} onPitch={() => setPitchDlg({ beatIds: [detail.id] })} onOpenContact={(id) => { setCrmSel(id); setView('crm') }} />
      ) : (
        <aside className="detail empty-detail"><p>Select a beat</p><p className="dim">↑ ↓ to move · Space to play · 1–5 sets status</p></aside>
      )}
      </>)}

      <footer className="player">
        <button className="big-play" onClick={() => (player.id == null && selectedId != null ? player.play(selectedId) : player.toggle())}>{player.playing ? '❚❚' : '▶'}</button>
        <div className="now">
          <div className="t">{playingDetail?.title ?? 'Nothing playing'}</div>
          <div className="sub mono">{fmtDur(player.time)} / {fmtDur(player.duration || playingDetail?.duration || null)}</div>
        </div>
        <div className="wavewrap">
          <Waveform peaks={playingDetail?.peaks ?? []} progress={player.duration ? player.time / player.duration : 0} onSeek={(f) => player.duration && player.seek(f * player.duration)} />
        </div>
        {scanning && <div className="scan">Analyzing {scan.total - scan.pending}/{scan.total}<div className="bar"><div style={{ width: `${((scan.total - scan.pending) / Math.max(1, scan.total)) * 100}%` }} /></div></div>}
      </footer>

      {palette && <Palette beats={beats} contacts={crm?.contacts ?? []} commands={commands} onPickBeat={(b) => { setView('vault'); playBeat(b.id) }} onPickContact={(c) => { setCrmSel(c.id); setView('crm') }} onClose={() => setPalette(false)} />}
      {settings && <Settings onClose={() => { setSettings(false); reload(); reloadCrm() }} />}
      {pitchDlg && crm && (
        <PitchDialog
          beats={beats} crm={crm} myName={appSettings?.producerName ?? ''} hasToken={!!netlify?.hasToken} contactId={pitchDlg.contactId} beatIds={pitchDlg.beatIds}
          onClose={() => setPitchDlg(null)}
          onLogged={(cid) => { setPitchDlg(null); setCrmSel(cid); setView('crm'); reloadCrm(); reload() }}
        />
      )}
    </div>
  )
}
