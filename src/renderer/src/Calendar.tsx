import { useMemo, useState } from 'react'
import { PLATFORMS, type Beat, type ContentData, type Platform, type Post, type Sale } from '@shared/types'
import { DAY, nextFreeDate, platformColor, platformLabel, startOfDay, suggest } from './suggest'
import { errMsg } from './salesUtils'

interface Props {
  beats: Beat[]
  content: ContentData
  sales: Sale[]
  onEditPost: (p: Post) => void
  onNewPost: (date: number) => void
  onMakeVideo: (beatId: number) => void
  reload: () => void
  toast: (m: string) => void
}

export function Calendar({ beats, content, sales, onEditPost, onNewPost, onMakeVideo, reload, toast }: Props) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [plat, setPlat] = useState<Platform>('tiktok')
  const title = (id: number) => beats.find((b) => b.id === id)?.title ?? '(removed beat)'
  const today = startOfDay(Date.now())

  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const offset = (first.getDay() + 6) % 7 // weeks start Monday
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [month])
  const byDay = useMemo(() => {
    const m = new Map<number, Post[]>()
    for (const p of content.posts) { const k = startOfDay(p.date); (m.get(k) ?? m.set(k, []).get(k)!).push(p) }
    return m
  }, [content.posts])

  const sugg = useMemo(() => suggest(beats, content, sales, plat).slice(0, 5), [beats, content, sales, plat])
  const lastPosted = (p: Platform) => { const ps = content.posts.filter((x) => x.platform === p && x.status === 'posted'); return ps.length ? Math.floor((Date.now() - Math.max(...ps.map((x) => x.date))) / DAY) : null }
  const move = async (p: Post, day: number) => {
    if (startOfDay(p.date) === day) return
    try { await window.api.savePost({ ...p, date: day }); reload() } catch (e) { toast(errMsg(e)) }
  }
  const overdue = content.posts.filter((p) => p.status === 'planned' && startOfDay(p.date) < today).length

  return (
    <div className="cal-wrap">
      <div className="cal">
        <div className="cal-head">
          <h3>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Today</button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
          <div className="grow" />
          {overdue > 0 && <span className="warn">{overdue} planned post{overdue > 1 ? 's' : ''} overdue</span>}
          <div className="legend">{PLATFORMS.filter((p) => p.id !== 'other').map((p) => <span key={p.id}><i className="sw" style={{ background: p.color }} />{p.label}</span>)}</div>
        </div>
        <div className="cal-grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {grid.map((d) => {
            const key = startOfDay(d.getTime())
            const posts = byDay.get(key) ?? []
            return (
              <div key={key} className={`cal-day ${d.getMonth() !== month.getMonth() ? 'out' : ''} ${key === today ? 'today' : ''}`}
                onClick={() => onNewPost(key)} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { const id = +e.dataTransfer.getData('text/post'); const p = content.posts.find((x) => x.id === id); if (p) move(p, key) }}>
                <span className="dnum">{d.getDate()}</span>
                {posts.slice(0, 3).map((p) => (
                  <div key={p.id} draggable className={`pchip ${p.status} ${p.status === 'planned' && key < today ? 'late' : ''}`} style={{ ['--pc' as string]: platformColor(p.platform) }}
                    title={`${platformLabel(p.platform)} · ${p.status}`} onDragStart={(e) => e.dataTransfer.setData('text/post', String(p.id))}
                    onClick={(e) => { e.stopPropagation(); onEditPost(p) }}>{title(p.beatId)}</div>
                ))}
                {posts.length > 3 && <div className="dim" style={{ fontSize: 11 }}>+{posts.length - 3} more</div>}
              </div>
            )
          })}
        </div>
        <p className="help">Click a day to plan or log a post. Drag a post to another day to reschedule it. Solid = posted, outlined = planned.</p>
      </div>

      <aside className="sugg">
        <h3>What to post next</h3>
        <div className="seg" style={{ flexWrap: 'wrap' }}>{PLATFORMS.filter((p) => p.id !== 'other').map((p) => <button key={p.id} className={plat === p.id ? 'on' : ''} onClick={() => setPlat(p.id)}>{p.label}</button>)}</div>
        <div className="help">{lastPosted(plat) == null ? `Nothing posted on ${platformLabel(plat)} yet.` : lastPosted(plat) === 0 ? 'Posted here today.' : `Last post here: ${lastPosted(plat)} day${lastPosted(plat) === 1 ? '' : 's'} ago.`}</div>
        {sugg.map(({ beat, reasons }) => (
          <div key={beat.id} className="scard">
            <b>{beat.title}</b>
            <div className="chips" style={{ background: 'transparent', border: 0, padding: 0 }}>{reasons.slice(0, 3).map((r) => <span key={r} className="chip">{r}</span>)}</div>
            <div className="pact">
              <button className="primary" onClick={async () => { try { await window.api.savePost({ beatId: beat.id, platform: plat, status: 'planned', date: nextFreeDate(content, plat) }); reload(); toast(`Planned “${beat.title}” for ${platformLabel(plat)}`) } catch (e) { toast(errMsg(e)) } }}>Plan it</button>
              <button onClick={() => onMakeVideo(beat.id)}>Make video</button>
            </div>
          </div>
        ))}
        {!sugg.length && <p className="help">No suggestions: everything finished has been posted here recently or is already planned. Finish more beats or plan further ahead.</p>}
      </aside>
    </div>
  )
}
