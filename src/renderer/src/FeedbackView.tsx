import { useEffect, useMemo, useState } from 'react'
import type { Beat, BeatDetail, FeedbackData, FeedbackLink } from '@shared/types'
import { clickable } from './a11y'
import { Waveform } from './Waveform'
import { copy } from './crmUtils'
import { fmtDur } from './format'
import { errMsg } from './salesUtils'

interface Props {
  data: FeedbackData
  beats: Beat[]
  onNew: () => void
  onPlayAt: (beatId: number, at: number) => void
  reload: () => void
  toast: (m: string) => void
}

const ago = (ms: number) => { const m = Math.floor((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago` }

export function FeedbackView({ data, beats, onNew, onPlayAt, reload, toast }: Props) {
  const [slug, setSlug] = useState<string | null>(data.links[0]?.slug ?? null)
  const [syncing, setSyncing] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [peaks, setPeaks] = useState<Record<number, number[]>>({})
  const link: FeedbackLink | undefined = data.links.find((l) => l.slug === slug) ?? data.links[0]
  const mine = useMemo(() => data.comments.filter((c) => c.slug === link?.slug), [data.comments, link?.slug])
  const unseen = (s: string) => data.comments.filter((c) => c.slug === s && !c.seen).length

  useEffect(() => { if (!slug && data.links[0]) setSlug(data.links[0].slug) }, [data.links, slug])
  useEffect(() => {
    if (!link) return
    link.beats.forEach((b) => { if (!peaks[b.beatId]) window.api.getBeat(b.beatId).then((d: BeatDetail | null) => d && setPeaks((p) => ({ ...p, [b.beatId]: d.peaks }))) })
    const t = setTimeout(() => { mine.filter((c) => !c.seen).forEach((c) => window.api.feedbackUpdate(c.id, { seen: true })) }, 1800)
    return () => clearTimeout(t)
  }, [link?.slug, mine.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => {
    setSyncing(true)
    const r = await window.api.feedbackSync()
    setSyncing(false)
    toast(r.error ? r.error : r.added ? `${r.added} new comment${r.added > 1 ? 's' : ''}` : 'No new comments')
    reload()
  }

  return (
    <section className="sales">
      <div className="sales-head">
        <h2>Feedback</h2>
        <div className="grow" />
        <button onClick={sync} disabled={syncing}>{syncing ? 'Checking…' : 'Sync now'}</button>
        <button className="primary" onClick={onNew}>+ New feedback link</button>
      </div>
      {!data.links.length ? (
        <div className="empty" style={{ padding: '60px 28px' }}>
          <p>Send an artist a private link to a beat. They listen and leave comments pinned to the exact second, and the comments show up here.</p>
          <button className="primary" onClick={onNew}>Create your first feedback link</button>
        </div>
      ) : (
        <div className="cv-split">
          <div className="cv-list">
            <div className="cv-rows">
              {data.links.map((l) => (
                <div key={l.id} className={`cv-row ${link?.slug === l.slug ? 'sel' : ''}`} {...clickable(() => setSlug(l.slug))}>
                  <div className="cn"><b>{l.title}</b>{unseen(l.slug) > 0 && <span className="badge">{unseen(l.slug)}</span>}</div>
                  <div className="sub">{l.beats.map((b) => b.title).join(', ')}</div>
                  <div className="dim small-note">{data.comments.filter((c) => c.slug === l.slug).length} comments · {l.url ? 'published' : 'local only'}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="cv-work">
            {link && (
              <>
                <div className="cv-beat"><h3>{link.title}</h3>
                  {link.url ? <><button onClick={() => copy(link.url!)}>Copy link</button><button onClick={() => window.api.openExternal(link.url!)}>Open</button></> : <span className="dim">Not published (no link to share yet)</span>}
                  <div className="grow" />
                  <label className="check small"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
                </div>
                {link.beats.map((b, i) => {
                  const cs = mine.filter((c) => c.beatIndex === i && (showResolved || !c.resolved)).sort((x, y) => x.time - y.time)
                  const dur = b.duration ?? 0
                  return (
                    <div key={b.beatId} className="panel" style={{ marginBottom: 14 }}>
                      <div className="panel-head"><h3>{b.title}</h3><span className="dim">{cs.length} comment{cs.length === 1 ? '' : 's'}</span></div>
                      <Waveform peaks={peaks[b.beatId] ?? []} progress={0} height={48} markers={dur ? cs.map((c) => Math.min(1, c.time / dur)) : []} onSeek={(f) => dur && onPlayAt(b.beatId, f * dur)} />
                      <div className="fb-list">
                        {cs.map((c) => (
                          <div key={c.id} className={`fb ${c.resolved ? 'done' : ''} ${c.seen ? '' : 'new'}`}>
                            <button className="tchip" onClick={() => onPlayAt(b.beatId, Math.max(0, c.time - 2))} title="Play from 2 seconds before">▶ {fmtDur(c.time)}</button>
                            <div className="fbtext"><b>{c.name || 'Anonymous'}</b> <span className="dim">{ago(c.createdAt)}</span><div>{c.text}</div></div>
                            <button className="ghost" onClick={async () => { try { await window.api.feedbackUpdate(c.id, { resolved: !c.resolved }); reload() } catch (e) { toast(errMsg(e)) } }}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
                          </div>
                        ))}
                        {!cs.length && <p className="help">No comments on this beat yet.</p>}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
