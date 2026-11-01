import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SoundList, SoundRow } from '@shared/types'
import { KIT_SLOTS, soundKey, autoFill, candidates, clearAuto, cleanName, emptyPicks, isEdm, planKit, type Picks, type Pool, type SlotId } from '@shared/kitmaker'
import { emptyHistory, newKit, record, redo, sanitize, undo, uniqueName, upsert, usageByKey, type History, type SavedKit } from '@shared/kitdrafts'

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

  return (
    <section className="sales pl2 km">
      <div className="sales-head">
        <h2>Kit Maker</h2>
        <span className="dim">{total} sounds</span>
        <div className="grow" />
        <button onClick={doUndo} disabled={!hist.past.length} title="Undo the last change (⌘Z)">Undo</button>
        <button onClick={doRedo} disabled={!hist.future.length} title="Redo (⇧⌘Z)">Redo</button>
        <span className="km-sep" />
        <button onClick={fill} title="Fill every folder up to its target with random sounds. You can undo it.">Auto-fill</button>
        <button onClick={reroll} disabled={!autoCount} title="Swap the auto-picked sounds for new ones. Sounds you added yourself stay.">Re-roll auto-picks</button>
        <button onClick={clear} disabled={!total}>Clear</button>
        <button className="primary" onClick={exportKit} disabled={busy || !total}>{busy ? 'Saving…' : 'Export kit'}</button>
      </div>

      <div className="km-kitbar">
        <label>Kit
          <select value={activeId} onChange={(e) => switchKit(e.target.value)}>
            {[...kits].sort((a, b) => b.updated - a.updated).map((k) => <option key={k.id} value={k.id}>{k.id === activeId ? name : k.name} · {count(k.id === activeId ? picks : k.picks)} sounds</option>)}
          </select>
        </label>
        <button onClick={createKit}>+ New kit</button>
        <button onClick={deleteKit} title="Delete this saved kit">Delete</button>
        <span className="dim km-saved">{savedAt ? '✓ Saved automatically. Pick this kit from the list to come back to it.' : ''}</span>
      </div>

      <div className="pl-wrap">
        <div className="km-meta">
          <label>Kit name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Drum Kit" /></label>
          <label>Your tag<input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="yourname" />{missingTag && <small className="dim">No tag: files will be named “Kick 01.wav”.</small>}</label>
          <label className="km-out">Save to<span className="km-dir"><input value={outDir} onChange={(e) => setOutDir(e.target.value)} /><button onClick={pickFolder}>Choose…</button></span></label>
        </div>

        <div className="km-slots">
          {KIT_SLOTS.map((s) => (
            <button key={s.id} className={`km-slot ${slot === s.id ? 'on' : ''}`} onClick={() => { setSlot(s.id); setQ('') }}>
              <b>{s.folder}</b>
              <span className="mono">{live[s.id].length}<i className="dim">/{targets[s.id]}</i></span>
            </button>
          ))}
        </div>

        <div className="km-tools">
          <div className="seg km-mode">
            <button className={mode === 'browse' ? 'on' : ''} onClick={() => setMode('browse')}>Browse library</button>
            <button className={mode === 'kit' ? 'on' : ''} onClick={() => setMode('kit')}>In this kit ({total})</button>
          </div>
          {mode === 'browse' && <><div className="seg km-mode" title="EDM sample packs are kept out of the main pool. Switch to EDM to use them.">
            <button className={pool === 'main' ? 'on' : ''} onClick={() => setPool('main')}>Main {poolCounts.main.toLocaleString()}</button>
            <button className={pool === 'edm' ? 'on' : ''} onClick={() => setPool('edm')}>EDM {poolCounts.edm.toLocaleString()}</button>
            <button className={pool === 'both' ? 'on' : ''} onClick={() => setPool('both')}>Both</button>
          </div><input placeholder={`Search ${cands[slot].length.toLocaleString()} ${KIT_SLOTS.find((s) => s.id === slot)!.folder.toLowerCase()} in your library…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="km-target">Auto-fill target
            <input type="number" min={0} max={200} value={targets[slot]} onChange={(e) => setTargets((t) => ({ ...t, [slot]: Math.max(0, Math.min(200, Number(e.target.value) || 0)) }))} />
          </label>
          <label className="km-target" title="Hide sounds you already used in your other saved kits, and keep Auto-fill from picking them"><input type="checkbox" checked={skipUsed} onChange={(e) => setSkipUsed(e.target.checked)} style={{ width: 'auto' }} />Skip sounds from other kits</label>
          {preview.length > 0 && <span className="dim km-prev">Exports as {preview.join(' · ')}{live[slot].length > 3 ? ' …' : ''}</span>}</>}
        </div>

        {mode === 'kit' ? (
          <div className="km-list">
            {!total && <div className="empty">Nothing in this kit yet. Switch to Browse library and add sounds, or hit Auto-fill.</div>}
            {KIT_SLOTS.filter((s) => live[s.id].length).map((s) => (
              <div key={s.id}>
                <div className="km-group"><b>{s.folder}</b><span className="dim">{live[s.id].length}</span><span className="grow" /><button className="ghost" onClick={() => { setSlot(s.id); setMode('browse') }}>Add more</button></div>
                {plan.filter((f) => f.slot === s.id).map((f) => {
                  const r = byId.get(f.id)!
                  const pk = live[s.id].find((p) => p.id === f.id)
                  const used = usage.get(soundKey(r))
                  return (
                    <div key={f.id} className="km-row on">
                      <button className="km-play" onClick={() => play(f.id)} aria-label="Preview">{playing === f.id ? '❚❚' : '▶'}</button>
                      <span className="sname" title={f.name}>{f.name}{isEdm(data!.dirs[r.d]) && <em className="km-used km-edm">EDM</em>}{used && <em className="km-used" title={`Also in: ${used.join(', ')}`}>also in {used.length === 1 ? used[0] : `${used.length} kits`}</em>}</span>
                      <span className="dim sfolder" title={r.n}>from “{r.n}”{pk?.auto ? ' · auto' : ''}</span>
                      <span className="mono dim r">{fmtLen(r.u)}</span>
                      <button onClick={() => change((p) => ({ ...p, [s.id]: p[s.id].filter((x) => x.id !== f.id) }))}>Remove</button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ) : (

        <div className="km-list">
          {!data && <div className="empty">Loading your library…</div>}
          {data && !list.length && <div className="empty">{cands[slot].length ? 'No sounds match.' : 'No WAV sounds of this type in your library yet.'}</div>}
          {list.map((s) => {
            const on = picked.has(s.id)
            const auto = on && live[slot].find((p) => p.id === s.id)?.auto
            return (
              <div key={s.id} className={`km-row ${on ? 'on' : ''}`}>
                <button className="km-play" onClick={() => play(s.id)} aria-label="Preview">{playing === s.id ? '❚❚' : '▶'}</button>
                <span className="sname" title={s.n}>{s.n}{usage.has(soundKey(s)) && <em className="km-used" title={`Also in: ${usage.get(soundKey(s))!.join(', ')}`}>also in {usage.get(soundKey(s))!.length === 1 ? usage.get(soundKey(s))![0] : `${usage.get(soundKey(s))!.length} kits`}</em>}</span>
                <span className="dim sfolder" title={data!.dirs[s.d]}>{data!.dirs[s.d].split('/').slice(-2).join(' / ')}</span>
                <span className="mono dim r">{fmtLen(s.u)}</span>
                <button className={on ? 'primary' : ''} onClick={() => toggle(s)}>{on ? (auto ? 'Auto ✓' : 'Added ✓') : 'Add'}</button>
              </div>
            )
          })}
          {data && cands[slot].length > list.length && !q && <div className="empty dim">Showing the first {list.length}. Search to narrow it down.</div>}
        </div>
        )}
      </div>
    </section>
  )
}
