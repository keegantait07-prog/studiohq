import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Circle, Copy, ExternalLink, Heart, Mail, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { CONTACT_ROLES, PITCH_STATUSES, type Contact, type ContactRole, type CrmData, type Pitch } from '@shared/types'
import { clickable } from './a11y'
import { displayKey } from '@shared/key'
import { firstName, renderTemplate } from '@shared/template'
import { ContactForm } from './ContactForm'
import { DraftPanel } from './DraftPanel'
import { OptOutGate } from './OptOutGate'
import { errMsg } from './salesUtils'
import { withOptOut } from '@shared/leads'
import { Templates } from './Templates'
import { DAY, copy, daysSince, dueLabel, fmtDate, isAwaiting, isDue, varsFor } from './crmUtils'
import { pitchSeries, isReply, type PitchMetric } from './crmSeries'
import { startOfDay, type MadePeriod } from './dashUtils'
import { PeakChart } from './components/ui/peak-chart'
import { ScrollArea } from '@/components/lib/scroll-area'
import { MagicCard } from '@/components/lib/magic-card'
import { TooltipProvider } from '@/components/lib/tooltip'
import { ProgressiveBlur } from '@/components/lib/skiper-ui/skiper41'
import { Avatar, Button, ExtLink, IconBtn, Num, Reveal, Seg } from './crmUi'
import './crm.css'

