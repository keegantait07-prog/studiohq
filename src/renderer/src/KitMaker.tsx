import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SoundList, SoundRow } from '@shared/types'
import { KIT_SLOTS, slotOf, soundKey, autoFill, candidates, clearAuto, cleanName, emptyPicks, isEdm, planKit, type Picks, type Pool, type SlotId } from '@shared/kitmaker'
import { emptyHistory, newKit, record, redo, sanitize, undo, uniqueName, upsert, usageByKey, type History, type SavedKit } from '@shared/kitdrafts'

import { Undo2, Redo2, Sparkles, Dices, Plus, Trash2, Download, Play, Pause, Search, Minus, Folder } from 'lucide-react'
import { TooltipProvider } from '@/components/lib/tooltip'
import { ScrollArea } from '@/components/lib/scroll-area'
import { Button, IconBtn, Seg, Tip } from './makeUi'
import { KitCoverflow, DropZone } from './kitUi'
import { matchDropped } from './kitDrop'
import './make.css'

const STORE_KEY = 'shq.kitmaker.kits'
const POOL_KEY = 'shq.kitmaker.pool'
const LEGACY_KEY = 'shq.kitmaker.draft'
interface Store { kits: SavedKit[]; active: string }

function loadStore(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Store> | null
    const kits = (raw?.kits ?? []).map((k) => sanitize(k))
    if (kits.length) return { kits, active: kits.some((k) => k.id === raw?.active) ? raw!.active! : kits[0].id }
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) { const k = sanitize(JSON.parse(legacy)); return { kits: [k], active: k.id } }
  } catch { /* unreadable storage: start fresh */ }
  const k = newKit('My Drum Kit')
  return { kits: [k], active: k.id }
}

const fmtLen = (u: number | null) => (u == null ? '' : u < 10 ? `${u.toFixed(2)}s` : `${u.toFixed(1)}s`)
const count = (p: Picks) => KIT_SLOTS.reduce((n, s) => n + p[s.id].length, 0)

