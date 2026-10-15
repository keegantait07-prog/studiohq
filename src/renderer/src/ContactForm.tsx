import { useState } from 'react'
import { CONTACT_ROLES, type Contact, type ContactRole } from '@shared/types'
import { linksToText, parseLinks } from './crmUtils'

export function ContactForm({ contact, defaultDays, onSave, onClose }: { contact?: Contact; defaultDays: number; onSave: (id: number) => void; onClose: () => void }) {
  const [name, setName] = useState(contact?.name ?? '')
  const [role, setRole] = useState<ContactRole>(contact?.role ?? 'artist')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [sound, setSound] = useState(contact?.sound ?? '')
  const [links, setLinks] = useState(contact ? linksToText(contact.links) : '')
  const [notes, setNotes] = useState(contact?.notes ?? '')
  const [days, setDays] = useState(contact?.followupDays != null ? String(contact.followupDays) : '')

  const save = async () => {
    if (!name.trim()) return
    const d = parseInt(days, 10)
    const id = await window.api.saveContact({ id: contact?.id, name, role, email: email.trim(), sound, links: parseLinks(links), notes, followupDays: isNaN(d) || d < 1 ? null : d })
    onSave(id)
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}>
        <header><h2>{contact ? 'Edit contact' : 'New contact'}</h2></header>
        <div className="field"><label>Name</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="two">
          <div className="field"><label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as ContactRole)}>{CONTACT_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          </div>
          <div className="field"><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="field"><label>Their sound</label><input value={sound} placeholder="e.g. dark melodic trap, Travis-leaning, 140–160" onChange={(e) => setSound(e.target.value)} /></div>
        <div className="field"><label>Links (one per line, “label | url”)</label><textarea rows={3} value={links} placeholder={'Instagram | instagram.com/…\nSpotify | open.spotify.com/…'} onChange={(e) => setLinks(e.target.value)} /></div>
        <div className="field"><label>Notes</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="field"><label>Follow up after (days)</label><input value={days} placeholder={`default ${defaultDays}`} onChange={(e) => setDays(e.target.value)} style={{ width: 120 }} /></div>
        <div className="draft-actions"><button onClick={onClose}>Cancel</button><span className="flash" /><button className="primary" disabled={!name.trim()} onClick={save}>Save <kbd>⌘↵</kbd></button></div>
      </div>
    </div>
  )
}
