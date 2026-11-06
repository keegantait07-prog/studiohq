import { useEffect, useMemo, useState } from 'react'
import { CONTACT_ROLES, PITCH_STATUSES, type Contact, type ContactRole, type CrmData, type Pitch } from '@shared/types'
import { clickable } from './a11y'
import { firstName, renderTemplate } from '@shared/template'
import { ContactForm } from './ContactForm'
import { DraftPanel } from './DraftPanel'
import { Templates } from './Templates'
import { DAY, copy, daysSince, dueLabel, fmtDate, isAwaiting, isDue, varsFor } from './crmUtils'

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

const NEXT_RESP: Record<string, '' | 'liked' | 'passed'> = { '': 'liked', liked: 'passed', passed: '' }

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

  return (
    <section className="crm">
      <aside className="crm-list">
        <div className="crm-head">
          <h2>Pitch CRM</h2>
          <button className="primary" onClick={() => setForm({})}>+ Contact</button>
        </div>
        <div className="seg">
          <button className={tab === 'contacts' ? 'on' : ''} onClick={() => setTab('contacts')}>Contacts</button>
          <button className={tab === 'templates' ? 'on' : ''} onClick={() => setTab('templates')}>Templates</button>
        </div>
        {tab === 'contacts' && (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" />
            <div className="rolefilter">
              {(['all', 'due', ...CONTACT_ROLES] as const).map((r) => (
                <button key={r} className={`tab ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>{r === 'due' ? `due ${dueAll.length}` : r}</button>
              ))}
            </div>
            <div className="clist">
              {rows.map((c) => {
                const ps = byContact.get(c.id) ?? []
                const due = ps.filter((p) => isDue(p)).length
                const waiting = ps.filter(isAwaiting).length
                return (
                  <div key={c.id} className={`crow ${selected === c.id ? 'sel' : ''}`} {...clickable(() => onSelect(c.id))}>
                    <div className="cn"><b>{c.name}</b><span className="chip">{c.role}</span></div>
                    <div className="sub">
                      {due ? <span className="due-dot">● {due} follow-up due</span> : waiting ? `${waiting} awaiting reply` : ps.length ? `last pitch ${daysSince(ps[0].sentAt)}d ago` : 'no pitches yet'}
                    </div>
                  </div>
                )
              })}
              {!rows.length && <div className="empty-res">{crm.contacts.length ? 'No contacts match.' : 'Add your first contact to start pitching.'}</div>}
            </div>
          </>
        )}
      </aside>

      <div className="crm-main">
        {tab === 'templates' ? (
          <Templates crm={crm} myName={myName} reload={reload} />
        ) : contact ? (
          <>
          <button className="ghost" onClick={() => onSelect(null)}>← All contacts and follow-ups</button>
          <ContactView
            c={contact} pitches={byContact.get(contact.id) ?? []} defaultDays={crm.defaultFollowupDays}
            onEdit={() => setForm({ contact })} onPitch={() => onPitch(contact.id)} onOpenBeat={onOpenBeat} onDraft={openDraft}
            onDelete={async () => { if (confirm(`Remove ${contact.name}? Their follow-ups stop, and what you sent them stays on your beats.`)) { await window.api.deleteContact(contact.id); onSelect(null); reload() } }}
            reload={reload}
          />
          </>
        ) : (
          <Overview crm={crm} contactName={contactName} onSelect={onSelect} onDraft={openDraft} onPitch={() => onPitch()} reload={reload} />
        )}
      </div>

      {form && <ContactForm contact={form.contact} defaultDays={crm.defaultFollowupDays} onClose={() => setForm(null)} onSave={(id) => { setForm(null); reload(); onSelect(id); setTab('contacts') }} />}
      {draft && (() => {
        const p = draft.pitch
        const c = crm.contacts.find((x) => x.id === p.contactId)!
        const v = varsFor(c, p.beats, { myName, link: p.link, sentAt: p.sentAt, subject: p.subject })
        return (
          <div className="overlay" onMouseDown={() => setDraft(null)}>
            <div className="modal wide-modal" onMouseDown={(e) => e.stopPropagation()}>
              <header><h2>Follow up with {firstName(c.name)}</h2><button onClick={() => setDraft(null)}>Close</button></header>
              <DraftPanel
                to={c.email} subject={renderTemplate(followTpl?.subject ?? 'Re: {{subject}}', v)} body={renderTemplate(followTpl?.body ?? 'Hey {{name}}, just following up.', v)} link={p.link || undefined}
                confirmLabel="I sent it · log follow-up"
                onConfirm={async () => { await window.api.logFollowup(p.id); setDraft(null); reload() }}
              />
              <p className="help">Logging resets the timer to {c.followupDays ?? crm.defaultFollowupDays} days from now.</p>
            </div>
          </div>
        )
      })()}
    </section>
  )
}

function PitchActions({ p, reload, onDraft }: { p: Pitch; reload: () => void; onDraft: (p: Pitch) => void }) {
  const snooze = async (d: number) => { await window.api.updatePitch(p.id, { snoozeDays: d }); reload() }
  return (
    <div className="pact">
      <button className="primary" onClick={() => onDraft(p)}>Draft follow-up</button>
      <button onClick={() => snooze(3)}>Snooze 3d</button>
      <button onClick={() => snooze(7)}>7d</button>
      <button onClick={async () => { await window.api.updatePitch(p.id, { status: 'replied' }); reload() }}>They replied</button>
    </div>
  )
}

function Overview({ crm, contactName, onSelect, onDraft, onPitch, reload }: { crm: CrmData; contactName: (id: number) => string; onSelect: (id: number) => void; onDraft: (p: Pitch) => void; onPitch: () => void; reload: () => void }) {
  const now = Date.now()
  const due = crm.pitches.filter((p) => isDue(p, now)).sort((a, b) => a.nextFollowupAt! - b.nextFollowupAt!)
  const waiting = crm.pitches.filter((p) => isAwaiting(p) && !isDue(p, now)).sort((a, b) => (a.nextFollowupAt ?? 0) - (b.nextFollowupAt ?? 0))
  const week = crm.pitches.filter((p) => now - p.sentAt < 7 * DAY).length
  const positive = crm.pitches.filter((p) => p.status === 'liked' || p.status === 'placed').length
  const card = (p: Pitch) => (
    <div key={p.id} className={`ocard ${isDue(p, now) ? 'due' : ''}`}>
      <div className="ohead"><a onClick={() => onSelect(p.contactId)}>{contactName(p.contactId)}</a><span className="dim">sent {fmtDate(p.sentAt)} · {daysSince(p.sentAt)}d ago{p.followupCount ? ` · ${p.followupCount} follow-up${p.followupCount > 1 ? 's' : ''}` : ''}</span><span className={isDue(p, now) ? 'warn' : 'dim'}>{dueLabel(p, now)}</span></div>
      <div className="sub">{p.beats.map((b) => b.title).join(', ') || p.subject}</div>
      {isDue(p, now) && <PitchActions p={p} reload={reload} onDraft={onDraft} />}
    </div>
  )
  return (
    <div className="overview">
      <div className="stats">
        <div className={`stat ${due.length ? 'hot' : ''}`}><b>{due.length}</b><span>follow-ups due</span></div>
        <div className="stat"><b>{due.length + waiting.length}</b><span>awaiting reply</span></div>
        <div className="stat"><b>{week}</b><span>pitches this week</span></div>
        <div className="stat"><b>{positive}</b><span>liked or placed</span></div>
      </div>
      <h3>Follow-ups due</h3>
      {due.length ? due.map(card) : <p className="help">Nothing due. {crm.contacts.length ? 'You’re caught up.' : 'Add a contact and send your first pitch.'}</p>}
      {waiting.length > 0 && <><h3>Waiting for replies</h3>{waiting.map(card)}</>}
      <div className="actions" style={{ marginTop: 20 }}><button className="primary" onClick={onPitch}>New pitch</button></div>
    </div>
  )
}

function ContactView({ c, pitches, defaultDays, onEdit, onPitch, onDelete, onOpenBeat, onDraft, reload }: {
  c: Contact; pitches: Pitch[]; defaultDays: number; onEdit: () => void; onPitch: () => void; onDelete: () => void; onOpenBeat: (id: number) => void; onDraft: (p: Pitch) => void; reload: () => void
}) {
  return (
    <div className="cview">
      <div className="cv-head">
        <div>
          <h2>{c.name} <span className="chip">{c.role}</span></h2>
          {c.email && <a onClick={() => window.api.openExternal(`mailto:${c.email}`)}>{c.email}</a>}
        </div>
        <div className="actions"><button onClick={onEdit}>Edit</button><button onClick={onDelete}>Delete</button><button className="primary" onClick={onPitch}>Pitch beats</button></div>
      </div>
      {c.links.length > 0 && <div className="chips">{c.links.map((l) => <span key={l.url} className="chip artist" style={{ cursor: 'pointer' }} onClick={() => window.api.openExternal(l.url)}>{l.label} ↗</span>)}</div>}
      {c.sound && <div className="field"><label>Their sound</label><div>{c.sound}</div></div>}
      {c.notes && <div className="field"><label>Notes</label><div className="notes">{c.notes}</div></div>}
      <div className="meta-line">Follow up after {c.followupDays ?? defaultDays} days{c.followupDays == null ? ' (default)' : ''}</div>

      <h3>Pitch history ({pitches.length})</h3>
      {!pitches.length && <p className="help">No pitches yet. Use “Pitch beats” to send a pack.</p>}
      {pitches.map((p) => <PitchCard key={p.id} p={p} onOpenBeat={onOpenBeat} onDraft={onDraft} reload={reload} />)}
    </div>
  )
}

function PitchCard({ p, onOpenBeat, onDraft, reload }: { p: Pitch; onOpenBeat: (id: number) => void; onDraft: (p: Pitch) => void; reload: () => void }) {
  const [note, setNote] = useState(p.responseNote)
  useEffect(() => setNote(p.responseNote), [p.responseNote])
  const due = isDue(p)
  return (
    <div className={`ocard ${due ? 'due' : ''}`}>
      <div className="ohead">
        <b>{fmtDate(p.sentAt)}</b><span className="dim">{p.channel}{p.followupCount ? ` · ${p.followupCount} follow-up${p.followupCount > 1 ? 's' : ''}` : ''}</span>
        <span className={due ? 'warn' : 'dim'}>{dueLabel(p)}</span>
        <select className={`pst ps-${p.status}`} value={p.status} onChange={async (e) => { await window.api.updatePitch(p.id, { status: e.target.value as Pitch['status'] }); reload() }}>
          {PITCH_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="x" title="Delete this pitch" onClick={async () => { if (confirm('Delete this pitch from history?')) { await window.api.deletePitch(p.id); reload() } }}>×</button>
      </div>
      {p.subject && <div className="sub">{p.subject}</div>}
      <div className="chips pb">
        {p.beats.map((b) => (
          <span key={b.beatId} className={`chip resp-${b.response || 'none'}`}>
            <a onClick={() => onOpenBeat(b.beatId)}>{b.title}</a>{b.status === 'sold' && <em className="soldtag">sold</em>}
            <button title="Mark liked / passed" onClick={async () => { await window.api.setPitchBeatResponse(p.id, b.beatId, NEXT_RESP[b.response]); reload() }}>{b.response === 'liked' ? '♥' : b.response === 'passed' ? '✕' : '○'}</button>
          </span>
        ))}
      </div>
      {p.link && <div className="linkrow"><code>{p.link}</code><button onClick={() => copy(p.link)}>Copy</button><button onClick={() => window.api.openExternal(p.link)}>Open</button></div>}
      <textarea rows={1} className="resp" value={note} placeholder="Their response / notes…" onChange={(e) => setNote(e.target.value)} onBlur={async () => { if (note !== p.responseNote) { await window.api.updatePitch(p.id, { responseNote: note }); reload() } }} />
      {isAwaiting(p) && <PitchActions p={p} reload={reload} onDraft={onDraft} />}
    </div>
  )
}
