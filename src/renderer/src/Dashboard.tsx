import { useMemo, useState } from 'react'
import type { Beat, ContentData, CrmData, FeedbackData, SalesData, Settings, Status, StudioSession } from '@shared/types'
import { isDue, daysSince } from './crmUtils'
import { useNow } from './useNow'
import { activity, beatsMadeSince, dayKey, DAY, fmtClock, fmtHM, isActive, sessionMs, startOfDay, streaks, weekStart } from './dashUtils'
import { money, net } from './salesUtils'
import { HEALTH } from './query'

type View = 'vault' | 'crm' | 'sales' | 'content' | 'sounds' | 'feedback'
interface Props {
  beats: Beat[]
  crm: CrmData | null
  content: ContentData
  sales: SalesData
  feedback: FeedbackData
  sessions: StudioSession[]
  settings: Settings | null
  onGo: (v: View) => void
  onOpenBeat: (id: number) => void
  onQuery: (q: string) => void
  onOpenContact: (id: number) => void
  onPitchBeat: (id: number) => void
  onMakeVideo: (id: number) => void
  onSetStatus: (id: number, s: Status) => void
  reloadSessions: () => void
}

function Goal({ label, value, goal, onGoal }: { label: string; value: number; goal: number; onGoal: (n: number) => void }) {
  const [edit, setEdit] = useState(false)
  const pct = Math.min(1, value / Math.max(1, goal))
  return (
    <div className="goal">
      <div className="gh"><span>{label}</span><span className="mono">{value} / {edit ? <input autoFocus defaultValue={goal} style={{ width: 44 }} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n > 0) onGoal(n); setEdit(false) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /> : <a onClick={() => setEdit(true)} title="Click to change your goal">{goal}</a>}</span></div>
      <div className="gtrack"><div className={`gfill ${pct >= 1 ? 'done' : ''}`} style={{ width: `${pct * 100}%` }} /></div>
    </div>
  )
}

const HEALTH_ROWS: { q: string; label: string; hint: string }[] = [
  { q: 'nobpm', label: 'missing a BPM', hint: 'bounces with no tempo' },
  { q: 'nokey', label: 'missing a key', hint: 'bounces with no key' },
  { q: 'untagged', label: 'with no vibe or genre', hint: 'harder to search and pitch' },
  { q: 'stale', label: 'stale WIPs', hint: 'untouched for 30+ days' },
  { q: 'noloop', label: 'FL projects with no preview', hint: 'play it once with the plugin on the Master' }
]

function CatalogHealth({ beats, onQuery }: { beats: Beat[]; onQuery: (q: string) => void }) {
  const rows = HEALTH_ROWS.map((r) => ({ ...r, n: beats.filter(HEALTH[r.q]).length }))
  const issues = rows.reduce((a, r) => a + r.n, 0)
  const audioN = beats.filter((b) => b.ext !== 'flp').length
  const score = audioN ? Math.round(100 * (1 - Math.min(1, rows.slice(0, 3).reduce((a, r) => a + r.n, 0) / (audioN * 3)))) : 100
  return (
    <div className="panel health">
      <h3>Catalog health <span className="hscore">{score}%</span></h3>
      <div className="gtrack"><div className={`gfill ${score >= 90 ? 'done' : ''}`} style={{ width: `${score}%` }} /></div>
      {issues === 0 ? <p className="dim">Everything is tagged and up to date.</p> : rows.filter((r) => r.n > 0).map((r) => (
        <div key={r.q} className="drow"><a onClick={() => onQuery(r.q)}>{r.n} {r.label}</a><span className="dim">{r.hint}</span></div>
      ))}
    </div>
  )
}