interface Props {
  crm: CrmData
  myName: string
  selected: number | null
  onSelect: (id: number | null) => void
  onPitch: (contactId?: number) => void
  onOpenBeat: (beatId: number) => void
  reload: () => void
  newContactSignal: number
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function Crm({ crm, myName, selected, onSelect, onPitch, onOpenBeat, reload, newContactSignal }: Props) {
  const [tab, setTab] = useState<'contacts' | 'templates'>('contacts')
  const [q, setQ] = useState('')
  const [role, setRole] = useState<ContactRole | 'all' | 'due'>('all')
  const [form, setForm] = useState<{ contact?: Contact } | null>(null)
  const [draft, setDraft] = useState<{ pitch: Pitch } | null>(null)

  useEffect(() => { if (newContactSignal) setForm({}) }, [newContactSignal])

  const byContact = useMemo(() => {
    const m = new Map<number, Pitch[]>()
    for (const p of crm.pitches) (m.get(p.contactId) ?? m.set(p.contactId, []).get(p.contactId)!).push(p)
    return m
  }, [crm.pitches])

  const rows = crm.contacts
    .filter((c) => (role === 'all' ? true : role === 'due' ? (byContact.get(c.id) ?? []).some((p) => isDue(p)) : c.role === role))
    .filter((c) => !q || [c.name, c.email, c.sound, c.notes].join(' ').toLowerCase().includes(q.toLowerCase()))
  const contact = crm.contacts.find((c) => c.id === selected) ?? null
  const dueAll = crm.pitches.filter((p) => isDue(p))

  const contactName = (id: number) => crm.contacts.find((c) => c.id === id)?.name ?? crm.pitches.find((p) => p.contactId === id)?.contactName ?? '?'

  const openDraft = (p: Pitch) => setDraft({ pitch: p })
  const followTpl = crm.templates.find((t) => t.kind === 'follow_up')
  const draftContact = draft ? crm.contacts.find((x) => x.id === draft.pitch.contactId) : undefined

  const tiles: [string, number, string?][] = [['Contacts', crm.contacts.length], ['Follow-ups due', dueAll.length, dueAll.length ? 'hot' : ''], ['Pitches sent', crm.pitches.length], ['Templates', crm.templates.length]]

  return (
    <TooltipProvider>
    <section className="pcrm" aria-label="Pitch CRM">
      <aside className="pc-l">
        <div className="pc-lh">
          <h2 className="pc-disp">Pitch CRM</h2>
          <Button variant="outline" size="sm" onClick={() => setForm({})}><Plus />Contact</Button>
        </div>
        <div className="pc-tabs">
          <Seg tabs full label="Pitch CRM" value={tab} onChange={setTab} options={[{ v: 'contacts', label: 'Contacts' }, { v: 'templates', label: 'Templates' }]} />
        </div>
        <div className="pc-tk" aria-label="Summary">
          {tiles.map(([l, n, c]) => <div key={l} className={c || ''}><b><Num value={n} /></b><small title={l}>{l}</small></div>)}
        </div>
        {tab === 'contacts' ? (
          <>
            <div className="pc-ls">
              <div className="pc-search"><Search aria-hidden="true" /><input className="pc-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" aria-label="Search contacts" /></div>
              <div className="pc-roles" role="group" aria-label="Filter by role">
                {(['all', 'due', ...CONTACT_ROLES] as const).map((r) => (
                  <button key={r} type="button" className="pc-chip" aria-pressed={role === r} onClick={() => setRole(r)}>{r === 'due' ? <>due <b>{dueAll.length}</b></> : r}</button>
                ))}
              </div>
            </div>
            <div className="pc-rows-wrap">
              <ScrollArea className="pc-rows">
                {rows.map((c) => {
                  const ps = byContact.get(c.id) ?? []
                  const due = ps.filter((p) => isDue(p)).length
                  const waiting = ps.filter(isAwaiting).length
                  return (
                    <div key={c.id} className={`pc-crow ${selected === c.id ? 'sel' : ''}`} aria-current={selected === c.id || undefined} {...clickable(() => onSelect(c.id))}>
                      <Avatar name={c.name} />
                      <div style={{ minWidth: 0 }}>
                        <b>{c.name}</b>
                        {due ? <small className="due">{due} follow-up due</small> : <small>{waiting ? `${waiting} awaiting reply` : ps.length ? `last pitch ${daysSince(ps[0].sentAt)}d ago` : 'no pitches yet'}</small>}
                      </div>
                      <span className="pc-role">{c.role}</span>
                    </div>
                  )
                })}
                {!rows.length && <div className="pc-empty"><b>{crm.contacts.length ? 'No contacts match.' : 'Add your first contact to start pitching.'}</b>{crm.contacts.length ? 'Try another search or role.' : 'Or promote artists from Leads: they land here with their email.'}</div>}
              </ScrollArea>
              <ProgressiveBlur position="bottom" height="36px" blurAmount="2px" backgroundColor="var(--bg)" />
            </div>
          </>
        ) : <div />}
      </aside>

      <div className="pc-r crm-main">
        {tab === 'templates' ? (
          <Templates crm={crm} myName={myName} reload={reload} />
        ) : contact ? (
          <ContactView
            key={contact.id}
            c={contact} pitches={byContact.get(contact.id) ?? []} defaultDays={crm.defaultFollowupDays}
            onBack={() => onSelect(null)}
            onEdit={() => setForm({ contact })} onPitch={() => onPitch(contact.id)} onOpenBeat={onOpenBeat} onDraft={openDraft}
            onDelete={async () => { await window.api.deleteContact(contact.id); onSelect(null); reload() }}
            reload={reload}
          />
        ) : (
          <Overview crm={crm} contactName={contactName} onSelect={onSelect} onDraft={openDraft} onPitch={() => onPitch()} reload={reload} />
        )}
      </div>

      {form && <ContactForm contact={form.contact} defaultDays={crm.defaultFollowupDays} onClose={() => setForm(null)} onSave={(id) => { setForm(null); reload(); onSelect(id); setTab('contacts') }} />}
      {draft && draftContact && (() => {
        const p = draft.pitch
        const c = draftContact
        const v = varsFor(c, p.beats, { myName, link: p.link, sentAt: p.sentAt, subject: p.subject })
        return (
          <div className="overlay pc-scrim" onMouseDown={() => setDraft(null)}>
            <div className="modal pc-dlg md" aria-labelledby="pc-fut" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setDraft(null) } }}>
              <header><h2 id="pc-fut" className="pc-disp">Follow up with {firstName(c.name)}</h2><IconBtn label="Close" onClick={() => setDraft(null)}><X /></IconBtn></header>
              <div className="pc-bd">
                <OptOutGate email={c.email} name={c.name}>
                <DraftPanel
                  to={c.email} subject={renderTemplate(followTpl?.subject ?? 'Re: {{subject}}', v)} body={withOptOut(renderTemplate(followTpl?.body ?? 'Hey {{name}}, just following up.', v))} link={p.link || undefined}
                  confirmLabel="I sent it · log follow-up"
                  onConfirm={async () => { await window.api.logFollowup(p.id); setDraft(null); reload() }}
                />
                </OptOutGate>
                <p className="pc-help">Logging resets the timer to {c.followupDays ?? crm.defaultFollowupDays} days from now.</p>
              </div>
            </div>
          </div>
        )
      })()}
    </section>
    </TooltipProvider>
  )
}

