import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Beat, SiteEntry, SiteRowState, SiteStatus } from '@shared/types'
import { AddToStoreDialog } from './AddToStoreDialog'
import { errMsg } from './salesUtils'
import { moveId } from './storeUtils'

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

  const load = useCallback(async () => { const s = await window.api.siteStatus(); setSt(s); onChanged?.(s) }, [onChanged])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.api.onSiteProgress((s) => setBusy(s)), [])

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
  return (
    <section className="sales">
      <div className="sales-head">
        <h2>Store</h2>
        <span className="dim">{entries.length} beat{entries.length === 1 ? '' : 's'} on the site{st.pending ? ' · changes not published' : ''}</span>
        <div className="grow" />
        <button onClick={() => setAdding(true)}>+ Add beats</button>
        <button disabled={!!busy || !entries.length} onClick={() => run('Building…', () => window.api.siteBuildPreview())}>Preview</button>
        <button className="primary" disabled={!!busy || !st.hasToken} title={st.hasToken ? '' : 'Add your Netlify token in Settings first'} onClick={() => run('Publishing…', () => window.api.sitePublish(), 'Site updated.')}>
          {busy || (st.pending ? 'Publish changes' : 'Republish')}
        </button>
        {st.url && <button onClick={() => window.api.openExternal(st.url!)}>Open site</button>}
      </div>
      <div className="sales-body">
        {!st.hasToken && <div className="meta-line" style={{ marginTop: 0 }}>Publishing needs your Netlify token. You can still edit and preview. <button onClick={openSettings}>Open Settings</button></div>}
        {error && <div className="meta-line warn">{error}</div>}
        <div className="subbar" style={{ padding: '0 0 10px' }}>
          <label className="check small"><input type="checkbox" checked={needsLink} onChange={(e) => setNeedsLink(e.target.checked)} /> Needs a link{noLinkCount ? ` (${noLinkCount})` : ''}</label>
          <div className="grow" />
          {sel.size > 0 && <button onClick={remove}>Remove {sel.size} from site</button>}
        </div>
        <div className="stable">
          <div className="srow shead store-grid"><span /><span>#</span><span>Title on the site</span><span>Genre</span><span>BeatStars link</span><span>Status</span><span /></div>
          {shown.map((e) => {
            const i = order.indexOf(e.beatId)
            return (
              <div key={e.beatId} className={`srow store-grid ${drag === e.beatId ? 'sel' : ''}`} draggable
                onDragStart={() => setDrag(e.beatId)} onDragOver={(ev) => ev.preventDefault()} onDrop={() => drop(e.beatId)} onDragEnd={() => setDrag(null)}>
                <input type="checkbox" checked={sel.has(e.beatId)} onChange={() => toggle(e.beatId)} style={{ width: 'auto' }} aria-label={`Select ${e.title}`} />
                <span className="dim mono">{i + 1}</span>
                <input defaultValue={e.title} key={`t${e.beatId}${e.title}`} aria-label="Title on the site" onBlur={(ev) => ev.target.value.trim() !== e.title && save(e, { title: ev.target.value })} />
                <input defaultValue={e.genre} key={`g${e.beatId}${e.genre}`} placeholder="Trap, Afro…" aria-label="Genre" onBlur={(ev) => ev.target.value.trim() !== e.genre && save(e, { genre: ev.target.value })} />
                <input defaultValue={e.link} key={`l${e.beatId}${e.link}`} placeholder="Blank = your store link" aria-label="BeatStars link" onBlur={(ev) => ev.target.value.trim() !== e.link && save(e, { link: ev.target.value })} />
                <span>
                  <em className={e.state === 'live' ? 'dim' : 'excl'} style={{ fontStyle: 'normal' }}>{STATE_LABEL[e.state]}</em>
                  {e.noLink && <em className="dim" style={{ fontStyle: 'normal' }}> · No link</em>}
                </span>
                <span className="sact">
                  <button disabled={i <= 0 || needsLink} aria-label={`Move ${e.title} up`} onClick={() => reorder(moveId(order, e.beatId, -1))}>↑</button>
                  <button disabled={i >= order.length - 1 || needsLink} aria-label={`Move ${e.title} down`} onClick={() => reorder(moveId(order, e.beatId, 1))}>↓</button>
                </span>
              </div>
            )
          })}
          {!shown.length && <div className="empty">{entries.length ? 'Every beat has its own link.' : 'Nothing on the site yet. Use + Add beats.'}</div>}
        </div>
      </div>
      {adding && <AddToStoreDialog beats={beats} onSite={new Set(order)} onClose={() => setAdding(false)} onAdded={(n) => { setAdding(false); toast(`Added ${n} beat${n === 1 ? '' : 's'}. Publish when you are ready.`); void load() }} />}
    </section>
  )
}
