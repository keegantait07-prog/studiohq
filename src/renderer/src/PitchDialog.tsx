import { useMemo, useState } from 'react'
import type { Beat, CrmData, PackResult } from '@shared/types'
import { displayKey } from '@shared/key'
import { firstName, renderTemplate } from '@shared/template'
import { withOptOut } from '@shared/leads'
import { parseQuery } from './query'
import { fmtBpm } from './format'
import { DraftPanel } from './DraftPanel'
import { OptOutGate } from './OptOutGate'
import { varsFor } from './crmUtils'

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

export function PitchDialog({ beats, crm, myName, hasToken, contactId: c0, beatIds: b0, onClose, onLogged }: Props) {
  const [contactId, setContactId] = useState<number | ''>(c0 ?? '')
  const [picked, setPicked] = useState<number[]>(b0 ?? [])
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<'email' | 'dm' | 'other'>('email')
  const [withPage, setWithPage] = useState(true)
  const firstTpl = crm.templates.find((t) => t.kind === 'first_pitch') ?? crm.templates[0]
  const [tplId, setTplId] = useState<number | undefined>(firstTpl?.id)
  const [pageTitle, setPageTitle] = useState('')
  const [intro, setIntro] = useState('')
  const [introTouched, setIntroTouched] = useState(false)
  const [phase, setPhase] = useState<'compose' | 'building' | 'draft'>('compose')
  const [pack, setPack] = useState<PackResult | null>(null)
  const [error, setError] = useState('')

  const contact = crm.contacts.find((c) => c.id === contactId)
  const name = contact ? firstName(contact.name) : 'there'
  const title = pageTitle || `Beats for ${name}`
  const introText = introTouched ? intro : `Hey ${name}, here ${picked.length === 1 ? 'is a beat' : `are ${picked.length || 'a few'} beats`} I think fit your sound.`

  const sentBefore = useMemo(() => {
    const s = new Set<number>()
    if (contactId) for (const p of crm.pitches) if (p.contactId === contactId) p.beats.forEach((b) => { s.add(b.beatId); for (const x of beats) if (x.groupId === b.groupId) s.add(x.id) })
    return s
  }, [crm.pitches, contactId, beats])

  const parsed = useMemo(() => parseQuery(query), [query])
  const list = useMemo(() => {
    const seen = new Set<number>()
    // one row per beat group so versions don't clutter the picker
    return beats.filter((b) => parsed.test(b) && b.status !== 'sold').filter((b) => (seen.has(b.groupId) && !picked.includes(b.id) ? false : (seen.add(b.groupId), true)))
  }, [beats, parsed, picked])

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const chosen = picked.map((id) => beats.find((b) => b.id === id)).filter(Boolean) as Beat[]
  const tpl = crm.templates.find((t) => t.id === tplId)

  const go = async () => {
    if (!contact || !picked.length) return
    setError('')
    let res: PackResult | null = null
    if (withPage) {
      setPhase('building')
      try {
        res = await window.api.buildPack({ contactId: contact.id, title, intro: introText, beatIds: picked, deploy: hasToken })
      } catch (e) {
        setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
        setPhase('compose')
        return
      }
    }
    setPack(res)
    setPhase('draft')
  }

  if (phase === 'draft' && contact) {
    const link = pack?.url ?? ''
    const v = varsFor(contact, chosen.map((b) => ({ title: b.title, bpm: b.bpm, key: b.key })), { myName, link })
    const subject = renderTemplate(tpl?.subject ?? 'Beats', v)
    const notice = pack && !pack.url
      ? pack.deployError ? `Page built, but publishing failed: ${pack.deployError}` : 'Page built locally. Add a Netlify token in Settings to publish it and get a link.'
      : undefined
    return (
      <div className="overlay">
        <div className="modal wide-modal reach" onMouseDown={(e) => e.stopPropagation()}>
          <header><h2>Pitch to {contact.name}</h2><button onClick={onClose}>Close</button></header>
          <OptOutGate email={contact.email} name={contact.name}>
          <DraftPanel
            to={contact.email} subject={subject} body={withOptOut(renderTemplate(tpl?.body ?? '', v))} link={link || undefined} notice={notice}
            onLocalPreview={pack ? () => window.api.openPackLocal(pack.packId) : undefined}
            confirmLabel="I sent it · log pitch"
            onConfirm={async (subj) => {
              await window.api.logPitch({ contactId: contact.id, beatIds: picked, channel, subject: subj, link, packId: pack?.packId ?? null })
              onLogged(contact.id)
            }}
          />
          </OptOutGate>
          <p className="help">Logging marks these beats as “sent” in your Vault and starts the follow-up timer.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" onMouseDown={() => { if (!picked.length) onClose() }}>
      <div className="modal wide-modal pitch" onMouseDown={(e) => e.stopPropagation()}>
        <header><h2>New pitch</h2><button onClick={onClose}>Cancel</button></header>
        <div className="pitch-grid">
          <div className="picker">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find beats: dark, 140+ bpm, finished…" autoFocus />
            <div className="plist">
              {list.map((b) => (
                <label key={b.id} className={`pitem ${picked.includes(b.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.includes(b.id)} onChange={() => toggle(b.id)} />
                  <span className="pt">{b.title}{sentBefore.has(b.id) && <em className="ver-badge warn">already sent</em>}</span>
                  <span className="mono dim">{fmtBpm(b.bpm)} {displayKey(b.key)}</span>
                  <span className={`dot st-${b.status}`} title={b.status} />
                </label>
              ))}
              {!list.length && <div className="empty-res">No matching beats</div>}
            </div>
          </div>
          <div className="opts">
            <div className="field"><label>To</label>
              <select value={contactId} onChange={(e) => setContactId(e.target.value ? +e.target.value : '')}>
                <option value="">Choose a contact…</option>
                {crm.contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
              </select>
              {contact?.sound && <div className="help">Sound: {contact.sound}</div>}
            </div>
            <div className="two">
              <div className="field"><label>Sent via</label><select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}><option value="email">Email</option><option value="dm">DM</option><option value="other">Other</option></select></div>
              <div className="field"><label>Message template</label><select value={tplId} onChange={(e) => setTplId(+e.target.value)}>{crm.templates.filter((t) => t.kind !== 'follow_up').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            </div>
            <label className="check"><input type="checkbox" checked={withPage} onChange={(e) => setWithPage(e.target.checked)} /> Create a private listening page</label>
            {withPage && (
              <>
                <div className="field"><label>Page title</label><input value={pageTitle} placeholder={title} onChange={(e) => setPageTitle(e.target.value)} /></div>
                <div className="field"><label>Intro shown on the page</label><textarea rows={4} value={introText} onChange={(e) => { setIntro(e.target.value); setIntroTouched(true) }} /></div>
                {!hasToken && <div className="help">No Netlify token yet. The page will be built locally and you can preview it. Add a token in Settings to publish.</div>}
              </>
            )}
            {error && <div className="notice err">{error}</div>}
            <div className="selected-note">{picked.length} beat{picked.length === 1 ? '' : 's'} selected</div>
            <button className="primary" disabled={!contact || !picked.length || phase === 'building'} onClick={go}>
              {phase === 'building' ? 'Building previews…' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