function PitchActions({ p, reload, onDraft }: { p: Pitch; reload: () => void; onDraft: (p: Pitch) => void }) {
  const snooze = async (d: number) => { await window.api.updatePitch(p.id, { snoozeDays: d }); reload() }
  return (
    <div className="pc-row">
      <Button size="sm" onClick={() => onDraft(p)}>Draft follow-up</Button>
      <Button variant="outline" size="sm" onClick={() => snooze(3)}>Snooze 3d</Button>
      <Button variant="outline" size="sm" onClick={() => snooze(7)}>7d</Button>
      <Button variant="outline" size="sm" onClick={async () => { await window.api.updatePitch(p.id, { status: 'replied' }); reload() }}>They replied</Button>
    </div>
  )
}

function PitchPeak({ pitches }: { pitches: Pitch[] }) {
  const [period, setPeriod] = useState<MadePeriod>('Monthly')
  const [metric, setMetric] = useState<PitchMetric>('sent')
  const now = startOfDay(Date.now()) + DAY - 1
  const s = useMemo(() => pitchSeries(pitches, metric, period, now), [pitches, metric, period, now])
  const total = s.data.reduce((a, b) => a + b, 0)
  const sent = metric === 'sent' ? total : pitchSeries(pitches, 'sent', period, now).data.reduce((a, b) => a + b, 0)
  const replies = metric === 'replies' ? total : pitches.filter(isReply).length
  const span = period === 'Weekly' ? 'Last 7 days' : period === 'Monthly' ? 'Last 30 days' : 'Last 12 months'
  return (
    <div className="pc-peak" aria-label="Pitches sent vs replies">
      <Seg full label="Chart shows" value={metric} onChange={setMetric} options={[{ v: 'sent', label: 'Pitches sent' }, { v: 'replies', label: 'Replies' }]} />
      <PeakChart
        width={300} font="var(--font)" accent={cssVar(metric === 'sent' ? '--sent' : '--finished')} data={s.data} labels={s.labels} value={total} valueSuffix=""
        title={metric === 'sent' ? 'Pitches sent' : 'Replies'} caption={span}
        updatedText={metric === 'sent' ? `${replies} repl${replies === 1 ? 'y' : 'ies'} so far` : `from ${sent} sent in this span`}
        trend="none" period={period} onPeriodChange={(x) => setPeriod(x as MadePeriod)}
        formatValue={(v) => `${Math.round(v)} ${metric === 'sent' ? 'sent' : Math.round(v) === 1 ? 'reply' : 'replies'}`}
      />
    </div>
  )
}

