import { useEffect, useState } from 'react'
import type { BeatDetail, Pitch, Release, ReleaseStep, Sale, SplitGroup, StepId, StepState } from '@shared/types'
import { clickable } from './a11y'
import { SiteCard } from './SiteCard'
import { STEP_LABEL, rowButton, type StepAction } from './releaseUi'
import { fmtDay, money } from './salesUtils'

const MARK: Record<StepState, string> = { done: '✓', doing: '●', todo: '○', na: '–' }
const WORD: Record<StepState, string> = { done: 'Done', doing: 'In progress', todo: 'To do', na: 'Not applicable' }
const EXPANDS: StepId[] = ['store', 'pitch', 'sale', 'splits']
const near100 = (n: number) => Math.abs(n - 100) <= 0.01

interface Props {
  beat: BeatDetail
  pitchedTo: { pitch: Pitch; contact: string; response: '' | 'liked' | 'passed' }[]
  sales: Sale[]
  splitGroup?: SplitGroup
  /** changes whenever something that feeds the checklist changes, so it reloads */
  reloadKey: string
  on: Record<Exclude<StepAction, 'store'>, () => void>
  onSheet: () => void
  onOpenContact: (id: number) => void
}

/** Where this beat is across Store, Video, Post, Pitch, Feedback, Splits and Sale. Every button opens a screen or dialog the app already has. */
export function ReleaseCard(p: Props) {
  const { beat } = p
  const [rel, setRel] = useState<Release | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState<Set<StepId>>(new Set())

  useEffect(() => {
    let live = true // a late answer for a beat that is no longer selected is dropped
    setFailed(false)
    window.api.releaseGet(beat.id).then((r) => { if (live) setRel(r) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [beat.id, p.reloadKey, tick])
  useEffect(() => {
    const again = () => setTick((t) => t + 1)
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [])

  const shown = rel && rel.beatId === beat.id ? rel : null
  const soldExclusively = p.sales.some((s) => s.exclusive)
  const toggle = (id: StepId) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n })
  const press = (a: StepAction) => { if (a === 'store') setOpen((o) => new Set(o).add('store')); else { p.on[a](); setTick((t) => t + 1) } }

  const body = (s: ReleaseStep) => {
    if (s.id === 'store') return <SiteCard beat={beat} />
    if (s.id === 'pitch') return p.pitchedTo.length ? (
      <div>{p.pitchedTo.map(({ pitch, contact, response }) => (
        <div key={pitch.id} className="ver" style={{ gridTemplateColumns: '1fr auto auto' }} {...clickable(() => p.onOpenContact(pitch.contactId))}>
          <span>{contact}</span><span className="dim">{new Date(pitch.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span className={`pst ps-${pitch.status}`}>{response === 'liked' ? '♥ ' : response === 'passed' ? '✕ ' : ''}{pitch.status}</span>
        </div>
      ))}</div>
    ) : <div className="meta-line" style={{ marginTop: 0 }}>Not pitched to anyone yet.</div>
    if (s.id === 'sale') return p.sales.length ? (
      <div>{p.sales.map((x) => (
        <div key={x.id} className="ver" style={{ gridTemplateColumns: '1fr auto auto' }}>
          <span>{x.exclusive ? '🔒 ' : ''}{x.licenseName} · {x.buyer}</span><span className="dim">{fmtDay(x.soldAt)}</span><span className="mono">{money(x.price)}</span>
        </div>
      ))}</div>
    ) : <div className="meta-line" style={{ marginTop: 0 }}>No sales logged yet.</div>
    const g = p.splitGroup
    return g?.parties ? (
      <div>
        <div className="meta-line" style={{ marginTop: 0 }}>
          Publishing {g.pubTotal}% · Master {g.masterTotal}%{(!near100(g.pubTotal) || !near100(g.masterTotal)) && <span className="warn"> (not 100%)</span>}
          {g.sheetAt ? ` · sheet ${fmtDay(g.sheetAt)}` : ''}
        </div>
        <div className="actions" style={{ marginTop: 6 }}>
          <button onClick={p.onSheet} disabled={!near100(g.pubTotal) || !near100(g.masterTotal)}>Split sheet PDF</button>
        </div>
      </div>
    ) : <div className="meta-line" style={{ marginTop: 0 }}>No collaborators recorded. You own 100% by default.</div>
  }

  return (
    <div className="field rel-card">
      <label>Release{shown ? ` · ${shown.done} of ${shown.total} done` : ''}</label>
      {failed && <div className="meta-line warn" style={{ marginTop: 0 }}>Couldn't load the release status. <button onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      {shown?.steps.map((s) => {
        const btn = rowButton(s, beat.status, soldExclusively)
        const expandable = EXPANDS.includes(s.id)
        const isOpen = open.has(s.id)
        return (
          <div key={s.id}>
            <div className="rel-row">
              <span className={`rel-mark ${s.state}`} role="img" aria-label={WORD[s.state]}>{MARK[s.state]}</span>
              <div className="rel-main" {...(expandable ? { ...clickable(() => toggle(s.id)), 'aria-expanded': isOpen } : {})}>
                <b>{STEP_LABEL[s.id]}</b><span className="dim">{s.summary}</span>
              </div>
              {btn && <div className="rel-act"><button disabled={btn.disabled} onClick={() => press(btn.action)}>{btn.label}</button></div>}
            </div>
            {expandable && isOpen && <div className="rel-body">{body(s)}</div>}
          </div>
        )
      })}
    </div>
  )
}
