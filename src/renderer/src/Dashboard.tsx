import { useMemo, useState } from 'react'
import type { Beat, ContentData, CrmData, FeedbackData, SalesData, Settings, Status, StudioSession } from '@shared/types'
import { isDue, daysSince } from './crmUtils'
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
  now: number
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
  const { beats, crm, content, sales, feedback, sessions, settings, now } = p
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
  const pitched = new Set((crm?.pitches ?? []).flatMap((x) => x.beats.map((b) => b.beatId)))
  const posted = new Set(content.posts.filter((x) => x.status === 'posted').map((x) => x.beatId))
  const ready = beats.filter((b) => b.ext !== 'flp' && b.status === 'finished' && !pitched.has(b.id) && !posted.has(b.id)).sort((a, b) => b.mtime - a.mtime).filter((b) => (seenGroups.has(b.groupId) ? false : (seenGroups.add(b.groupId), true)))
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

  return (
    <section className="dash">
      <div className="dash-head">
        <div><h2>{hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}{name ? `, ${name}` : ''}</h2><div className="dim">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
        <div className="tiles">
          <div className="stat"><b>{money(Math.round(revenue))}</b><span>earned this month</span></div>
          <div className="stat"><b>{awaiting}</b><span>pitches awaiting a reply</span></div>
          <div className="stat"><b>{unsold}</b><span>beats available</span></div>
        </div>
      </div>

      <div className="dgrid">
        <CatalogHealth beats={p.beats} onQuery={p.onQuery} />
        <div className="panel timer">
          <h3>Studio session</h3>
          <div className={`clock ${open ? 'run' : ''}`}>{fmtClock(open ? now - open.startedAt : 0)}</div>
          <div className="timer-row">
            {open ? <button className="primary" onClick={async () => { await window.api.stopSession(); p.reloadSessions() }}>Stop session</button> : <button className="primary" onClick={async () => { await window.api.startSession(); p.reloadSessions() }}>Start session</button>}
            <span className="dim">{open?.auto ? 'Started automatically with FL Studio' : open ? 'Running' : 'Not running'}</span>
          </div>
          <div className="dim" style={{ marginTop: 10 }}>Today {fmtHM(todayMs)} · this week {fmtHM(weekMs)}</div>
          <label className="check small" style={{ marginTop: 8 }}><input type="checkbox" checked={!!settings?.autoTrackFL} onChange={(e) => window.api.setSetting({ autoTrackFL: e.target.checked })} /> Time sessions automatically while FL Studio is open</label>
        </div>

        <div className="panel">
          <h3>Beat-making streak</h3>
          <div className="streak"><b>{current}</b><span>day{current === 1 ? '' : 's'}</span><em className="dim">best {best}</em></div>
          <div className="heat">
            {weeks.map((w, i) => <div key={i} className="hcol">{w.map((t) => { const d = act.get(dayKey(t)); const n = d ? d.bounces + (isActive({ bounces: 0, ms: d.ms }) ? 1 : 0) : 0; return <i key={t} title={`${new Date(t).toLocaleDateString()}: ${d?.bounces ?? 0} bounce${d?.bounces === 1 ? '' : 's'}, ${fmtHM(d?.ms ?? 0)}`} className={`hc ${t > now ? 'future' : n >= 3 ? 'l3' : n === 2 ? 'l2' : n === 1 ? 'l1' : ''} ${t === today0 ? 'today' : ''}`} /> })}</div>)}
          </div>
          <div className="help">A day counts when you bounce a beat or log 15+ minutes in the studio.</div>
        </div>

        <div className="panel">
          <h3>This week</h3>
          <Goal label="Beats made" value={madeWeek} goal={settings?.goalBeats ?? 3} onGoal={(n) => window.api.setSetting({ goalBeats: n })} />
          <Goal label="Pitches sent" value={pitchesWeek} goal={settings?.goalPitches ?? 5} onGoal={(n) => window.api.setSetting({ goalPitches: n })} />
          <Goal label="Posts published" value={postsWeek} goal={settings?.goalPosts ?? 3} onGoal={(n) => window.api.setSetting({ goalPosts: n })} />
          <div className="help">Weeks run Monday to Sunday. Click a goal number to change it.</div>
        </div>

        <div className="panel">
          <h3>Follow-ups due {due.length > 0 && <span className="badge">{due.length}</span>}</h3>
          {due.slice(0, 5).map((x) => <div key={x.id} className="drow"><a onClick={() => p.onOpenContact(x.contactId)}>{crm!.contacts.find((c) => c.id === x.contactId)?.name}</a><span className="dim">{x.beats.map((b) => b.title).join(', ') || x.subject}</span><span className="warn">{daysSince(x.sentAt, now)}d</span></div>)}
          {!due.length && <p className="help">Nothing due today.</p>}
          {due.length > 5 && <a onClick={() => p.onGo('crm')}>+{due.length - 5} more</a>}
        </div>

        <div className="panel">
          <h3>Close to finished</h3>
          {wip.slice(0, 5).map((b) => <div key={b.id} className="drow"><a onClick={() => p.onOpenBeat(b.id)}>{b.title}</a><span className="dim">{daysSince(b.mtime, now)}d ago</span><button onClick={() => p.onSetStatus(b.id, 'finished')}>Mark finished</button></div>)}
          {!wip.length && <p className="help">No beats marked WIP. Press 2 on a beat in the Vault to mark it.</p>}
        </div>

        <div className="panel">
          <h3>Finished, not out yet</h3>
          {ready.slice(0, 5).map((b) => <div key={b.id} className="drow"><a onClick={() => p.onOpenBeat(b.id)}>{b.title}</a><span className="dim">never pitched or posted</span><button onClick={() => p.onPitchBeat(b.id)}>Pitch</button><button onClick={() => p.onMakeVideo(b.id)}>Video</button></div>)}
          {!ready.length && <p className="help">Everything finished has been sent or posted.</p>}
        </div>

        <div className="panel">
          <h3>Today</h3>
          {planned.map((x) => <div key={x.id} className="drow"><span>{title(x.beatId)}</span><span className="dim">{x.platform}</span><span className={startOfDay(x.date) < today0 ? 'warn' : 'dim'}>{startOfDay(x.date) < today0 ? 'overdue' : 'today'}</span></div>)}
          {!planned.length && <p className="help">No posts planned for today. <a onClick={() => p.onGo('content')}>Open the calendar</a></p>}
        </div>

        <div className="panel">
          <h3>New feedback {unseen.length > 0 && <span className="badge">{unseen.length}</span>}</h3>
          {unseen.slice(0, 3).map((c) => <div key={c.id} className="drow"><span><b>{c.name || 'Anonymous'}</b> on {c.beatId ? title(c.beatId) : 'a beat'}</span><span className="dim" style={{ flex: 1 }}>{c.text.slice(0, 60)}</span></div>)}
          {!unseen.length && <p className="help">No new comments. <a onClick={() => p.onGo('feedback')}>Send a feedback link</a></p>}
          {unseen.length > 0 && <a onClick={() => p.onGo('feedback')}>Open Feedback</a>}
        </div>
      </div>
    </section>
  )
}