function Overview({ crm, contactName, onSelect, onDraft, onPitch, reload }: { crm: CrmData; contactName: (id: number) => string; onSelect: (id: number) => void; onDraft: (p: Pitch) => void; onPitch: () => void; reload: () => void }) {
  const now = Date.now()
  const due = crm.pitches.filter((p) => isDue(p, now)).sort((a, b) => a.nextFollowupAt! - b.nextFollowupAt!)
  const waiting = crm.pitches.filter((p) => isAwaiting(p) && !isDue(p, now)).sort((a, b) => (a.nextFollowupAt ?? 0) - (b.nextFollowupAt ?? 0))
  const week = crm.pitches.filter((p) => now - p.sentAt < 7 * DAY).length
  const positive = crm.pitches.filter((p) => p.status === 'liked' || p.status === 'placed').length
  const row = (p: Pitch, i: number) => (
    <Reveal key={p.id} delay={Math.min(i, 8) * 0.04}>
      <div className="pc-due-row">
        <Avatar name={contactName(p.contactId)} />
        <div style={{ minWidth: 0 }}>
          <a className="pc-link" {...clickable(() => onSelect(p.contactId))}>{contactName(p.contactId)}</a>
          <small>{p.beats.map((b) => b.title).join(', ') || p.subject}</small>
          <small>sent {fmtDate(p.sentAt)} · {daysSince(p.sentAt)}d ago{p.followupCount ? ` · ${p.followupCount} follow-up${p.followupCount > 1 ? 's' : ''}` : ''} · <span className={isDue(p, now) ? 'late' : ''} style={isDue(p, now) ? { color: 'var(--sold)' } : undefined}>{dueLabel(p, now)}</span></small>
        </div>
        {isDue(p, now) ? <PitchActions p={p} reload={reload} onDraft={onDraft} /> : <Button variant="outline" size="sm" onClick={() => onSelect(p.contactId)}>Open</Button>}
      </div>
    </Reveal>
  )
  return (
    <div className="pc-ov">
      <div className="pc-ov-l">
        <div className="pc-ov-top">
          <div>
            <div className="pc-eyebrow">Overview</div>
            <h1 className="pc-disp">{due.length ? `${due.length} follow-up${due.length === 1 ? ' is' : 's are'} waiting on you` : 'Nothing due'}</h1>
            <p>{due.length ? 'The longer a pitch sits, the colder it gets. Send a nudge, snooze, or log the reply.' : 'You are caught up. Send something new.'}</p>
          </div>
          <Button size="lg" onClick={onPitch}>New pitch</Button>
        </div>
        <div className="pc-stats">
          <div className={`pc-blk ${due.length ? 'c' : ''}`} style={{ ['--c' as string]: 'var(--sold)' }}><small>follow-ups due</small><b><Num value={due.length} /></b></div>
          <div className="pc-blk"><small>awaiting reply</small><b><Num value={due.length + waiting.length} /></b></div>
          <div className="pc-blk c" style={{ ['--c' as string]: 'var(--sent)' }}><small>pitches this week</small><b><Num value={week} /></b></div>
          <div className="pc-blk c" style={{ ['--c' as string]: 'var(--finished)' }}><small>liked or placed</small><b><Num value={positive} /></b></div>
        </div>
        <section>
          <div className="pc-sec-h"><span>Follow-ups due</span><span>{due.length}</span></div>
          {due.length ? due.map(row) : <div className="pc-empty"><b>Nothing due.</b>{crm.contacts.length ? 'You’re caught up.' : 'Add a contact and send your first pitch.'}</div>}
        </section>
        {waiting.length > 0 && (
          <section>
            <div className="pc-sec-h"><span>Waiting for replies</span><span>{waiting.length}</span></div>
            {waiting.map(row)}
          </section>
        )}
      </div>
      <PitchPeak pitches={crm.pitches} />
    </div>
  )
}

