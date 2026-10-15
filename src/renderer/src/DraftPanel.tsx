import { useState } from 'react'
import { copy, mailto } from './crmUtils'

interface Props {
  to: string
  subject: string
  body: string
  confirmLabel: string
  link?: string
  notice?: string
  onLocalPreview?: () => void
  onConfirm: (subject: string, body: string) => void | Promise<void>
}

export function DraftPanel({ to, subject: s0, body: b0, confirmLabel, link, notice, onLocalPreview, onConfirm }: Props) {
  const [subject, setSubject] = useState(s0)
  const [body, setBody] = useState(b0)
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const flash = (m: string) => { setDone(m); setTimeout(() => setDone(''), 1500) }

  return (
    <div className="draft">
      {notice && <div className="notice">{notice}{onLocalPreview && <> <a onClick={onLocalPreview}>Open local preview</a></>}</div>}
      {link && (
        <div className="field">
          <label>Private listening page</label>
          <div className="linkrow"><code>{link}</code><button onClick={() => { copy(link); flash('Link copied') }}>Copy</button><button onClick={() => window.api.openExternal(link)}>Open</button></div>
        </div>
      )}
      <div className="field"><label>To</label><input value={to} readOnly placeholder="No email on file. Copy the message instead." /></div>
      <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div className="field"><label>Message</label><textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <div className="draft-actions">
        <button onClick={() => { copy(subject); flash('Subject copied') }}>Copy subject</button>
        <button onClick={() => { copy(body); flash('Message copied') }}>Copy message</button>
        <button disabled={!to} onClick={() => window.api.openExternal(mailto(to, subject, body))}>Open in Mail</button>
        <span className="flash">{done}</span>
        <button className="primary" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(subject, body); setBusy(false) }}>{confirmLabel}</button>
      </div>
    </div>
  )
}