export function Dashboard(p: Props) {
  const { beats, crm, content, sales, feedback, sessions, settings } = p
  const now = useNow(1000)
  const wk = weekStart(now)
  const today0 = startOfDay(now)
  const act = useMemo(() => activity(beats, sessions, now), [beats, sessions, now])
  const { current, best } = useMemo(() => streaks(act, now), [act, now])
  const open = sessions.find((s) => s.endedAt == null)
  const todayMs = sessions.filter((s) => s.startedAt >= today0).reduce((a, s) => a + sessionMs(s, now), 0)
  const weekMs = sessions.filter((s) => s.startedAt >= wk).reduce((a, s) => a + sessionMs(s, now), 0)

  const madeWeek = beatsMadeSince(beats, wk)
  const pitchesWeek = crm ? crm.pitches.filter((x) => x.sentAt >= wk).length : 0
  const postsWeek = content.posts.filter((x) => x.status === 'posted' && x.date >= wk).length
  const due = crm ? crm.pitches.filter((x) => isDue(x, now)).sort((a, b) => a.nextFollowupAt! - b.nextFollowupAt!) : []
  const awaiting = crm ? crm.pitches.filter((x) => x.status === 'sent' || x.status === 'listened').length : 0
  const wip = beats.filter((b) => b.status === 'wip').sort((a, b) => b.mtime - a.mtime)
  const seenGroups = new Set<number>()
  // by group, because pitching or posting one version counts for the whole beat
  const groupOf = new Map(beats.map((b) => [b.id, b.groupId]))
  const pitched = new Set((crm?.pitches ?? []).flatMap((x) => x.beats.map((b) => b.groupId)))
  const posted = new Set(content.posts.filter((x) => x.status !== 'planned').map((x) => groupOf.get(x.beatId)))
  const ready = beats.filter((b) => b.ext !== 'flp' && b.status === 'finished' && !pitched.has(b.groupId) && !posted.has(b.groupId)).sort((a, b) => b.mtime - a.mtime).filter((b) => (seenGroups.has(b.groupId) ? false : (seenGroups.add(b.groupId), true)))
  const planned = content.posts.filter((x) => x.status === 'planned' && startOfDay(x.date) <= today0)
  const unseen = feedback.comments.filter((c) => !c.seen)
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime()
  const revenue = sales.sales.filter((s) => s.soldAt >= monthStart).reduce((a, s) => a + net(s), 0)
  const unsold = beats.filter((b) => b.status !== 'sold' && b.status !== 'idea').length
  const hr = new Date(now).getHours()
  const name = settings?.producerName
  const title = (id: number) => beats.find((b) => b.id === id)?.title ?? 'a beat'

  // 15-week activity heatmap, Monday-first columns
  const weeks = Array.from({ length: 15 }, (_, w) => Array.from({ length: 7 }, (_, d) => wk - (14 - w) * 7 * DAY + d * DAY))

  const needs = due.length + planned.length + unseen.length
  const bits = [
    due.length ? `${due.length} follow-up${due.length === 1 ? ' is' : 's are'} due` : '',
    ready.length ? `${ready.length} finished beat${ready.length === 1 ? ' hasn\'t' : 's haven\'t'} been pitched` : '',
    wip.length ? `${wip.length} ${wip.length === 1 ? 'beat is' : 'beats are'} close to finished` : ''
  ].filter(Boolean)

  return (
    <section className="dash hm">
      <div className="hm-top">
        <div className="hm-hello">{hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}{name ? `, ${name}` : ''} · {new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>{needs === 0 ? 'You are all caught up.' : `${needs} thing${needs === 1 ? '' : 's'} ${needs === 1 ? 'needs' : 'need'} you today.`}</h1>
        <p className="hm-lede">{bits.length ? `${bits.join('. ')}.` : 'Nothing is waiting on you. A good time to make something.'}</p>
      </div>

      <div className="hm-strip">
        <div><b>{money(Math.round(revenue))}</b><span>earned this month</span></div>
        <div><b>{awaiting}</b><span>pitches awaiting a reply</span></div>
        <div><b>{unsold}</b><span>beats available</span></div>
        <div><b>{current}</b><span>day{current === 1 ? '' : 's'} beat-making streak</span></div>
      </div>

      <div className="hm-cols">
        <div className="hm-main">
          <h3>Do next</h3>
          {due.slice(0, 5).map((x) => <div key={x.id} className="hm-row"><span className="hm-dot warn" /><span>Follow up with <a onClick={() => p.onOpenContact(x.contactId)}>{x.contactName}</a></span><span className="dim hm-sub">{x.beats.map((b) => b.title).join(', ') || x.subject}</span><span className="warn hm-when">{daysSince(x.sentAt, now)}d</span></div>)}
          {due.length > 5 && <div className="hm-row"><a onClick={() => p.onGo('crm')}>+{due.length - 5} more follow-ups</a></div>}
          {planned.map((x) => <div key={x.id} className="hm-row"><span className="hm-dot warn" /><span>Post <b>{title(x.beatId)}</b> on {x.platform}</span><span className={`hm-when ${startOfDay(x.date) < today0 ? 'warn' : 'dim'}`}>{startOfDay(x.date) < today0 ? 'overdue' : 'today'}</span></div>)}
          {unseen.slice(0, 3).map((c) => <div key={c.id} className="hm-row"><span className="hm-dot warn" /><span><b>{c.name || 'Anonymous'}</b> commented on {c.beatId ? title(c.beatId) : 'a beat'}</span><span className="dim hm-sub">{c.text.slice(0, 60)}</span><a className="hm-when" onClick={() => p.onGo('feedback')}>Open</a></div>)}
          {ready.slice(0, 5).map((b) => <div key={b.id} className="hm-row"><span className="hm-dot" /><span>Pitch <a onClick={() => p.onOpenBeat(b.id)}>{b.title}</a></span><span className="dim hm-sub">finished, never pitched or posted</span><span className="hm-acts"><button onClick={() => p.onPitchBeat(b.id)}>Pitch</button><button onClick={() => p.onMakeVideo(b.id)}>Video</button></span></div>)}
          {wip.slice(0, 5).map((b) => <div key={b.id} className="hm-row"><span className="hm-dot" /><span>Finish <a onClick={() => p.onOpenBeat(b.id)}>{b.title}</a></span><span className="dim hm-sub">{daysSince(b.mtime, now)}d since you touched it</span><span className="hm-acts"><button onClick={() => p.onSetStatus(b.id, 'finished')}>Mark finished</button></span></div>)}
          {needs === 0 && !ready.length && !wip.length && <p className="help">Nothing to do. <a onClick={() => p.onGo('content')}>Plan some posts</a> or <a onClick={() => p.onGo('vault')}>open the Vault</a>.</p>}
        </div>

        <div className="hm-side">
          <h3>This week</h3>
          <Goal label="Beats made" value={madeWeek} goal={settings?.goalBeats ?? 3} onGoal={(n) => window.api.setSetting({ goalBeats: n })} />
          <Goal label="Pitches sent" value={pitchesWeek} goal={settings?.goalPitches ?? 5} onGoal={(n) => window.api.setSetting({ goalPitches: n })} />
          <Goal label="Posts published" value={postsWeek} goal={settings?.goalPosts ?? 3} onGoal={(n) => window.api.setSetting({ goalPosts: n })} />
          <div className="help">Weeks run Monday to Sunday. Click a goal number to change it.</div>

          <h3 className="hm-gap">Studio session</h3>
          <div className={`clock ${open ? 'run' : ''}`}>{fmtClock(open ? now - open.startedAt : 0)}</div>
          <div className="timer-row">
            {open ? <button className="primary" onClick={async () => { await window.api.stopSession(); p.reloadSessions() }}>Stop session</button> : <button className="primary" onClick={async () => { await window.api.startSession(); p.reloadSessions() }}>Start session</button>}
            <span className="dim">{open?.auto ? 'Started automatically with FL Studio' : open ? 'Running' : 'Not running'}</span>
          </div>
          <div className="dim" style={{ marginTop: 10 }}>Today {fmtHM(todayMs)} · this week {fmtHM(weekMs)}</div>
          <label className="check small" style={{ marginTop: 8 }}><input type="checkbox" checked={!!settings?.autoTrackFL} onChange={(e) => window.api.setSetting({ autoTrackFL: e.target.checked })} /> Time sessions automatically while FL Studio is open</label>

          <h3 className="hm-gap">Streak <span className="dim hm-best">best {best}</span></h3>
          <div className="heat">
            {weeks.map((w, i) => <div key={i} className="hcol">{w.map((t) => { const d = act.get(dayKey(t)); const n = d ? d.bounces + (isActive({ bounces: 0, ms: d.ms }) ? 1 : 0) : 0; return <i key={t} title={`${new Date(t).toLocaleDateString()}: ${d?.bounces ?? 0} bounce${d?.bounces === 1 ? '' : 's'}, ${fmtHM(d?.ms ?? 0)}`} className={`hc ${t > now ? 'future' : n >= 3 ? 'l3' : n === 2 ? 'l2' : n === 1 ? 'l1' : ''} ${t === today0 ? 'today' : ''}`} /> })}</div>)}
          </div>
          <div className="help">A day counts when you bounce a beat or log 15+ minutes in the studio.</div>

          <div className="hm-health"><CatalogHealth beats={p.beats} onQuery={p.onQuery} /></div>
        </div>
      </div>
    </section>
  )
}