function ContactView({ c, pitches, defaultDays, onBack, onEdit, onPitch, onDelete, onOpenBeat, onDraft, reload }: {
  c: Contact; pitches: Pitch[]; defaultDays: number; onBack: () => void; onEdit: () => void; onPitch: () => void; onDelete: () => void; onOpenBeat: (id: number) => void; onDraft: (p: Pitch) => void; reload: () => void
}) {
  const [optedOut, setOptedOut] = useState(false)
  const [optErr, setOptErr] = useState('')
  const [cf, setCf] = useState<'del' | 'optout' | null>(null)
  useEffect(() => {
    setOptedOut(false)
    setOptErr('')
    if (c.email) window.api.leadsIsSuppressed(c.email).then(setOptedOut, () => {})
  }, [c.email])
  const optOut = async () => {
    setCf(null)
    setOptErr('')
    try {
      await window.api.leadsSuppress(c.email, 'opted out')
      // the chip shows what the server stored, never what we hoped it stored
      setOptedOut(await window.api.leadsIsSuppressed(c.email))
    } catch (e) {
      setOptErr(errMsg(e))
    }
  }
  const pending = pitches.find((p) => isDue(p)) ?? pitches.find(isAwaiting)
  return (
    <div className="pc-cv">
      <a className="pc-back" {...clickable(onBack)}><ChevronLeft aria-hidden="true" />All contacts and follow-ups</a>
      <Reveal>
        <div className="pc-cv-h">
          <Avatar name={c.name} big />
          <div><div className="pc-eyebrow">{c.role}</div><h1 className="pc-disp">{c.name}</h1></div>
          <span className="pc-sp" />
          {optedOut && <span className="pc-pill out"><X size={12} aria-hidden="true" />opted out</span>}
          <div className="pc-row">
            <IconBtn label="Edit contact" onClick={onEdit}><Pencil /></IconBtn>
            {c.email && !optedOut && <Button variant="outline" size="sm" onClick={() => setCf('optout')}>Mark opted out</Button>}
            <IconBtn label="Delete contact" onClick={() => setCf('del')}><Trash2 /></IconBtn>
            <Button onClick={onPitch}>Pitch beats</Button>
          </div>
        </div>
      </Reveal>
      {optErr && <div className="pc-err" role="alert">{optErr}</div>}
      {cf === 'del' && <div className="pc-cfm" role="alert"><span>Remove {c.name}? Their follow-ups stop, and what you sent them stays on your beats.</span><Button variant="outline" size="sm" onClick={() => setCf(null)}>Cancel</Button><Button variant="destructive" size="sm" onClick={() => { setCf(null); onDelete() }}>Remove</Button></div>}
      {cf === 'optout' && <div className="pc-cfm" role="alert"><span>Mark {c.name} as opted out? You will not be able to pitch {c.email} again.</span><Button variant="outline" size="sm" onClick={() => setCf(null)}>Cancel</Button><Button variant="destructive" size="sm" onClick={optOut}>Mark opted out</Button></div>}
      <dl className="pc-meta">
        <dt>Email</dt><dd>{c.email ? <a className="pc-alink" {...clickable(() => window.api.openExternal(`mailto:${c.email}`))}>{c.email} <Mail size={13} aria-hidden="true" /></a> : <span className="dim">None</span>}</dd>
        <dt>Their sound</dt><dd>{c.sound || <span className="dim">Not set</span>}</dd>
        <dt>Links</dt><dd>{c.links.length ? c.links.map((l) => <ExtLink key={l.url} href={l.url}>{l.label}</ExtLink>) : <span className="dim">None</span>}</dd>
        <dt>Notes</dt><dd>{c.notes || <span className="dim">None</span>}</dd>
        <dt>Follow-up</dt><dd>{pending ? <span style={isDue(pending) ? { color: 'var(--sold)', fontWeight: 600 } : undefined}>{dueLabel(pending)}</span> : <span className="dim">Nothing pending</span>}<span className="dim">Follow up after {c.followupDays ?? defaultDays} days{c.followupDays == null ? ' (default)' : ''}</span></dd>
      </dl>

      <div className="pc-sec-h"><span>Pitch history ({pitches.length})</span></div>
      <div className="pc-hist">
        {!pitches.length && <div className="pc-empty"><b>No pitches yet.</b>Use “Pitch beats” to send a pack.</div>}
        {pitches.map((p, i) => <PitchCard key={p.id} p={p} k={i} onOpenBeat={onOpenBeat} onDraft={onDraft} reload={reload} />)}
      </div>
    </div>
  )
}

