import { useMemo, useState } from 'react'
import CountUp from './components/CountUp'
import BlurText from './components/BlurText'
import DecryptedText from './components/DecryptedText'
import StarBorder from './components/StarBorder'
import './home.css'

import type { Beat, ContentData, CrmData, FeedbackData, SalesData, Settings, Status, StudioSession } from '@shared/types'
import { isDue, daysSince } from './crmUtils'
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

function Goal({ label, value, goal, onGo }: { label: string; value: number; goal: number; onGo: (n: number) => void }) {
  const [edit, setEdit] = useState(false)
  const pct = Math.min(1, value / Math.max(1, goal))
  const r = 38, c = 2 * Math.PI * r
  return (
    <div className="x-ring">
      <svg viewBox="0 0 90 90" aria-hidden="true"><circle cx="45" cy="45" r={r} /><circle cx="45" cy="45" r={r} className={pct >= 1 ? 'done' : ''} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} /></svg>
      <b><CountUp to={value} duration={1} /></b>
      <span>{label}</span>
      <small>of {edit ? <input autoFocus aria-label={`${label} goal`} defaultValue={goal} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n > 0) onGo(n); setEdit(false) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /> : <button onClick={() => setEdit(true)} title="Change your goal">{goal}</button>}</small>
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
    <div className="x-health">
      <h3>Catalogue health</h3>
      <div className="x-score"><CountUp to={score} duration={1.2} suffix="%" /></div>
      {issues === 0 ? <p>Everything is tagged and up to date.</p> : rows.filter((r) => r.n > 0).map((r) => (
        <button key={r.q} onClick={() => onQuery(r.q)}><b>{r.n}</b> {r.label}<small>{r.hint}</small></button>
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

  const queue = [
    ...due.slice(0, 4).map((x) => ({ k: `f${x.id}`, c: 'var(--sent)', t: `Follow up with ${x.contactName}`, s: `${x.beats.map((b) => b.title).join(', ') || x.subject}, ${daysSince(x.sentAt, now)} days ago`, a: [{ l: 'Open', f: () => p.onOpenContact(x.contactId) }] })),
    ...wip.slice(0, 3).map((b) => ({ k: `w${b.id}`, c: 'var(--wip)', t: `Finish ${b.title}`, s: `Last touched ${daysSince(b.mtime, now)} days ago`, a: [{ l: 'Done', f: () => p.onSetStatus(b.id, 'finished') }] })),
    ...ready.slice(0, 3).map((b) => ({ k: `r${b.id}`, c: 'var(--finished)', t: `Pitch or post ${b.title}`, s: 'Finished, never sent', a: [{ l: 'Pitch', f: () => p.onPitchBeat(b.id) }, { l: 'Video', f: () => p.onMakeVideo(b.id) }] })),
    ...planned.slice(0, 3).map((x) => ({ k: `p${x.id}`, c: 'var(--sold)', t: `Post ${title(x.beatId)} on ${x.platform}`, s: startOfDay(x.date) < today0 ? 'Overdue' : 'Planned for today', a: [{ l: 'Open', f: () => p.onGo('content') }] }))
  ]
  const headline = next === 'due' ? `Follow up with ${d0.contactName}` : next === 'wip' ? `Finish ${w0.title} first` : next === 'ready' ? `Pitch ${r0.title}` : 'You are caught up. Make something new.'
  const sub = next === 'due' ? `You sent ${d0.beats.map((b) => b.title).join(', ') || d0.subject} ${daysSince(d0.sentAt, now)} days ago and have not heard back.` : next === 'wip' ? `Newest beat in progress, last touched ${daysSince(w0.mtime, now)} days ago.` : next === 'ready' ? 'Finished, and never pitched or posted.' : 'Nothing is due, nothing is half done.'
  const go = next === 'due' ? () => p.onOpenContact(d0.contactId) : next === 'wip' ? () => openWip(w0) : next === 'ready' ? () => p.onPitchBeat(r0.id) : () => p.onGo('vault')
  const goLabel = next === 'due' ? `Open ${d0.contactName}` : next === 'wip' ? (w0.projectPath ? 'Open in FL Studio' : `Open ${w0.title}`) : next === 'ready' ? `Pitch ${r0.title}` : 'Open Beats'
  const total = line.reduce((a, st) => a + st.beats.length, 0)

  return (
    <section className="x-home">
      <header className="x-hero">
        <p className="x-eyebrow"><DecryptedText text={`${total} beats in your catalogue`} animateOn="view" speed={40} /></p>
        <h1><BlurText text={headline} delay={60} animateBy="words" /></h1>
        <p className="x-sub">{sub}{next !== 'ready' && ready.length > 0 ? ` ${outCount} never been pitched or posted.` : ''}</p>
        <div className="x-actions">
          <StarBorder as="button" onClick={go} color="#22d3ee" duration={5}>{goLabel}</StarBorder>
          <button className="x-ghost" onClick={() => p.onGo('crm')}>Pitch a beat</button>
        </div>
      </header>

      <div className="x-stats">
        {[['Finished, not out', ready.length, ''], ['Made this week', madeWeek, ''], ['Day streak', current, `best ${best}`], ['Earned this month', Math.round(revenue), '$']].map(([l, v, x]) => (
          <div key={l as string} className="x-stat"><CountUp to={v as number} duration={1.4} prefix={x === '$' ? '$' : ''} /><span>{l}</span>{x && x !== '$' && <small>{x}</small>}</div>
        ))}
      </div>

      <div className="x-pipe" role="list" aria-label="Where your beats are">
        {line.map((st) => (
          <div key={st.s} role="listitem" className="x-stage" style={{ ['--c' as string]: `var(--${st.s})` }}>
            <button className="x-stage-h" onClick={() => p.onQuery(st.s)} title={`Show every ${st.label.toLowerCase()} beat`}><b>{String(st.beats.length).padStart(2, '0')}</b><span>{st.label}</span></button>
            {st.beats.slice(0, 5).map((b) => (
              <button key={b.id} className={`x-chip ${(next === 'wip' && b.id === w0.id) || (next === 'ready' && b.id === r0.id) ? 'next' : ''}`} onClick={() => p.onOpenBeat(b.id)}>{b.title}<small>{daysSince(b.mtime, now)}d</small></button>
            ))}
            {st.beats.length > 5 && <button className="x-chip more" onClick={() => p.onQuery(st.s)}>+{st.beats.length - 5} more</button>}
            {!st.beats.length && <p className="x-none">{st.empty}</p>}
          </div>
        ))}
      </div>

      <div className="x-cols">
        <section className="x-queue" aria-label="Waiting on you">
          <h3>Waiting on you</h3>
          {queue.map((q) => (
            <div key={q.k} className="x-q" style={{ ['--c' as string]: q.c }}>
              <div><b>{q.t}</b><small>{q.s}</small></div>
              <span>{q.a.map((a) => <button key={a.l} onClick={a.f}>{a.l}</button>)}</span>
            </div>
          ))}
          {!queue.length && <p className="x-none"><b>Nothing waiting.</b> Every beat is finished and out. Start a new one in FL Studio.</p>}
          {(due.length > 4 || planned.length > 3) && <button className="x-more" onClick={() => p.onGo(due.length > 4 ? 'crm' : 'content')}>More waiting in {due.length > 4 ? 'Pitch CRM' : 'Content'}</button>}
        </section>

        <section className="x-session">
          <h3>Studio session</h3>
          <div className={`x-clock ${open ? 'run' : ''}`}>{fmtClock(open ? now - open.startedAt : 0)}</div>
          <div className="x-session-row">
            {open ? <button className="x-ghost" onClick={async () => { await window.api.stopSession(); p.reloadSessions() }}>Stop session</button> : <button className="x-ghost" onClick={async () => { await window.api.startSession(); p.reloadSessions() }}>Start session</button>}
            <span>{open?.auto ? 'Started with FL Studio' : open ? 'Running' : 'Not running'}</span>
          </div>
          <p>Today {fmtHM(todayMs)}, this week {fmtHM(weekMs)}</p>
          <label><input type="checkbox" checked={!!settings?.autoTrackFL} onChange={(e) => window.api.setSetting({ autoTrackFL: e.target.checked })} /> Time sessions while FL Studio is open</label>
        </section>

        <section className="x-goals" aria-label="This week">
          <h3>This week</h3>
          <div className="x-rings">
            <Goal label="Beats" value={madeWeek} goal={settings?.goalBeats ?? 3} onGo={(n) => window.api.setSetting({ goalBeats: n })} />
            <Goal label="Pitches" value={pitchesWeek} goal={settings?.goalPitches ?? 5} onGo={(n) => window.api.setSetting({ goalPitches: n })} />
            <Goal label="Posts" value={postsWeek} goal={settings?.goalPosts ?? 3} onGo={(n) => window.api.setSetting({ goalPosts: n })} />
          </div>
        </section>
      </div>

      <div className="x-cols x-low">
        <section className="x-streak" aria-label="Streak">
          <h3>{current}-day streak</h3>
          <div className="x-heat">
            {weeks.map((w, i) => <div key={i}>{w.map((t) => { const d = act.get(dayKey(t)); const n = d ? d.bounces + (isActive({ bounces: 0, ms: d.ms }) ? 1 : 0) : 0; return <i key={t} title={`${new Date(t).toLocaleDateString()}: ${d?.bounces ?? 0} bounce${d?.bounces === 1 ? '' : 's'}, ${fmtHM(d?.ms ?? 0)}`} className={`${t > now ? 'future' : n >= 3 ? 'l3' : n === 2 ? 'l2' : n === 1 ? 'l1' : ''} ${t === today0 ? 'today' : ''}`} /> })}</div>)}
          </div>
          <p>A day counts when you bounce a beat or log 15+ minutes in the studio.</p>
        </section>
        <CatalogHealth beats={p.beats} onQuery={p.onQuery} />
        <section className="x-replies">
          <h3>Replies and feedback</h3>
          {unseen.slice(0, 3).map((c) => <div key={c.id} className="x-q" style={{ ['--c' as string]: 'var(--accent)' }}><div><b>{c.name || 'Someone'} on {c.beatId ? title(c.beatId) : 'a beat'}</b><small>{c.text.slice(0, 70)}</small></div></div>)}
          {unseen.length > 0 && <button className="x-more" onClick={() => p.onGo('feedback')}>Open Feedback</button>}
          {!unseen.length && <p className="x-none"><b>{awaiting ? `${awaiting} pitch${awaiting === 1 ? '' : 'es'} out, no replies yet` : 'No replies to read'}</b> Replies and comments show up here.</p>}
        </section>
        <section aria-label="Beats made over time" className="x-chart">
          <PeakChart width={360} font="var(--font)" accent={accent} data={made.data} labels={made.labels} value={made.data.reduce((a, b) => a + b, 0)} valueSuffix="" title="Beats made" caption={madePeriod === 'Weekly' ? 'Last 7 days' : madePeriod === 'Monthly' ? 'Last 30 days' : 'Last 12 months'} updatedText="Your catalogue" trend="none" period={madePeriod} onPeriodChange={(x) => setMadePeriod(x as MadePeriod)} formatValue={(v) => `${Math.round(v)} made`} />
        </section>
      </div>
    </section>
  )
}
