import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Beat, SiteEntry, SiteRowState, SiteStatus } from '@shared/types'
import { AddToStoreDialog } from './AddToStoreDialog'
import { errMsg } from './salesUtils'
import { moveId } from './storeUtils'
import { ArrowDown, ArrowUp, ExternalLink, Eye, GripVertical, Plus, TriangleAlert, Trash2, Upload } from 'lucide-react'
import { useReducedMotion, useScroll } from 'framer-motion'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/lib/carousel'
import { ScrollArea } from '@/components/lib/scroll-area'
import { TooltipProvider } from '@/components/lib/tooltip'
import { StickyCard } from '@/components/lib/skiper-ui/sticky-card'
import { SiteCard } from './SiteCard'
import { Art, Button, Roll, Seg, Tip } from './salesUi'
import './sales.css'

const STATE_LABEL: Record<SiteRowState, string> = { live: 'Live', changed: 'Changed', missing: 'File missing', sold: 'Sold exclusively' }

/** The public beat site: what is on it, in what order, and whether it needs publishing. */
export function Store({ beats, toast, openSettings, onChanged }: { beats: Beat[]; toast: (m: string) => void; openSettings: () => void; onChanged?: (s: SiteStatus) => void }) {
  const [st, setSt] = useState<SiteStatus | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const [needsLink, setNeedsLink] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [drag, setDrag] = useState<number | null>(null)
  const [cur, setCur] = useState<number | null>(null)
  const [rtab, setRtab] = useState<'site' | 'beat'>('site')
  const railRef = useRef<HTMLDivElement>(null)
  const railStack = useRef<HTMLDivElement>(null)
  const still = useReducedMotion()
  const { scrollYProgress } = useScroll({ container: railRef, target: railStack, offset: ['start start', 'end end'] })

  const load = useCallback(async () => { const s = await window.api.siteStatus(); setSt(s); onChanged?.(s) }, [onChanged])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.api.onSiteProgress((s) => setBusy(s)), [])
  // the assistant (or anything else) may change the site while this view is open
  useEffect(() => window.api.onBeatsChanged(() => { void load() }), [load])

  const entries = st?.entries ?? []
  const shown = useMemo(() => (needsLink ? entries.filter((e) => e.noLink) : entries), [entries, needsLink])
  const noLinkCount = entries.filter((e) => e.noLink).length
  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label); setError('')
    try { await fn(); if (done) toast(done) } catch (e) { setError(errMsg(e)) }
    setBusy(''); await load()
  }
  const order = entries.map((e) => e.beatId)
  const reorder = (ids: number[]) => run('', () => window.api.siteReorder(ids))
  const save = (e: SiteEntry, patch: Parameters<typeof window.api.siteUpdate>[1]) => run('', () => window.api.siteUpdate(e.beatId, patch))
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const drop = (target: number) => {
    if (drag == null || drag === target) return
    const ids = order.filter((x) => x !== drag)
    ids.splice(ids.indexOf(target), 0, drag)
    setDrag(null)
    void reorder(ids)
  }
  const remove = () => {
    if (!confirm(`Take ${sel.size} beat${sel.size === 1 ? '' : 's'} off the site? They come off the live page the next time you publish.`)) return
    void run('', () => window.api.siteRemoveMany([...sel]), 'Removed. Publish to update the live site.').then(() => setSel(new Set()))
  }

  if (!st) return null
  const curBeat = cur != null ? beats.find((b) => b.id === cur) : undefined
  const live = entries.filter((e) => e.state === 'live').length
  const stateCls = (x: SiteEntry['state']) => (x === 'live' ? 'ok' : x === 'sold' ? 'out' : x === 'missing' ? 'bad' : 'warn')
  return (
    <TooltipProvider delay={120}>
      <section className="sl">
        <div className="sl-tools">
          <h2 className="sl-disp">Store</h2>
          <span className="sl-dim">{entries.length} beat{entries.length === 1 ? '' : 's'} on the site{st.pending ? ' · changes not published' : ''}</span>
          <span className="sl-sp" />
          <Button variant="outline" onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add beats</Button>
          <Button variant="outline" disabled={!!busy || !entries.length} onClick={() => run('Building…', () => window.api.siteBuildPreview())}><Eye data-icon="inline-start" />Preview</Button>
          {st.url && <Button variant="outline" onClick={() => window.api.openExternal(st.url!)}><ExternalLink data-icon="inline-start" />Open site</Button>}
          <span title={st.hasToken ? '' : 'Add your Netlify token in Settings first'}>
            <Button disabled={!!busy || !st.hasToken} onClick={() => run('Publishing…', () => window.api.sitePublish(), 'Site updated.')}><Upload data-icon="inline-start" />{busy || (st.pending ? 'Publish changes' : 'Republish')}</Button>
          </span>
        </div>
        <div className="sl-split">
          <div className="sl-list">
            {!st.hasToken && <div className="sl-note warn"><TriangleAlert aria-hidden="true" /><span>Publishing needs your Netlify token. You can still edit and preview.</span><Button variant="outline" size="sm" onClick={openSettings}>Open Settings</Button></div>}
            {error && <div className="sl-note warn"><TriangleAlert aria-hidden="true" /><span>{error}</span></div>}
            <div className="sl-subbar">
              <label className="sl-chk"><input type="checkbox" checked={needsLink} onChange={(e) => setNeedsLink(e.target.checked)} /> Needs a link{noLinkCount ? ` (${noLinkCount})` : ''}</label>
              <span className="sl-sp" />
              {sel.size > 0 && <Button variant="destructive" size="sm" onClick={remove}><Trash2 data-icon="inline-start" />Remove {sel.size} from site</Button>}
            </div>
            <div className="sl-thead sl-st-grid"><span /><span>#</span><span>Title on the site</span><span>Genre</span><span>BeatStars link</span><span>Status</span><span /></div>
            <ScrollArea className="sl-rows">
              {shown.map((e) => {
                const i = order.indexOf(e.beatId)
                return (
                  <div key={e.beatId} className={`sl-row sl-st-grid${drag === e.beatId ? ' drag' : ''}${cur === e.beatId ? ' cur' : ''}`} draggable={!needsLink}
                    onClick={() => { setCur(e.beatId); setRtab('beat') }}
                    onDragStart={() => setDrag(e.beatId)} onDragOver={(ev) => ev.preventDefault()} onDrop={() => drop(e.beatId)} onDragEnd={() => setDrag(null)}>
                    <span className="sl-grip"><GripVertical aria-hidden="true" /><input type="checkbox" checked={sel.has(e.beatId)} onClick={(ev) => ev.stopPropagation()} onChange={() => toggle(e.beatId)} aria-label={`Select ${e.title}`} /></span>
                    <span className="sl-dim sl-mono">{i + 1}</span>
                    <span className="sl-beat"><Art name={e.title} size={28} /><input className="sl-in" defaultValue={e.title} key={`t${e.beatId}${e.title}`} aria-label="Title on the site" onClick={(ev) => ev.stopPropagation()} onBlur={(ev) => ev.target.value.trim() !== e.title && save(e, { title: ev.target.value })} /></span>
                    <input className="sl-in" defaultValue={e.genre} key={`g${e.beatId}${e.genre}`} placeholder="Trap, Afro…" aria-label="Genre" onClick={(ev) => ev.stopPropagation()} onBlur={(ev) => ev.target.value.trim() !== e.genre && save(e, { genre: ev.target.value })} />
                    <input className="sl-in" defaultValue={e.link} key={`l${e.beatId}${e.link}`} placeholder="Blank = your store link" aria-label="BeatStars link" onClick={(ev) => ev.stopPropagation()} onBlur={(ev) => ev.target.value.trim() !== e.link && save(e, { link: ev.target.value })} />
                    <span className="sl-sts"><em className={`sl-pill ${stateCls(e.state)}`}>{STATE_LABEL[e.state]}</em>{e.noLink && <em className="sl-dim"> · No link</em>}</span>
                    <span className="sl-act" onClick={(ev) => ev.stopPropagation()}>
                      <Tip label="Move up"><Button variant="ghost" size="icon-sm" disabled={i <= 0 || needsLink} aria-label={`Move ${e.title} up`} onClick={() => reorder(moveId(order, e.beatId, -1))}><ArrowUp /></Button></Tip>
                      <Tip label="Move down"><Button variant="ghost" size="icon-sm" disabled={i >= order.length - 1 || needsLink} aria-label={`Move ${e.title} down`} onClick={() => reorder(moveId(order, e.beatId, 1))}><ArrowDown /></Button></Tip>
                    </span>
                  </div>
                )
              })}
              {!shown.length && <div className="sl-empty"><b>{entries.length ? 'Every beat has its own link.' : 'Nothing on the site yet.'}</b>{!entries.length && 'Use Add beats.'}</div>}
            </ScrollArea>
            <div className="sl-tfoot">{entries.length} on the site · {live} live · {noLinkCount} without their own link (they use your store link) · Drag a row, or use the arrows, to reorder</div>
          </div>
          <aside className="sl-rail" ref={railRef} aria-label="Site">
            <Seg tabs label="Rail" value={rtab} onChange={setRtab} options={[{ v: 'site', label: 'Overview' }, { v: 'beat', label: 'Selected beat' }]} />
            {rtab === 'site' ? (
              <div className="sl-lstack" ref={railStack}>
                <StickyCard i={0} offset={110} progress={scrollYProgress} range={[0, 1]} targetScale={still ? 1 : 0.97} className="sl-lc-wrap">
                  <div className="sl-lc sl-site">
                    <span className={`sl-pill ${st.pending ? 'warn' : 'ok'}`}>{st.pending ? 'Changes not published' : 'Live and up to date'}</span>
                    <b className="sl-big"><Roll value={entries.length} /> beat{entries.length === 1 ? '' : 's'}</b>
                    {st.url ? <a className="sl-dim" onClick={() => window.api.openExternal(st.url!)}>{st.url.replace(/^https?:\/\//, '')}</a> : <span className="sl-dim">No site address yet</span>}
                  </div>
                </StickyCard>
                <StickyCard i={1} offset={110} progress={scrollYProgress} range={[0, 1]} targetScale={1} className="sl-lc-wrap">
                  <div className="sl-lc">
                    <div className="sl-lh"><b>On the site</b><span className="sl-dim">{entries.length} beat{entries.length === 1 ? '' : 's'}</span></div>
                    {entries.length ? (
                      <Carousel opts={{ align: 'start', dragFree: true }} className="sl-car">
                        <CarouselContent>
                          {entries.map((e) => (
                            <CarouselItem key={e.beatId} className="sl-pc" onClick={() => { setCur(e.beatId); setRtab('beat') }}>
                              <Art name={e.title} size={110} /><b className="sl-ell">{e.title}</b><small className="sl-dim sl-ell">{e.genre || 'No genre'}</small>
                            </CarouselItem>
                          ))}
                        </CarouselContent>
                        <CarouselPrevious /><CarouselNext />
                      </Carousel>
                    ) : <p className="sl-help">Beats you add show up here as they will on the site.</p>}
                  </div>
                </StickyCard>
              </div>
            ) : curBeat ? (
              <div className="sl-lc sl-site"><b className="sl-big">{curBeat.title}</b><SiteCard beat={curBeat} /></div>
            ) : <div className="sl-empty"><b>Pick a beat</b>Click a row to edit how it shows on the site.</div>}
          </aside>
        </div>
        {adding && <AddToStoreDialog beats={beats} onSite={new Set(order)} onClose={() => setAdding(false)} onAdded={(n) => { setAdding(false); toast(`Added ${n} beat${n === 1 ? '' : 's'}. Publish when you are ready.`); void load() }} />}
      </section>
    </TooltipProvider>
  )
}
