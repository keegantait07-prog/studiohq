import { useMemo, useState } from 'react'
import { Num, Reveal, Spot, Tip } from './deckUi'
import type { Beat, ContentData, CrmData, FeedbackData, SalesData, Settings, Status, StudioSession } from '@shared/types'
import { isDue, daysSince } from './crmUtils'
import { clickable } from './a11y'
import { useNow } from './useNow'
import { activity, beatsMadeSince, dayKey, DAY, fmtClock, fmtHM, isActive, madeSeries, type MadePeriod, sessionMs, startOfDay, streaks, weekStart } from './dashUtils'
import { PeakChart } from './components/ui/peak-chart'
import { net } from './salesUtils'
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

const STAGES: { s: Status; label: string; empty: string }[] = [
  { s: 'idea', label: 'Idea', empty: 'No ideas saved.' },
  { s: 'wip', label: 'In progress', empty: 'Nothing in progress.' },
  { s: 'finished', label: 'Finished', empty: 'Nothing finished yet.' },
  { s: 'sent', label: 'Pitched', empty: 'Nothing out yet. Send a finished beat to start replies coming back.' },
  { s: 'sold', label: 'Sold', empty: 'Your first sale lands here.' }
]

function Goal({ label, value, goal, onGoal }: { label: string; value: number; goal: number; onGoal: (n: number) => void }) {
  const [edit, setEdit] = useState(false)
  const pct = Math.min(1, value / Math.max(1, goal))
  return (
    <div className="h-goal">
      <div className="h-goal-top"><span>{label}</span><span>{value} of {edit ? <input autoFocus aria-label={`${label} goal`} defaultValue={goal} style={{ width: 44 }} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n > 0) onGoal(n); setEdit(false) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /> : <button className="h-link" onClick={() => setEdit(true)} title="Change your goal">{goal}</button>}</span></div>
      <div className="h-meter"><i className={pct >= 1 ? 'done' : ''} style={{ transform: `scaleX(${pct})` }} /></div>
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
    <section className="h-panel" aria-labelledby="h-health">
      <h3 id="h-health">Catalogue health <span className="h-count"><Num value={score} suffix="%" /></span></h3>
      <div className="h-meter"><i className={score >= 90 ? 'done' : ''} style={{ transform: `scaleX(${score / 100})` }} /></div>
      {issues === 0 ? <p className="h-quiet">Everything is tagged and up to date.</p> : rows.filter((r) => r.n > 0).map((r) => (
        <div key={r.q} className="h-kv"><button className="h-link" onClick={() => onQuery(r.q)}>{r.n} {r.label}</button><span>{r.hint}</span></div>
      ))}
    </section>
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
  const title = (id: number) => beats.find((b) => b.id === id)?.title ?? 'a beat'

  // one card per beat (versions share a group), newest first, for the Idea → Sold line
  const line = useMemo(() => {
    const byGroup = new Map<number, Beat>()
    for (const b of [...beats].sort((a, b) => b.mtime - a.mtime)) if (!byGroup.has(b.groupId)) byGroup.set(b.groupId, b)
    const all = [...byGroup.values()]
    return STAGES.map((st) => ({ ...st, beats: all.filter((b) => b.status === st.s) }))
  }, [beats])

  // 15-week activity heatmap, Monday-first columns
  const weeks = Array.from({ length: 15 }, (_, w) => Array.from({ length: 7 }, (_, d) => wk - (14 - w) * 7 * DAY + d * DAY))

  const [madePeriod, setMadePeriod] = useState<MadePeriod>('Monthly')
  const made = useMemo(() => madeSeries(beats, madePeriod, today0 + DAY - 1), [beats, madePeriod, today0])
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()

  const next = due[0] ? 'due' : wip[0] ? 'wip' : ready[0] ? 'ready' : 'none'
  const w0 = wip[0], r0 = ready[0], d0 = due[0]
  const openWip = (b: Beat) => (b.projectPath ? void window.api.openProject(b.id) : p.onOpenBeat(b.id))
  const outCount = ready.length === 1 ? 'One finished beat has' : `${ready.length} finished beats have`

  return (
    <section className="h-home">
      <div className="h-main">
        <header className="h-lead">
          <div>
            <h1>{next === 'due' ? `Follow up with ${d0.contactName}` : next === 'wip' ? `Finish ${w0.title} before you start anything new` : next === 'ready' ? `Pitch ${r0.title}` : 'You are caught up. Make something new.'}</h1>
            <p>
              {next === 'due' && `You sent ${d0.beats.map((b) => b.title).join(', ') || d0.subject} ${daysSince(d0.sentAt, now)} days ago and have not heard back.`}
              {next === 'wip' && `It is the newest beat in progress, last touched ${daysSince(w0.mtime, now)} days ago.`}
              {next === 'ready' && 'It is finished and has never been pitched or posted.'}
              {next === 'none' && 'Nothing is due, nothing is half done.'}
              {next !== 'ready' && ready.length > 0 && ` ${outCount} never been pitched or posted.`}
            </p>
          </div>
          <div className="h-cta">
            {next === 'due' && <button className="h-btn primary" onClick={() => p.onOpenContact(d0.contactId)}>Open {d0.contactName}</button>}
            {next === 'wip' && <button className="h-btn primary" onClick={() => openWip(w0)}>{w0.projectPath ? 'Open in FL Studio' : `Open ${w0.title}`}</button>}
            {next === 'ready' && <button className="h-btn primary" onClick={() => p.onPitchBeat(r0.id)}>Pitch {r0.title}</button>}
            {next === 'none' && <button className="h-btn primary" onClick={() => p.onGo('vault')}>Open Beats</button>}
            <button className="h-btn" onClick={() => p.onGo('crm')}>Pitch a beat</button>
          </div>
        </header>

        <section className="h-line" aria-labelledby="h-line-t">
          <header><h2 id="h-line-t">Where your beats are</h2><span>{line.reduce((a, s) => a + s.beats.length, 0)} beats, versions counted once</span></header>
          <div className="h-stages">
            {line.map((st) => (
              <div key={st.s} className="h-stage" style={{ ['--c' as string]: `var(--${st.s})` }}>
                <Tip label={`Show every ${st.label.toLowerCase()} beat`} side="top"><button className="h-gate" onClick={() => p.onQuery(st.s)}><i aria-hidden="true" /><b>{st.label}</b><span><Num value={st.beats.length} /></span></button></Tip>
                <div className="h-stack">
                  {st.beats.slice(0, 4).map((b) => (
                    <div key={b.id} className={`h-tick ${(next === 'wip' && b.id === w0.id) || (next === 'ready' && b.id === r0.id) ? 'next' : ''}`} {...clickable(() => p.onOpenBeat(b.id))}>
                      <span>{b.title}</span><small>{daysSince(b.mtime, now)}d</small>
                    </div>
                  ))}
                  {st.beats.length > 4 && <button className="h-tick more" onClick={() => p.onQuery(st.s)}>{st.beats.length - 4} more</button>}
                  {!st.beats.length && <p className="h-none">{st.empty}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="h-bento">
          <Spot className="h-blk-mc"><div className="h-blk" style={{ ['--c' as string]: 'var(--finished)' }}><small>Finished, not out yet</small><b><Num value={ready.length} /></b></div></Spot>
          <Spot className="h-blk-mc"><div className="h-blk" style={{ ['--c' as string]: 'var(--wip)' }}><small>Made this week</small><b><Num value={madeWeek} /></b></div></Spot>
          <Spot className="h-blk-mc"><div className="h-blk" style={{ ['--c' as string]: 'var(--sent)' }}><small>Day streak, best {best}</small><b><Num value={current} /></b></div></Spot>
          <Spot className="h-blk-mc"><div className="h-blk dim"><small>Earned this month</small><b><Num value={Math.round(revenue)} prefix="$" /></b></div></Spot>
        </div>

        <div className="h-row">
          <section className="h-panel" aria-labelledby="h-week">
            <h3 id="h-week">This week</h3>
            <Goal label="Beats made" value={madeWeek} goal={settings?.goalBeats ?? 3} onGoal={(n) => window.api.setSetting({ goalBeats: n })} />
            <Goal label="Pitches sent" value={pitchesWeek} goal={settings?.goalPitches ?? 5} onGoal={(n) => window.api.setSetting({ goalPitches: n })} />
            <Goal label="Posts published" value={postsWeek} goal={settings?.goalPosts ?? 3} onGoal={(n) => window.api.setSetting({ goalPosts: n })} />
            <p className="h-quiet">Weeks run Monday to Sunday. Click a goal number to change it.</p>
          </section>
          <section className="h-panel" aria-labelledby="h-streak">
            <h3 id="h-streak">Beat-making streak <span className="h-count"><Num value={current} suffix={` day${current === 1 ? '' : 's'}`} /></span></h3>
            <div className="h-heat">
              {weeks.map((w, i) => <div key={i}>{w.map((t) => { const d = act.get(dayKey(t)); const n = d ? d.bounces + (isActive({ bounces: 0, ms: d.ms }) ? 1 : 0) : 0; return <i key={t} title={`${new Date(t).toLocaleDateString()}: ${d?.bounces ?? 0} bounce${d?.bounces === 1 ? '' : 's'}, ${fmtHM(d?.ms ?? 0)}`} className={`${t > now ? 'future' : n >= 3 ? 'l3' : n === 2 ? 'l2' : n === 1 ? 'l1' : ''} ${t === today0 ? 'today' : ''}`} /> })}</div>)}
            </div>
            <p className="h-quiet">A day counts when you bounce a beat or log 15+ minutes in the studio.</p>
          </section>
          <CatalogHealth beats={p.beats} onQuery={p.onQuery} />
        </div>
      </div>

      <aside className="h-rail" aria-label="Waiting on you">
        <Reveal><section>
          <h3>Waiting on you <span className="h-count"><Num value={due.length + Math.min(3, wip.length) + Math.min(3, ready.length) + Math.min(3, planned.length)} /></span></h3>
          {due.slice(0, 5).map((x) => <div key={`f${x.id}`} className="h-todo" style={{ ['--c' as string]: 'var(--sent)' }}><i /><div>Follow up with {x.contactName}<small>{x.beats.map((b) => b.title).join(', ') || x.subject}, {daysSince(x.sentAt, now)} days ago</small></div><button className="h-go" onClick={() => p.onOpenContact(x.contactId)}>Open</button></div>)}
          {due.length > 5 && <button className="h-link" onClick={() => p.onGo('crm')}>{due.length - 5} more follow-ups</button>}
          {wip.slice(0, 3).map((b) => <div key={`w${b.id}`} className="h-todo" style={{ ['--c' as string]: 'var(--wip)' }}><i /><div>Finish {b.title}<small>Last touched {daysSince(b.mtime, now)} days ago</small></div><Tip label="Mark it finished" side="top"><button className="h-go" onClick={() => p.onSetStatus(b.id, 'finished')}>Done</button></Tip></div>)}
          {ready.slice(0, 3).map((b) => <div key={`r${b.id}`} className="h-todo" style={{ ['--c' as string]: 'var(--finished)' }}><i /><div>Pitch or post {b.title}<small>Finished, never sent</small></div><span className="h-gos"><button className="h-go" onClick={() => p.onPitchBeat(b.id)}>Pitch</button><button className="h-go" onClick={() => p.onMakeVideo(b.id)}>Video</button></span></div>)}
          {planned.slice(0, 3).map((x) => <div key={`p${x.id}`} className="h-todo" style={{ ['--c' as string]: 'var(--sold)' }}><i /><div>Post {title(x.beatId)} on {x.platform}<small>{startOfDay(x.date) < today0 ? 'Overdue' : 'Planned for today'}</small></div><button className="h-go" onClick={() => p.onGo('content')}>Open</button></div>)}
          {planned.length > 3 && <button className="h-link" onClick={() => p.onGo('content')}>{planned.length - 3} more posts planned</button>}
          {!due.length && !wip.length && !ready.length && !planned.length && <p className="h-empty"><b>Nothing waiting</b>Every beat is finished and out. Start a new one in FL Studio.</p>}
        </section></Reveal>

        <section className="h-session">
          <h3>Studio session</h3>
          <div className={`h-clock ${open ? 'run' : ''}`}>{fmtClock(open ? now - open.startedAt : 0)}</div>
          <div className="h-session-row">
            {open ? <button className="h-btn primary" onClick={async () => { await window.api.stopSession(); p.reloadSessions() }}>Stop session</button> : <button className="h-btn" onClick={async () => { await window.api.startSession(); p.reloadSessions() }}>Start session</button>}
            <span>{open?.auto ? 'Started with FL Studio' : open ? 'Running' : 'Not running'}</span>
          </div>
          <p className="h-quiet">Today {fmtHM(todayMs)}, this week {fmtHM(weekMs)}</p>
          <label className="h-check"><input type="checkbox" checked={!!settings?.autoTrackFL} onChange={(e) => window.api.setSetting({ autoTrackFL: e.target.checked })} /> Time sessions while FL Studio is open</label>
        </section>

        <section aria-label="Beats made over time">
          <PeakChart width={292} font="var(--font)" accent={accent} data={made.data} labels={made.labels} value={made.data.reduce((a, b) => a + b, 0)} valueSuffix="" title="Beats made" caption={madePeriod === 'Weekly' ? 'Last 7 days' : madePeriod === 'Monthly' ? 'Last 30 days' : 'Last 12 months'} updatedText="Your catalogue" trend="none" period={madePeriod} onPeriodChange={(x) => setMadePeriod(x as MadePeriod)} formatValue={(v) => `${Math.round(v)} made`} />
        </section>

        <section>
          <h3>Replies and feedback {unseen.length > 0 && <span className="h-count hot"><Num value={unseen.length} suffix=" new" /></span>}</h3>
          {unseen.slice(0, 3).map((c) => <div key={c.id} className="h-todo" style={{ ['--c' as string]: 'var(--accent)' }}><i /><div>{c.name || 'Someone'} on {c.beatId ? title(c.beatId) : 'a beat'}<small>{c.text.slice(0, 70)}</small></div></div>)}
          {unseen.length > 0 && <button className="h-link" onClick={() => p.onGo('feedback')}>Open Feedback</button>}
          {!unseen.length && <p className="h-empty"><b>{awaiting ? `${awaiting} pitch${awaiting === 1 ? '' : 'es'} out, no replies yet` : 'No replies to read'}</b>{awaiting ? 'Replies and comments show up here.' : 'Pitch a finished beat or send a feedback link, and replies show up here.'}</p>}
        </section>
      </aside>
    </section>
  )
}
