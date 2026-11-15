import { useState } from 'react'
import { X } from 'lucide-react'
import { CONTACT_ROLES, type Contact, type ContactRole } from '@shared/types'
import { linksToText, parseLinks } from './crmUtils'
import { Button, ExtLink, IconBtn, Seg } from './crmUi'
import { TooltipProvider } from '@/components/lib/tooltip'
import './crm.css'

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
  const parsed = links.trim() ? parseLinks(links) : []

  return (
    <TooltipProvider>
    <div className="overlay pc-scrim" onMouseDown={onClose}>
      <div className="modal pc-dlg sm" aria-labelledby="pc-cft" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}>
        <header><h2 id="pc-cft" className="pc-disp">{contact ? 'Edit contact' : 'New contact'}</h2><IconBtn label="Close" onClick={onClose}><X /></IconBtn></header>
        <div className="pc-bd">
          <div className="pc-fld"><label htmlFor="cf-name">Name</label><input id="cf-name" className="pc-in" autoFocus value={name} placeholder="Artist or manager name" onChange={(e) => setName(e.target.value)} /></div>
          <div className="pc-fld"><span className="pc-lbl">Role</span><Seg label="Role" value={role} onChange={setRole} options={CONTACT_ROLES.map((r) => ({ v: r, label: r }))} /></div>
          <div className="pc-fld"><label htmlFor="cf-email">Email</label><input id="cf-email" className="pc-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="pc-fld"><label htmlFor="cf-sound">Their sound</label><input id="cf-sound" className="pc-in" value={sound} placeholder="e.g. dark melodic trap, Travis-leaning, 140–160" onChange={(e) => setSound(e.target.value)} /></div>
          <div className="pc-fld">
            <label htmlFor="cf-links">Links (one per line, “label | url”)</label>
            <textarea id="cf-links" className="pc-in" rows={3} value={links} placeholder={'Instagram | instagram.com/…\nSpotify | open.spotify.com/…'} onChange={(e) => setLinks(e.target.value)} />
            {parsed.length > 0 && <div className="pc-parsed" aria-label="Links as they will be saved">{parsed.map((l, i) => <ExtLink key={i} href={l.url}>{l.label}</ExtLink>)}</div>}
          </div>
          <div className="pc-fld"><label htmlFor="cf-notes">Notes</label><textarea id="cf-notes" className="pc-in" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="pc-fld"><label htmlFor="cf-days">Follow up after (days)</label><input id="cf-days" className="pc-in" inputMode="numeric" value={days} placeholder={`default ${defaultDays}`} onChange={(e) => setDays(e.target.value)} style={{ width: 120 }} /></div>
        </div>
        <footer>
          <span className="pc-help">Blank follow-up days uses your default of {defaultDays}.</span>
          <div className="r"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} onClick={save}>Save <kbd>⌘↵</kbd></Button></div>
        </footer>
      </div>
    </div>
    </TooltipProvider>
  )
}