export function KitMaker({ data, onPauseMain, toast }: { data: SoundList | null; onPauseMain: () => void; toast: (m: string) => void }) {
  const init = useMemo(loadStore, [])
  const [kits, setKits] = useState<SavedKit[]>(init.kits)
  const [activeId, setActiveId] = useState(init.active)
  const first = init.kits.find((k) => k.id === init.active)!
  const [name, setName] = useState(first.name)
  const [tag, setTag] = useState(first.tag)
  const [outDir, setOutDir] = useState(first.outDir)
  const [picks, setPicks] = useState<Picks>(first.picks)
  const [targets, setTargets] = useState<Record<SlotId, number>>(first.targets)
  const [hist, setHist] = useState<History<Picks>>(emptyHistory())
  const [slot, setSlot] = useState<SlotId>('kicks')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState<number | null>(null)
  const [mode, setMode] = useState<'browse' | 'kit'>('browse')
  const [skipUsed, setSkipUsed] = useState(false)
  const [pool, setPoolState] = useState<Pool>(() => { try { const v = localStorage.getItem(POOL_KEY); return v === 'edm' || v === 'both' ? v : 'main' } catch { return 'main' } })
  const setPool = (p: Pool) => { setPoolState(p); try { localStorage.setItem(POOL_KEY, p) } catch { /* private mode */ } }
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const picksRef = useRef(picks)
  picksRef.current = picks

  const load = (k: SavedKit) => { setActiveId(k.id); setName(k.name); setTag(k.tag); setOutDir(k.outDir); setPicks(k.picks); setTargets(k.targets); setHist(emptyHistory()); setQ('') }

  // every change is saved straight into the open kit
  useEffect(() => {
    const now = Date.now()
    const me: SavedKit = { id: activeId, name, tag, outDir, picks, targets, updated: now }
    setKits((ks) => {
      const next = upsert(ks, me)
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ kits: next, active: activeId })) } catch { /* private mode */ }
      return next
    })
    setSavedAt(now)
  }, [activeId, name, tag, outDir, picks, targets])

  useEffect(() => { if (!outDir) window.api.kitDefaults().then((d) => setOutDir(d.outDir)) }, [outDir])
  useEffect(() => {
    const a = new Audio()
    audio.current = a
    a.addEventListener('ended', () => setPlaying(null))
    a.addEventListener('pause', () => setPlaying(null))
    return () => { a.pause(); a.src = '' }
  }, [])

  /** All edits to the picks go through here, so each one can be undone. */
  const change = (fn: (p: Picks) => Picks): number => {
    const p = picksRef.current
    const n = fn(p)
    if (n === p) return 0
    setHist((h) => record(h, p))
    setPicks(n)
    return count(n) - count(p)
  }
  const doUndo = useCallback(() => { const r = undo(hist, picksRef.current); if (r) { setHist(r.h); setPicks(r.value) } }, [hist])
  const doRedo = useCallback(() => { const r = redo(hist, picksRef.current); if (r) { setHist(r.h); setPicks(r.value) } }, [hist])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      e.preventDefault()
      if (e.shiftKey) doRedo(); else doUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doUndo, doRedo])

  const switchKit = (id: string) => { const k = kits.find((x) => x.id === id); if (k && id !== activeId) load(k) }
  const createKit = () => { const k = newKit(uniqueName(kits, 'New Kit'), tag, outDir); setKits((ks) => upsert(ks, k)); load(k) }
  const deleteKit = () => {
    if (!confirm(`Delete the kit “${name}”? Its picks are lost. (Kits you already exported are not touched.)`)) return
    const rest = kits.filter((k) => k.id !== activeId)
    const next = rest[0] ?? newKit('My Drum Kit', tag, outDir)
    setKits(rest.length ? rest : [next])
    load(next)
  }

  // the kits already exported are copies of library sounds: leave them out so they do not show up twice
  const cands = useMemo(() => candidates(data?.items ?? [], data?.dirs ?? [], pool, outDir ? [outDir] : []), [data, pool, outDir])
  const poolCounts = useMemo(() => {
    const n = { main: 0, edm: 0 }
    const all = candidates(data?.items ?? [], data?.dirs ?? [], 'both', outDir ? [outDir] : [])
    for (const s of KIT_SLOTS) for (const r of all[s.id]) n[isEdm(data!.dirs[r.d]) ? 'edm' : 'main']++
    return n
  }, [data, outDir])
  const byId = useMemo(() => new Map((data?.items ?? []).map((s) => [s.id, s])), [data])
  // picks whose file has since left the library are dropped from the count and the export
  const live = useMemo(() => Object.fromEntries(KIT_SLOTS.map((s) => [s.id, picks[s.id].filter((p) => byId.has(p.id))])) as unknown as Picks, [picks, byId])
  const total = KIT_SLOTS.reduce((n, s) => n + live[s.id].length, 0)
  const picked = useMemo(() => new Set(live[slot].map((p) => p.id)), [live, slot])

  const usage = useMemo(() => usageByKey(kits, activeId, byId), [kits, activeId, byId])
  const fresh = useMemo(() => Object.fromEntries(KIT_SLOTS.map((s) => [s.id, cands[s.id].filter((c) => !usage.has(soundKey(c)))])) as typeof cands, [cands, usage])
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const all = skipUsed ? fresh[slot] : cands[slot]
    return (t ? all.filter((s) => s.n.toLowerCase().includes(t) || (data?.dirs[s.d] ?? '').toLowerCase().includes(t)) : all).slice(0, 400)
  }, [cands, fresh, skipUsed, slot, q, data])

  const play = useCallback((id: number) => {
    const a = audio.current!
    if (playing === id) { a.pause(); return }
    onPauseMain()
    a.src = `shqa://sound/${id}`
    a.currentTime = 0
    a.play().then(() => setPlaying(id)).catch(() => {})
  }, [onPauseMain, playing])

  const toggle = (s: SoundRow) => change((p) => {
    const cur = p[slot]
    return { ...p, [slot]: cur.some((x) => x.id === s.id) ? cur.filter((x) => x.id !== s.id) : [...cur, { id: s.id, auto: false }] }
  })
  const fill = () => { const n = change((p) => autoFill(p, skipUsed ? fresh : cands, targets)); toast(n ? `Added ${n} sounds. Undo with ⌘Z or the Undo button.` : 'Every folder is already at its target.') }
  const autoCount = KIT_SLOTS.reduce((n, s) => n + live[s.id].filter((p) => p.auto).length, 0)
  const reroll = () => { change((p) => autoFill(clearAuto(p), skipUsed ? fresh : cands, targets)); toast('Re-rolled the auto-picked sounds. Undo with ⌘Z.') }
  const clear = () => { change(() => emptyPicks()); toast('Cleared the kit. Undo with ⌘Z.') }

  const pickFolder = async () => { const d = await window.api.kitPickFolder(); if (d) setOutDir(d) }
  const exportKit = async () => {
    const files = planKit(live, byId, tag)
    if (!files.length) { toast('Pick some sounds first, or hit Auto-fill.'); return }
    setBusy(true)
    try {
      const r = await window.api.kitExport({ name, tag, outDir, files: files.map((f) => ({ id: f.id, folder: f.folder, name: f.name })) })
      toast(r.failed.length ? `Saved ${r.copied} sounds. ${r.failed.length} could not be copied.` : `Saved ${r.copied} sounds to ${r.dir.replace(/^\/Users\/[^/]+/, '~')}`)
    } catch (e) { toast(`Export failed: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  const plan = useMemo(() => planKit(live, byId, tag), [live, byId, tag])
  const preview = useMemo(() => planKit(live, byId, tag).filter((f) => f.slot === slot).slice(0, 3).map((f) => f.name), [live, byId, tag, slot])
  const missingTag = !tag.trim()

  const slotMeta = KIT_SLOTS.find((s) => s.id === slot)!
  const tgtTotal = KIT_SLOTS.reduce((n, s) => n + targets[s.id], 0)
  const step = (id: SlotId, d: number) => setTargets((t) => ({ ...t, [id]: Math.max(0, Math.min(200, t[id] + d)) }))
  const addDropped = (files: File[]) => {
    const r = matchDropped(files.map((f) => f.name), data?.items ?? [], new Set(Object.values(live).flat().map((p) => p.id)))
    if (!r.matched.length) { toast(`None of ${files.length === 1 ? 'that file is' : `those ${files.length} files are`} in your library yet. Add the folder in Settings, then Rescan.`); return }
    const n = change((p) => {
      let out = p
      for (const s of r.matched) { const sl = slotOf(s, data!.dirs[s.d]) ?? slot; if (!out[sl].some((x) => x.id === s.id)) out = { ...out, [sl]: [...out[sl], { id: s.id, auto: false }] } }
      return out
    })
    toast(`Added ${n} sound${n === 1 ? '' : 's'} to the kit${r.missed ? `. ${r.missed} not found in your library.` : '.'}`)
  }
  const coverKits = useMemo(() => kits.map((k) => ({ id: k.id, name: k.id === activeId ? name : k.name, count: count(k.id === activeId ? picks : k.picks), updated: k.id === activeId ? (savedAt ?? k.updated) : k.updated })), [kits, activeId, name, picks, savedAt])
  const playBtn = (id: number, label: string) => <button type="button" className={`mk-p ${playing === id ? 'pl' : ''}`} aria-label={`Preview ${label}`} onClick={() => play(id)}>{playing === id ? <Pause /> : <Play />}</button>

  return (
    <TooltipProvider>
    <section className="mk-kits">
      <div className="mk-tools">
        <h2 className="mk-disp">Kit Maker</h2>
        <span className="mk-dim">{total} sounds</span>
        <IconBtn label="Undo the last change (⌘Z)" onClick={doUndo} disabled={!hist.past.length}><Undo2 /></IconBtn>
        <IconBtn label="Redo (⇧⌘Z)" onClick={doRedo} disabled={!hist.future.length}><Redo2 /></IconBtn>
        <Tip label="Fill every folder up to its target with random sounds. You can undo it."><Button variant="outline" size="sm" onClick={fill}><Sparkles />Auto-fill</Button></Tip>
        <IconBtn label="Re-roll auto-picks: swap the auto-picked sounds for new ones. Sounds you added yourself stay." onClick={reroll} disabled={!autoCount}><Dices /></IconBtn>
        <Button variant="outline" size="sm" onClick={clear} disabled={!total}>Clear</Button>
        <span className="mk-sp" />
        <span className="mk-dim mk-saved">{savedAt ? '✓ Saved automatically' : ''}</span>
        <Button variant="outline" size="sm" onClick={createKit}><Plus />New kit</Button>
        <Tip label="Delete this saved kit"><Button variant="destructive" size="sm" onClick={deleteKit}><Trash2 />Delete</Button></Tip>
        <Button size="sm" onClick={exportKit} disabled={busy || !total}><Download />{busy ? 'Saving…' : 'Export kit'}</Button>
      </div>

      <KitCoverflow kits={coverKits} activeId={activeId} onSwitch={switchKit} onNew={createKit} />

      <div className="mk-kbody">
        <nav className="mk-slots" aria-label="Kit sections">
          <ScrollArea className="mk-scroll">
            <div className="mk-slots-in">
              {KIT_SLOTS.map((s) => {
                const n = live[s.id].length, t = targets[s.id]
                return (
                  <div key={s.id} className={`mk-slot ${slot === s.id ? 'on' : ''} ${t > 0 && n >= t ? 'done' : ''}`}>
                    <button type="button" className="mk-slot-main" aria-pressed={slot === s.id} onClick={() => { setSlot(s.id); setQ(''); setMode('browse') }}>
                      <b>{s.folder}</b><em>{n}<i> / {t}</i></em>
                      <span className="mk-prog" style={{ ['--p' as string]: `${t ? Math.min(100, (n / t) * 100) : n ? 100 : 0}%` }}><i /></span>
                    </button>
                    <span className="mk-step" role="group" aria-label={`${s.folder} target`}>
                      <button type="button" aria-label={`Lower ${s.folder} target`} onClick={() => step(s.id, -1)}><Minus /></button>
                      <button type="button" aria-label={`Raise ${s.folder} target`} onClick={() => step(s.id, 1)}><Plus /></button>
                    </span>
                  </div>
                )
              })}
              <p className="mk-help">Targets are what Auto-fill aims for. Change them any time.</p>
            </div>
          </ScrollArea>
        </nav>

        <div className="mk-kmain">
          <div className="mk-ktools">
            <Seg label="Show" value={mode} onChange={setMode} options={[{ v: 'browse', label: 'Browse library' }, { v: 'kit', label: <>This kit <span className="mk-c">{total}</span></> }]} />
            {mode === 'browse' && <>
              <Tip label="EDM sample packs are kept out of the main pool. Switch to EDM to use them."><span><Seg label="Sound pool" value={pool} onChange={setPool} options={[{ v: 'main', label: `Main ${poolCounts.main.toLocaleString()}` }, { v: 'edm', label: `EDM ${poolCounts.edm.toLocaleString()}` }, { v: 'both', label: 'Both' }]} /></span></Tip>
              <label className="mk-field grow"><Search aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" placeholder={`Search ${cands[slot].length.toLocaleString()} ${slotMeta.folder.toLowerCase()} in your library…`} /></label>
              <Tip label="Hide sounds you already used in your other saved kits, and keep Auto-fill from picking them"><label className="mk-lbl"><input type="checkbox" checked={skipUsed} onChange={(e) => setSkipUsed(e.target.checked)} />Skip used</label></Tip>
            </>}
          </div>
          <div className="mk-thead mk-kgrid" role="row"><span /><span>Name</span><span className="c-fold">Folder</span><span className="r">Length</span><span /></div>
          <div className="mk-rows">
            {mode === 'kit' ? (
              <>
                {!total && <div className="mk-empty"><b>Nothing in this kit yet</b>Switch to Browse library and add sounds, or hit Auto-fill.</div>}
                {KIT_SLOTS.filter((s) => live[s.id].length).map((s) => (
                  <div key={s.id}>
                    <div className="mk-kgroup"><b>{s.folder}</b><span className="mk-dim">{live[s.id].length}</span><span className="mk-sp" /><Button variant="ghost" size="xs" onClick={() => { setSlot(s.id); setMode('browse') }}>Add more</Button></div>
                    {plan.filter((f) => f.slot === s.id).map((f) => {
                      const r = byId.get(f.id)!
                      const pk = live[s.id].find((p) => p.id === f.id)
                      const used = usage.get(soundKey(r))
                      return (
                        <div key={f.id} className="mk-krow mk-kgrid on">
                          {playBtn(f.id, f.name)}
                          <span className="mk-kn" title={f.name}>{f.name}{isEdm(data!.dirs[r.d]) && <em className="mk-badge edm">EDM</em>}{used && <em className="mk-badge" title={`Also in: ${used.join(', ')}`}>also in {used.length === 1 ? used[0] : `${used.length} kits`}</em>}</span>
                          <span className="mk-dim c-fold mk-ellip" title={r.n}>from “{r.n}”{pk?.auto ? ' · auto' : ''}</span>
                          <span className="mono mk-dim r">{fmtLen(r.u)}</span>
                          <Button variant="ghost" size="xs" onClick={() => change((p) => ({ ...p, [s.id]: p[s.id].filter((x) => x.id !== f.id) }))}>Remove</Button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </>
            ) : (
              <>
                {!data && <div className="mk-empty"><b>Loading your library…</b></div>}
                {data && !list.length && <div className="mk-empty"><b>{cands[slot].length ? 'No sounds match.' : 'No WAV sounds of this type in your library yet.'}</b></div>}
                {list.map((s) => {
                  const on = picked.has(s.id)
                  const auto = on && live[slot].find((p) => p.id === s.id)?.auto
                  const u = usage.get(soundKey(s))
                  return (
                    <div key={s.id} className={`mk-krow mk-kgrid ${on ? 'on' : ''}`}>
                      {playBtn(s.id, s.n)}
                      <span className="mk-kn" title={s.n}>{s.n}{u && <em className="mk-badge" title={`Also in: ${u.join(', ')}`}>also in {u.length === 1 ? u[0] : `${u.length} kits`}</em>}</span>
                      <span className="mk-dim c-fold mk-ellip" title={data!.dirs[s.d]}>{data!.dirs[s.d].split('/').slice(-2).join(' / ')}</span>
                      <span className="mono mk-dim r">{fmtLen(s.u)}</span>
                      <Button variant={on ? 'secondary' : 'outline'} size="xs" aria-pressed={on} onClick={() => toggle(s)}>{on ? (auto ? 'Auto ✓' : 'Added ✓') : 'Add'}</Button>
                    </div>
                  )
                })}
              </>
            )}
          </div>
          <div className="mk-kfoot">{mode === 'browse' && data && cands[slot].length > list.length && !q ? `Showing the first ${list.length}. Search to narrow it down. ` : ''}{preview.length > 0 ? `Exports as ${preview.join(' · ')}${live[slot].length > 3 ? ' …' : ''}` : `${total} sounds in this kit`}</div>
        </div>

        <aside className="mk-kside" aria-label="Kit details">
          <ScrollArea className="mk-scroll">
            <div className="mk-insp-body">
              <div>
                <h3 className="mk-disp mk-kname">{name || 'My Drum Kit'}</h3>
                <div className="mk-dim">{total} of {tgtTotal} target sounds</div>
                <span className="mk-prog big" style={{ ['--p' as string]: `${tgtTotal ? Math.min(100, (total / tgtTotal) * 100) : 0}%` }}><i /></span>
              </div>
              <label className="mk-fld">Kit name<input className="mk-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Drum Kit" /></label>
              <label className="mk-fld">Your tag<input className="mk-in" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="yourname" />{missingTag && <small className="mk-dim">No tag: files will be named “Kick 01.wav”.</small>}</label>
              <div className="mk-fld">Save to
                <span className="mk-dir"><input className="mk-in" value={outDir} onChange={(e) => setOutDir(e.target.value)} aria-label="Save to folder" /><Button variant="outline" size="sm" onClick={pickFolder}><Folder />Choose…</Button></span>
              </div>
              <DropZone title="Drop WAVs here" hint={<>Sounds already in your library are added to the kit; the type is read from the file name. Others are skipped.</>} onFiles={addDropped} />
              <dl className="mk-kv">
                <dt>Sounds</dt><dd>{total}</dd>
                <dt>Size</dt><dd>about {(plan.reduce((n, f) => n + (byId.get(f.id)?.s ?? 0), 0) / 1e6).toFixed(1)} MB</dd>
                <dt>Format</dt><dd>WAV, as in your library</dd>
              </dl>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </section>
    </TooltipProvider>
  )
}
