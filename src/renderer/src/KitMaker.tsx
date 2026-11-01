import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SoundList, SoundRow } from '@shared/types'
import { KIT_SLOTS, autoFill, candidates, clearAuto, cleanName, emptyPicks, planKit, type Picks, type SlotId } from '@shared/kitmaker'

const DRAFT_KEY = 'shq.kitmaker.draft'
interface Draft { name: string; tag: string; outDir: string; picks: Picks; targets: Record<SlotId, number> }
const defaultTargets = () => Object.fromEntries(KIT_SLOTS.map((s) => [s.id, s.target])) as Record<SlotId, number>

function loadDraft(): Partial<Draft> {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') } catch { return {} }
}

const fmtLen = (u: number | null) => (u == null ? '' : u < 10 ? `${u.toFixed(2)}s` : `${u.toFixed(1)}s`)

export function KitMaker({ data, onPauseMain, toast }: { data: SoundList | null; onPauseMain: () => void; toast: (m: string) => void }) {
  const saved = useMemo(loadDraft, [])
  const [name, setName] = useState(saved.name ?? 'My Drum Kit')
  const [tag, setTag] = useState(saved.tag ?? '')
  const [outDir, setOutDir] = useState(saved.outDir ?? '')
  const [picks, setPicks] = useState<Picks>({ ...emptyPicks(), ...(saved.picks ?? {}) })
  const [targets, setTargets] = useState<Record<SlotId, number>>({ ...defaultTargets(), ...(saved.targets ?? {}) })
  const [slot, setSlot] = useState<SlotId>('kicks')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => { if (!outDir) window.api.kitDefaults().then((d) => setOutDir(d.outDir)) }, [outDir])
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, tag, outDir, picks, targets })) } catch { /* private mode */ } }, [name, tag, outDir, picks, targets])
  useEffect(() => {
    const a = new Audio()
    audio.current = a
    a.addEventListener('ended', () => setPlaying(null))
    a.addEventListener('pause', () => setPlaying(null))
    return () => { a.pause(); a.src = '' }
  }, [])

  const cands = useMemo(() => candidates(data?.items ?? [], data?.dirs ?? []), [data])
  const byId = useMemo(() => new Map((data?.items ?? []).map((s) => [s.id, s])), [data])
  // picks whose file has since left the library are dropped from the count and the export
  const live = useMemo(() => Object.fromEntries(KIT_SLOTS.map((s) => [s.id, picks[s.id].filter((p) => byId.has(p.id))])) as unknown as Picks, [picks, byId])
  const total = KIT_SLOTS.reduce((n, s) => n + live[s.id].length, 0)
  const picked = useMemo(() => new Set(live[slot].map((p) => p.id)), [live, slot])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const all = cands[slot]
    return (t ? all.filter((s) => s.n.toLowerCase().includes(t) || (data?.dirs[s.d] ?? '').toLowerCase().includes(t)) : all).slice(0, 400)
  }, [cands, slot, q, data])

  const play = useCallback((id: number) => {
    const a = audio.current!
    if (playing === id) { a.pause(); return }
    onPauseMain()
    a.src = `shqa://sound/${id}`
    a.currentTime = 0
    a.play().then(() => setPlaying(id)).catch(() => {})
  }, [onPauseMain, playing])

  const toggle = (s: SoundRow) => setPicks((p) => {
    const cur = p[slot]
    return { ...p, [slot]: cur.some((x) => x.id === s.id) ? cur.filter((x) => x.id !== s.id) : [...cur, { id: s.id, auto: false }] }
  })
  const fill = () => setPicks((p) => autoFill(p, cands, targets))
  const reroll = () => setPicks((p) => autoFill(clearAuto(p), cands, targets))
  const clear = () => { if (!total || confirm('Clear every pick in this kit?')) setPicks(emptyPicks()) }

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

  const preview = useMemo(() => planKit(live, byId, tag).filter((f) => f.slot === slot).slice(0, 3).map((f) => f.name), [live, byId, tag, slot])
  const missingTag = !tag.trim()

  return (
    <section className="sales pl2 km">
      <div className="sales-head">
        <h2>Kit Maker</h2>
        <span className="dim">{total} sounds in “{cleanName(name) || 'My Drum Kit'}”</span>
        <div className="grow" />
        <button onClick={fill} title="Fill empty spots in every folder up to its target with random sounds">Auto-fill</button>
        <button onClick={reroll} title="Replace the auto-picked sounds with new ones. Your own picks stay.">Re-roll</button>
        <button onClick={clear} disabled={!total}>Clear</button>
        <button className="primary" onClick={exportKit} disabled={busy || !total}>{busy ? 'Saving…' : 'Export kit'}</button>
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
          <input placeholder={`Search ${cands[slot].length.toLocaleString()} ${KIT_SLOTS.find((s) => s.id === slot)!.folder.toLowerCase()} in your library…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="km-target">Auto-fill target
            <input type="number" min={0} max={200} value={targets[slot]} onChange={(e) => setTargets((t) => ({ ...t, [slot]: Math.max(0, Math.min(200, Number(e.target.value) || 0)) }))} />
          </label>
          {preview.length > 0 && <span className="dim km-prev">Exports as {preview.join(' · ')}{live[slot].length > 3 ? ' …' : ''}</span>}
        </div>

        <div className="km-list">
          {!data && <div className="empty">Loading your library…</div>}
          {data && !list.length && <div className="empty">{cands[slot].length ? 'No sounds match.' : 'No WAV sounds of this type in your library yet.'}</div>}
          {list.map((s) => {
            const on = picked.has(s.id)
            const auto = on && live[slot].find((p) => p.id === s.id)?.auto
            return (
              <div key={s.id} className={`km-row ${on ? 'on' : ''}`}>
                <button className="km-play" onClick={() => play(s.id)} aria-label="Preview">{playing === s.id ? '❚❚' : '▶'}</button>
                <span className="sname" title={s.n}>{s.n}</span>
                <span className="dim sfolder" title={data!.dirs[s.d]}>{data!.dirs[s.d].split('/').slice(-2).join(' / ')}</span>
                <span className="mono dim r">{fmtLen(s.u)}</span>
                <button className={on ? 'primary' : ''} onClick={() => toggle(s)}>{on ? (auto ? 'Auto ✓' : 'Added ✓') : 'Add'}</button>
              </div>
            )
          })}
          {data && cands[slot].length > list.length && !q && <div className="empty dim">Showing the first {list.length}. Search to narrow it down.</div>}
        </div>
      </div>
    </section>
  )
}
