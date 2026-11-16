import { useEffect, useMemo, useState } from 'react'
import type { Beat, BeatDetail, FeedbackData, FeedbackLink } from '@shared/types'
import { clickable } from './a11y'
import { Waveform } from './Waveform'
import { copy } from './crmUtils'
import { fmtDur } from './format'
import { errMsg } from './salesUtils'
import { Plus, RefreshCw } from 'lucide-react'
import { ScrollArea } from '@/components/lib/scroll-area'
import { Button, ChartCard, Reveal, SPAN } from './reachUi'
import { ago, commentsSeries } from './feedbackSeries'
import type { MadePeriod } from './dashUtils'

interface Props {
  data: FeedbackData
  beats: Beat[]
  onNew: () => void
  onPlayAt: (beatId: number, at: number) => void
  reload: () => void
  toast: (m: string) => void
}

export function FeedbackView({ data, beats, onNew, onPlayAt, reload, toast }: Props) {
  const [slug, setSlug] = useState<string | null>(data.links[0]?.slug ?? null)
  const [syncing, setSyncing] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [period, setPeriod] = useState<MadePeriod>('Weekly')
  const [pop, setPop] = useState(false)
  const [now] = useState(() => Date.now())
  const [peaks, setPeaks] = useState<Record<number, number[]>>({})
  const link: FeedbackLink | undefined = data.links.find((l) => l.slug === slug) ?? data.links[0]
  const mine = useMemo(() => data.comments.filter((c) => c.slug === link?.slug), [data.comments, link?.slug])
  const ser = useMemo(() => commentsSeries(data.comments, period, now), [data.comments, period, now])
  const total = ser.data.reduce((a, b) => a + b, 0)
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
    <section className="rf">
      <aside className="rf-l" aria-label="Feedback links">
        <div className="rf-top">
          <div className="row">
            <h2>Feedback</h2>
            <Button variant="outline" size="sm" className="rx-narrow" onClick={() => setPop((v) => !v)}>Chart</Button>
            <Button variant="outline" size="sm" onClick={sync} disabled={syncing}><RefreshCw aria-hidden="true" />{syncing ? 'Checking…' : 'Sync now'}</Button>
          </div>
          <Button onClick={onNew}><Plus aria-hidden="true" />New feedback link</Button>
        </div>
        <div className="rf-sp" />
        <ScrollArea className="rf-rows h-full min-h-0">
          {data.links.map((l, i) => (
            <Reveal key={l.id} delay={Math.min(i, 8) * 0.03}>
              <button type="button" className="rf-link" aria-pressed={link?.slug === l.slug} onClick={() => setSlug(l.slug)}>
                <b>{l.title}{unseen(l.slug) > 0 && <span className="rf-badge" aria-label={`${unseen(l.slug)} unseen`}>{unseen(l.slug)}</span>}</b>
                <small>{l.beats.map((b) => b.title).join(', ')}</small>
                <small>{data.comments.filter((c) => c.slug === l.slug).length} comments · {l.url ? 'published' : 'local only'}</small>
              </button>
            </Reveal>
          ))}
        </ScrollArea>
      </aside>

      <div className="rf-w">
        {!data.links.length ? (
          <div className="pc-empty rf-empty">
            <b>No feedback links yet</b>
            <p>Send an artist a private link to a beat. They listen and leave comments pinned to the exact second, and the comments show up here.</p>
            <div><Button onClick={onNew}>Create your first feedback link</Button></div>
          </div>
        ) : link && (
          <>
            <div className="rf-head"><h3>{link.title}</h3>
              {link.url ? <><Button variant="outline" size="sm" onClick={() => copy(link.url!)}>Copy link</Button><Button variant="outline" size="sm" onClick={() => window.api.openExternal(link.url!)}>Open</Button></> : <span className="pc-help">Not published (no link to share yet)</span>}
              <div className="pc-sp" />
              <label className="rf-chk"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
            </div>
            {link.beats.map((b, i) => {
              const cs = mine.filter((c) => c.beatIndex === i && (showResolved || !c.resolved)).sort((x, y) => x.time - y.time)
              const dur = b.duration ?? 0
              return (
                <Reveal key={b.beatId} delay={Math.min(i, 4) * 0.05}>
                  <div className="rf-beat">
                    <header><h3>{b.title}</h3><span>{cs.length} comment{cs.length === 1 ? '' : 's'}</span></header>
                    <Waveform peaks={peaks[b.beatId] ?? []} progress={0} height={48} markers={dur ? cs.map((c) => Math.min(1, c.time / dur)) : []} onSeek={(f) => dur && onPlayAt(b.beatId, f * dur)} />
                    <div className="rf-cs">
                      {cs.map((c) => (
                        <div key={c.id} className={`rf-c${c.resolved ? ' done' : ''}${c.seen ? '' : ' new'}`}>
                          <Button variant="outline" size="xs" title="Play from 2 seconds before" onClick={() => onPlayAt(b.beatId, Math.max(0, c.time - 2))}>▶ {fmtDur(c.time)}</Button>
                          <div style={{ minWidth: 0 }}><b>{c.name || 'Anonymous'}</b><small>{ago(c.createdAt)}</small><p>{c.text}</p></div>
                          <Button variant="ghost" size="xs" onClick={async () => { try { await window.api.feedbackUpdate(c.id, { resolved: !c.resolved }); reload() } catch (e) { toast(errMsg(e)) } }}>{c.resolved ? 'Reopen' : 'Resolve'}</Button>
                        </div>
                      ))}
                      {!cs.length && <p className="pc-help" style={{ padding: 'var(--s3) var(--s4)' }}>No comments on this beat yet.</p>}
                    </div>
                  </div>
                </Reveal>
              )
            })}
          </>
        )}
      </div>

      <aside className={`rf-aside${pop ? ' pop' : ''}`} aria-label="Comments chart">
        <ChartCard label="Comments received" accent="--finished" data={ser.data} labels={ser.labels} value={total} period={period} onPeriod={setPeriod}
          title="Comments received" caption={SPAN[period]} updatedText={`${data.comments.filter((c) => !c.seen).length} unseen`} unit={(n) => `${n} comment${n === 1 ? '' : 's'}`} />
      </aside>
    </section>
  )
}
