import { useEffect, useState } from 'react'
import type { BeatDetail, SiteStatus } from '@shared/types'
import { errMsg } from './salesUtils'

/** "Beat site" section of the beat panel: send a beat to the public SMALLS site, edit how it shows there, or take it down. */
export function SiteCard({ beat }: { beat: BeatDetail }) {
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
    <div className="field site-card">
      <label>Beat site {entry && <span className="src">live · {st.entries.findIndex((e) => e.beatId === beat.id) + 1} of {st.entries.length}</span>}</label>
      {!st.hasToken && <div className="meta-line" style={{ marginTop: 0 }}>Add your Netlify token in Settings to publish the site.</div>}
      {!entry ? (
        <>
          <button className="wide primary" disabled={!!busy || !st.hasToken} onClick={() => runJob('Sending…', () => window.api.siteAdd(beat.id), (u) => `Live at ${u}. It's at the top of the beat log.`)}>
            {busy || 'Send to site'}
          </button>
          {beat.status !== 'finished' && !busy && <div className="meta-line">This beat is marked “{beat.status}”. Send it anyway if it's ready to sell.</div>}
        </>
      ) : (
        <>
          <div className="two">
            <div className="field"><label>Title on the site</label><input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== entry.title && save({ title })} /></div>
            <div className="field"><label>Genre on the site</label><input value={genre} placeholder="Trap, Afro…" onChange={(e) => setGenre(e.target.value)} onBlur={() => genre !== entry.genre && save({ genre })} /></div>
          </div>
          <div className="field"><label>This beat's BeatStars link</label><input value={link} placeholder="Blank = your store link (Settings)" onChange={(e) => setLink(e.target.value)} onBlur={() => link !== entry.link && save({ link })} /></div>
          <div className="actions" style={{ marginTop: 6 }}>
            <button className="primary" disabled={!!busy} onClick={() => runJob('Publishing…', () => window.api.sitePublish(), () => 'Site updated.')}>{busy || (st.pending ? 'Publish changes' : 'Republish')}</button>
            <button disabled={!!busy} onClick={() => runJob('Removing…', () => window.api.siteRemove(beat.id), () => 'Taken off the site.')}>Remove from site</button>
            {url && <button onClick={() => window.api.openExternal(url)}>Open site</button>}
          </div>
          {st.pending && !busy && <div className="meta-line">You have changes that aren't on the site yet.</div>}
        </>
      )}
      {msg && <div className={`meta-line ${msg.err ? 'warn' : ''}`}>{msg.text}</div>}
    </div>
  )
}
