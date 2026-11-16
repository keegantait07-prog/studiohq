import { useEffect, useState } from 'react'
import type { Beat, SiteStatus } from '@shared/types'
import { Button } from './salesUi'
import './sales.css'
import { errMsg } from './salesUtils'

/** "Beat site" section of the beat panel: send a beat to the public SMALLS site, edit how it shows there, or take it down. */
export function SiteCard({ beat }: { beat: Pick<Beat, 'id' | 'ext' | 'status'> }) {
  const [st, setSt] = useState<SiteStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  const entry = st?.entries.find((e) => e.beatId === beat.id)
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('')
  const [link, setLink] = useState('')
  const load = async () => setSt(await window.api.siteStatus())
  useEffect(() => { load(); setMsg(null) }, [beat.id])
  useEffect(() => { setTitle(entry?.title ?? ''); setGenre(entry?.genre ?? ''); setLink(entry?.link ?? '') }, [entry?.beatId, entry?.title, entry?.genre, entry?.link])
  useEffect(() => window.api.onSiteProgress((s) => setBusy(s)), [])

  const runJob = async (label: string, fn: () => Promise<string>, done: (url: string) => string) => {
    setBusy(label); setMsg(null)
    try { const url = await fn(); setMsg({ text: done(url) }) } catch (e) { setMsg({ text: errMsg(e), err: true }) }
    setBusy(''); load()
  }
  const save = async (p: Parameters<typeof window.api.siteUpdate>[1]) => { await window.api.siteUpdate(beat.id, p); load() }

  if (!st || beat.ext === 'flp') return null
  const url = st.url
  return (
    <div className="sl-sc">
      <label className="sl-lbl">Beat site {entry && <span className="sl-dim">live · {st.entries.findIndex((e) => e.beatId === beat.id) + 1} of {st.entries.length}</span>}</label>
      {!st.hasToken && <div className="sl-note warn">Add your Netlify token in Settings to publish the site.</div>}
      {!entry ? (
        <>
          <Button className="w-full" disabled={!!busy || !st.hasToken} onClick={() => runJob('Sending…', () => window.api.siteAdd(beat.id), (u) => `Live at ${u}. It's at the top of the beat log.`)}>
            {busy || 'Send to site'}
          </Button>
          {beat.status !== 'finished' && !busy && <div className="sl-note">This beat is marked “{beat.status}”. Send it anyway if it's ready to sell.</div>}
        </>
      ) : (
        <>
          <div className="sl-two">
            <div className="sl-fld"><label>Title on the site</label><input className="sl-in" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== entry.title && save({ title })} /></div>
            <div className="sl-fld"><label>Genre on the site</label><input className="sl-in" value={genre} placeholder="Trap, Afro…" onChange={(e) => setGenre(e.target.value)} onBlur={() => genre !== entry.genre && save({ genre })} /></div>
          </div>
          <div className="sl-fld"><label>This beat's BeatStars link</label><input className="sl-in" value={link} placeholder="Blank = your store link (Settings)" onChange={(e) => setLink(e.target.value)} onBlur={() => link !== entry.link && save({ link })} /></div>
          <div className="sl-row-acts">
            <Button disabled={!!busy} onClick={() => runJob('Publishing…', () => window.api.sitePublish(), () => 'Site updated.')}>{busy || (st.pending ? 'Publish changes' : 'Republish')}</Button>
            <Button variant="outline" disabled={!!busy} onClick={() => runJob('Removing…', () => window.api.siteRemove(beat.id), () => 'Taken off the site.')}>Remove from site</Button>
            {url && <Button variant="outline" onClick={() => window.api.openExternal(url)}>Open site</Button>}
          </div>
          {st.pending && !busy && <div className="sl-note">You have changes that aren't on the site yet.</div>}
        </>
      )}
      {msg && <div className={`sl-note ${msg.err ? 'warn' : ''}`}>{msg.text}</div>}
    </div>
  )
}
