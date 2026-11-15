import { useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { Beat, Contact, CrmData, PackResult } from '@shared/types'
import { displayKey } from '@shared/key'
import { firstName, renderTemplate } from '@shared/template'
import { withOptOut } from '@shared/leads'
import { parseQuery } from './query'
import { fmtBpm } from './format'
import { DraftPanel } from './DraftPanel'
import { OptOutGate } from './OptOutGate'
import { varsFor } from './crmUtils'
import { TooltipProvider } from '@/components/lib/tooltip'
import { Avatar, Button, IconBtn, Reveal, Seg } from './crmUi'
import './crm.css'

interface Props {
  beats: Beat[]
  crm: CrmData
  myName: string
  hasToken: boolean
  contactId?: number
  beatIds?: number[]
  onClose: () => void
  onLogged: (contactId: number) => void
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1))

/**
 * Pitch routing grid (approved in flagship.html): beats are columns, people are rows, and each person gets
 * one pitch with the beats ticked on their row. Each pitch then goes through the same per-contact flow as
 * before: build its private page (buildPack), review its draft behind the opt-out gate, log it (logPitch).
 */
export function PitchDialog({ beats, crm, myName, hasToken, contactId: c0, beatIds: b0, onClose, onLogged }: Props) {
  const [people, setPeople] = useState<number[]>(c0 != null ? [c0] : [])
  const [picked, setPicked] = useState<number[]>(b0 ?? [])
  const [route, setRoute] = useState<Record<number, number[]>>(c0 != null ? { [c0]: b0 ?? [] } : {})
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<'email' | 'dm' | 'other'>('email')
  const [withPage, setWithPage] = useState(true)
  const firstTpl = crm.templates.find((t) => t.kind === 'first_pitch') ?? crm.templates[0]
  const [tplId, setTplId] = useState<number | undefined>(firstTpl?.id)
  const [pageTitle, setPageTitle] = useState('')
  const [intro, setIntro] = useState('')
  const [introTouched, setIntroTouched] = useState(false)
  const [phase, setPhase] = useState<'compose' | 'building' | 'draft'>('compose')
  const [packs, setPacks] = useState<Record<number, PackResult | null>>({})
  const [building, setBuilding] = useState(0)
  const [error, setError] = useState('')
  const [cur, setCur] = useState(0)
  const [done, setDone] = useState<Record<number, 'logged' | 'skipped'>>({})

  const contactOf = (id: number) => crm.contacts.find((c) => c.id === id)
  const targets = people.map(contactOf).filter((c): c is Contact => !!c && (route[c.id]?.length ?? 0) > 0)
  const nameOf = (c?: Contact) => (c ? firstName(c.name) : 'there')
  const titleFor = (c?: Contact) => pageTitle || `Beats for ${nameOf(c)}`
  const introFor = (c: Contact | undefined, n: number) => introTouched ? intro : `Hey ${nameOf(c)}, here ${n === 1 ? 'is a beat' : `are ${n || 'a few'} beats`} I think fit your sound.`
  const lead = targets[0] ?? contactOf(people[0] ?? -1)

  const sentTo = useMemo(() => {
    const m = new Map<number, Set<number>>()
    for (const p of crm.pitches) {
      const s = m.get(p.contactId) ?? m.set(p.contactId, new Set()).get(p.contactId)!
      p.beats.forEach((b) => { s.add(b.beatId); for (const x of beats) if (x.groupId === b.groupId) s.add(x.id) })
    }
    return m
  }, [crm.pitches, beats])
  const sentBefore = (cid: number, bid: number) => sentTo.get(cid)?.has(bid) ?? false

  const parsed = useMemo(() => parseQuery(query), [query])
  const list = useMemo(() => {
    const seen = new Set<number>()
    // one row per beat group so versions don't clutter the picker
    return beats.filter((b) => parsed.test(b) && b.status !== 'sold').filter((b) => (seen.has(b.groupId) && !picked.includes(b.id) ? false : (seen.add(b.groupId), true)))
  }, [beats, parsed, picked])

  // a new beat goes to everyone on the grid, a new person gets every beat: untick per cell from there
  const toggle = (id: number) => {
    if (picked.includes(id)) {
      setPicked((p) => p.filter((x) => x !== id))
      setRoute((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.filter((x) => x !== id)])))
    } else {
      setPicked((p) => [...p, id])
      setRoute((r) => Object.fromEntries(people.map((k) => [k, [...(r[k] ?? []), id]])))
    }
  }
  const addPerson = (id: number) => { if (people.includes(id)) return; setPeople((p) => [...p, id]); setRoute((r) => ({ ...r, [id]: [...picked] })) }
  const removePerson = (id: number) => { setPeople((p) => p.filter((x) => x !== id)); setRoute((r) => { const n = { ...r }; delete n[id]; return n }) }
  const pin = (cid: number, bid: number) => setRoute((r) => { const v = r[cid] ?? []; return { ...r, [cid]: v.includes(bid) ? v.filter((x) => x !== bid) : picked.filter((x) => x === bid || v.includes(x)) } })
  const chosen = picked.map((id) => beats.find((b) => b.id === id)).filter(Boolean) as Beat[]
  const tpl = crm.templates.find((t) => t.id === tplId)
  const beatTotal = targets.reduce((n, c) => n + route[c.id].length, 0)
  const dirty = picked.length > 0 || people.length > (c0 != null ? 1 : 0)

  const go = async () => {
    if (!targets.length) return
    setError('')
    const res: Record<number, PackResult | null> = {}
    if (withPage) {
      setPhase('building')
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i]
        setBuilding(i)
        try {
          res[c.id] = await window.api.buildPack({ contactId: c.id, title: titleFor(c), intro: introFor(c, route[c.id].length), beatIds: route[c.id], deploy: hasToken })
        } catch (e) {
          setError(`${targets.length > 1 ? `${c.name}: ` : ''}${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
          setPhase('compose')
          return
        }
      }
    }
    setPacks(res)
    setDone({})
    setCur(0)
    setPhase('draft')
  }

  const lastLogged = () => Object.entries(done).filter(([, v]) => v === 'logged').map(([k]) => +k).pop()
  const finish = (next: Record<number, 'logged' | 'skipped'>, justLogged?: number) => {
    const open = targets.findIndex((c) => !next[c.id])
    if (open >= 0) { setDone(next); setCur(open); return }
    const l = justLogged ?? Object.entries(next).filter(([, v]) => v === 'logged').map(([k]) => +k).pop()
    if (l != null) onLogged(l); else onClose()
  }
  // closing after some pitches were logged still refreshes the CRM and lands on the last one
  const close = () => { const l = lastLogged(); if (l != null) onLogged(l); else onClose() }

  const header = (
    <header>
      <h2 id="pc-pt" className="pc-disp">Pitch</h2>
      <p>{phase === 'draft' && targets[cur] ? `Pitch to ${targets[cur].name}` : 'Each person gets one email with the beats you tick for them.'}</p>
      <IconBtn label="Close" onClick={phase === 'draft' ? close : onClose}><X /></IconBtn>
    </header>
  )

  if (phase === 'draft' && targets.length) {
    const contact = targets[Math.min(cur, targets.length - 1)]
    const ids = route[contact.id]
    const pack = packs[contact.id] ?? null
    const link = pack?.url ?? ''
    const mine = ids.map((id) => beats.find((b) => b.id === id)).filter(Boolean) as Beat[]
    const v = varsFor(contact, mine.map((b) => ({ title: b.title, bpm: b.bpm, key: b.key })), { myName, link })
    const subject = renderTemplate(tpl?.subject ?? 'Beats', v)
    const notice = pack && !pack.url
      ? pack.deployError ? `Page built, but publishing failed: ${pack.deployError}` : 'Page built locally. Add a Netlify token in Settings to publish it and get a link.'
      : undefined
    const loggedAny = Object.values(done).includes('logged')
    return (
      <TooltipProvider>
      <div className="overlay pc-scrim">
        <div className="modal pc-dlg" aria-labelledby="pc-pt" onMouseDown={(e) => e.stopPropagation()}>
          {header}
          <div className="pc-bd">
            {targets.length > 1 && (
              <Seg tabs label="Draft for" value={String(contact.id)} onChange={(x) => setCur(targets.findIndex((c) => String(c.id) === x))}
                options={targets.map((c) => ({ v: String(c.id), label: <>{done[c.id] === 'logged' && <Check size={13} aria-label="logged" />}{c.name}{done[c.id] === 'skipped' ? ' (skipped)' : ''}</> }))} />
            )}
            {done[contact.id] ? (
              <div className="pc-empty"><b>{done[contact.id] === 'logged' ? `Logged for ${contact.name}.` : `${contact.name} is skipped.`}</b>Pick another person above.</div>
            ) : (
              <Reveal key={contact.id}>
                <OptOutGate email={contact.email} name={contact.name}>
                <DraftPanel
                  to={contact.email} subject={subject} body={withOptOut(renderTemplate(tpl?.body ?? '', v))} link={link || undefined} notice={notice}
                  onLocalPreview={pack ? () => window.api.openPackLocal(pack.packId) : undefined}
                  confirmLabel="I sent it · log pitch"
                  onConfirm={async (subj) => {
                    await window.api.logPitch({ contactId: contact.id, beatIds: ids, channel, subject: subj, link, packId: pack?.packId ?? null })
                    finish({ ...done, [contact.id]: 'logged' }, contact.id)
                  }}
                />
                </OptOutGate>
              </Reveal>
            )}
            <p className="pc-help">Logging marks these beats as “sent” in your Vault and starts the follow-up timer.</p>
          </div>
          <footer>
            <span className="sum">Draft <b>{cur + 1}</b> of <b>{targets.length}</b></span>
            <div className="r">
              {!loggedAny && <Button variant="outline" onClick={() => setPhase('compose')}>Back to routing</Button>}
              {targets.length > 1 && !done[contact.id] && <Button variant="outline" onClick={() => finish({ ...done, [contact.id]: 'skipped' })}>Skip {firstName(contact.name)}</Button>}
              <Button variant="outline" onClick={close}>Close</Button>
            </div>
          </footer>
        </div>
      </div>
      </TooltipProvider>
    )
  }

  const others = crm.contacts.filter((c) => !people.includes(c.id))
  const cols = `minmax(170px, 1fr) repeat(${chosen.length}, 52px) 36px`
  return (
    <TooltipProvider>
    <div className="overlay pc-scrim" onMouseDown={() => { if (!dirty) onClose() }}>
      <div className="modal pc-dlg" aria-labelledby="pc-pt" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape' && !dirty) { e.stopPropagation(); onClose() } }}>
        {header}
        <div className="pc-popt">
          <div className="pc-fld"><span className="pc-lbl">Sent via</span><Seg label="Sent via" value={channel} onChange={setChannel} options={[{ v: 'email', label: 'Email' }, { v: 'dm', label: 'DM' }, { v: 'other', label: 'Other' }]} /></div>
          <div className="pc-fld"><label htmlFor="pc-tpl" className="pc-lbl">Message template</label>
            <select id="pc-tpl" className="pc-in" value={tplId} onChange={(e) => setTplId(+e.target.value)}>{crm.templates.filter((t) => t.kind !== 'follow_up').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </div>
          <label className="pc-chk"><input type="checkbox" checked={withPage} onChange={(e) => setWithPage(e.target.checked)} /> Create a private listening page</label>
        </div>
        {phase === 'building' ? (
          <div className="pc-build" role="status">
            <b>Building previews…</b>
            <ol className="pc-steps">{targets.map((c, i) => <li key={c.id} className={i < building ? 'ok' : i === building ? 'on' : ''}>{i < building && <Check size={12} aria-hidden="true" />} {c.name}</li>)}</ol>
          </div>
        ) : (
          <div className="pc-route">
            <aside>
              <h4>Beats</h4>
              {chosen.map((b, i) => (
                <div key={b.id} className="pc-bt">
                  <b>{letter(i)}</b>
                  <div>{b.title}<small>{fmtBpm(b.bpm)} {displayKey(b.key)}</small></div>
                  <IconBtn label={`Remove ${b.title}`} onClick={() => toggle(b.id)}><X /></IconBtn>
                </div>
              ))}
              <input className="pc-in" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find beats: dark, 140+ bpm, finished…" aria-label="Find beats" autoFocus />
              <div className="pc-plist">
                {list.map((b) => (
                  <label key={b.id} className={`pc-pitem ${picked.includes(b.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={picked.includes(b.id)} onChange={() => toggle(b.id)} />
                    <span className="t">{b.title}{people.some((cid) => sentBefore(cid, b.id)) && <em>already sent</em>}</span>
                    <span className="m">{fmtBpm(b.bpm)} {displayKey(b.key)}</span>
                    <span className="d" style={{ ['--c' as string]: `var(--${b.status})` }} title={b.status} />
                  </label>
                ))}
                {!list.length && <div className="pc-help" style={{ padding: 8 }}>No matching beats</div>}
              </div>
            </aside>
            <div className="pc-matrix" style={{ gridTemplateColumns: cols }}>
              <span className="pc-lbl">People</span>{chosen.map((b, i) => <span key={b.id} className="hd" title={b.title}>{letter(i)}</span>)}<span />
              {people.map((cid) => {
                const c = contactOf(cid)
                if (!c) return null
                return [
                  <div key={`w${cid}`} className="pc-who"><Avatar name={c.name} /><div>{c.name}<small>{c.sound ? `Sound: ${c.sound}` : c.role}</small></div></div>,
                  ...chosen.map((b) => {
                    const on = route[cid]?.includes(b.id) ?? false
                    const was = sentBefore(cid, b.id)
                    return <span key={`${cid}-${b.id}`} className="pc-cell"><button type="button" className={`pc-pin${was ? ' was' : ''}`} aria-pressed={on} aria-label={`Send ${b.title} to ${c.name}${was ? ' (already sent)' : ''}`} title={was ? 'Already sent to them' : undefined} onClick={() => pin(cid, b.id)} /></span>
                  }),
                  <span key={`x${cid}`} className="pc-cell"><IconBtn label={`Remove ${c.name}`} onClick={() => removePerson(cid)}><X /></IconBtn></span>
                ]
              })}
              <div className="pc-addp" style={{ gridColumn: '1 / -1' }}>
                <select className="pc-in" aria-label="Add a person" value="" onChange={(e) => e.target.value && addPerson(+e.target.value)}>
                  <option value="">Choose a contact…</option>
                  {others.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                </select>
                {!people.length && <span className="pc-help">Add the people who should get these beats.</span>}
                {!chosen.length && people.length > 0 && <span className="pc-help">Tick beats on the left to add columns.</span>}
              </div>
            </div>
          </div>
        )}
        {withPage && phase !== 'building' && (
          <div className="pc-pageopts">
            <div className="pc-fld"><label htmlFor="pc-ptitle">Page title</label><input id="pc-ptitle" className="pc-in" value={pageTitle} placeholder={titleFor(lead)} onChange={(e) => setPageTitle(e.target.value)} /></div>
            <div className="pc-fld"><label htmlFor="pc-intro">Intro shown on the page</label><textarea id="pc-intro" className="pc-in" rows={2} value={introFor(lead, lead ? route[lead.id]?.length ?? picked.length : picked.length)} onChange={(e) => { setIntro(e.target.value); setIntroTouched(true) }} /></div>
            {!hasToken && <div className="pc-help" style={{ gridColumn: '1 / -1' }}>No Netlify token yet. The page will be built locally and you can preview it. Add a token in Settings to publish.</div>}
          </div>
        )}
        {error && <div className="pc-err" role="alert" style={{ margin: '0 var(--s5) var(--s3)' }}>{error}</div>}
        <footer>
          <span className="sum">
            {targets.length
              ? <>{targets.length} {channel === 'email' ? 'email' : 'pitch'}{targets.length === 1 ? '' : channel === 'email' ? 's' : 'es'}, {beatTotal} beat{beatTotal === 1 ? '' : 's'}{tpl ? <>, using your “{tpl.name}” template</> : null}</>
              : `${picked.length} beat${picked.length === 1 ? '' : 's'} selected`}
          </span>
          <div className="r">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!targets.length || phase === 'building'} onClick={go}>
              {phase === 'building' ? 'Building previews…' : targets.length > 1 ? `Review ${targets.length} drafts` : 'Continue'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
    </TooltipProvider>
  )
}
