import { useEffect, useState } from 'react'
import { Button, Row } from './settingsUi'

type Name = 'soundcloud' | 'audiomack' | 'x'

const CARDS: Array<{ name: Name; label: string; text: string }> = [
  { name: 'soundcloud', label: 'SoundCloud', text: 'Finds artists with small followings. Paste an API access token.' },
  { name: 'audiomack', label: 'Audiomack', text: 'Finds artists with small followings. Paste an API key.' },
  { name: 'x', label: 'X', text: 'Finds recent posts asking for beats. Paste an API bearer token. X charges for API access.' }
]

function Card({ name, label, text, saved, refresh }: { name: Name; label: string; text: string; saved: boolean; refresh: () => void }) {
  const [value, setValue] = useState('')
  const [msg, setMsg] = useState('')
  const run = async (v: string | null) => {
    setMsg('')
    try { await window.api.leadsSetKey(name, v); setValue('') } catch (e) { setMsg(String((e as Error).message)) }
    refresh()
  }
  return (
    <div className="set-src">
      <h4 className="set-sub">{label}{saved && <span className="sx-chip ok">Saved</span>}</h4>
      <p className="sx-help">{text} Access depends on {label} granting API access to your account.</p>
      <div className="set-inrow">
        <input className="sx-in" type="password" value={value} aria-label={`${label} key`} placeholder={saved ? 'Saved. Paste a new key to replace it' : 'Key'} onChange={(e) => setValue(e.target.value)} />
        <Button variant="outline" disabled={!value.trim()} onClick={() => run(value)}>Save</Button>
        <Button variant="ghost" disabled={!saved} onClick={() => run(null)}>Remove</Button>
      </div>
      {msg && <p className="sx-help sx-warn" role="alert">{msg}</p>}
    </div>
  )
}

export function LeadSourceSettings({ onChange }: { onChange?: () => void } = {}) {
  const [st, setSt] = useState<Record<Name, boolean> | null>(null)
  const refresh = () => { window.api.leadsKeyStatus().then(setSt).catch(() => setSt(null)); onChange?.() }
  useEffect(() => { window.api.leadsKeyStatus().then(setSt).catch(() => setSt(null)) }, [])
  return (
    <Row id="leads" title="Lead sources" help="Keys are stored encrypted with the macOS Keychain and never leave this computer except to the service you connect.">
      {CARDS.map((c) => <Card key={c.name} {...c} saved={!!st?.[c.name]} refresh={refresh} />)}
    </Row>
  )
}