function PitchCard({ p, k, onOpenBeat, onDraft, reload }: { p: Pitch; k: number; onOpenBeat: (id: number) => void; onDraft: (p: Pitch) => void; reload: () => void }) {
  const [note, setNote] = useState(p.responseNote)
  const [sure, setSure] = useState(false)
  useEffect(() => setNote(p.responseNote), [p.responseNote])
  const due = isDue(p)
  const lab = dueLabel(p)
  const resp = async (beatId: number, r: '' | 'liked' | 'passed') => { await window.api.setPitchBeatResponse(p.id, beatId, r); reload() }
  return (
    <article className={`pc-card ${due ? 'due' : ''}`} style={{ ['--k' as string]: Math.min(k, 6) }}>
      <MagicCard gradientSize={220} gradientFrom="var(--accent)" gradientTo="var(--sent)" gradientColor="var(--raise)" gradientOpacity={0.35} className="pc-mc">
        <div className="pc-card-in">
          <div className="pc-card-h">
            <h4>{fmtDate(p.sentAt)} · {p.channel}{p.followupCount ? ` · ${p.followupCount} follow-up${p.followupCount > 1 ? 's' : ''}` : ''}</h4>
            {lab && <span className={`lab ${due ? 'late' : ''}`}>{lab}</span>}
            <span className="pc-sp" />
            <select className="pc-in" aria-label="Pitch status" value={p.status} onChange={async (e) => { await window.api.updatePitch(p.id, { status: e.target.value as Pitch['status'] }); reload() }}>
              {PITCH_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <IconBtn label="Delete this pitch" onClick={() => setSure(true)}><Trash2 /></IconBtn>
          </div>
          {sure && <div className="pc-cfm" role="alert"><span>Delete this pitch from history?</span><Button variant="outline" size="sm" onClick={() => setSure(false)}>Cancel</Button><Button variant="destructive" size="sm" onClick={async () => { await window.api.deletePitch(p.id); setSure(false); reload() }}>Delete</Button></div>}
          {p.subject && <div style={{ color: 'var(--text-2)' }}>{p.subject}</div>}
          {p.beats.map((b) => (
            <div key={b.beatId} className="pc-pbeat">
              <span style={{ minWidth: 0 }}><a className="pc-link" {...clickable(() => onOpenBeat(b.beatId))}>{b.title}</a><small>{[b.bpm ? `${Math.round(b.bpm)} BPM` : '', displayKey(b.key)].filter(Boolean).join(', ')}</small>{b.status === 'sold' && <em className="sold">sold</em>}</span>
              <span className="pc-resp" role="group" aria-label={`Response to ${b.title}`}>
                <button type="button" className="liked" aria-pressed={b.response === 'liked'} aria-label="Liked" title="Liked" onClick={() => resp(b.beatId, 'liked')}><Heart /></button>
                <button type="button" className="passed" aria-pressed={b.response === 'passed'} aria-label="Passed" title="Passed" onClick={() => resp(b.beatId, 'passed')}><X /></button>
                <button type="button" className="none" aria-pressed={!b.response} aria-label="No response" title="No response" onClick={() => resp(b.beatId, '')}><Circle /></button>
              </span>
            </div>
          ))}
          {p.link && <div className="pc-linkrow"><code>{p.link}</code><IconBtn label="Copy link" onClick={() => copy(p.link)}><Copy /></IconBtn><IconBtn label="Open page" onClick={() => window.api.openExternal(p.link)}><ExternalLink /></IconBtn></div>}
          <textarea rows={2} className="pc-in" aria-label="Response note" value={note} placeholder="Their response / notes…" onChange={(e) => setNote(e.target.value)} onBlur={async () => { if (note !== p.responseNote) { await window.api.updatePitch(p.id, { responseNote: note }); reload() } }} />
          {isAwaiting(p) && <PitchActions p={p} reload={reload} onDraft={onDraft} />}
        </div>
      </MagicCard>
    </article>
  )
}
