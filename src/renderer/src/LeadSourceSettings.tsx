import { useEffect, useState } from 'react'

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
    <div className="field"><label>{label}</label>
      <p className="help">{text} Access depends on {label} granting API access to your account.</p>
      <div className="folder"><input type="password" value={value} placeholder={saved ? 'Saved. Paste a new key to replace it' : 'Key'} onChange={(e) => setValue(e.target.value)} />
        <button disabled={!value.trim()} onClick={() => run(value)}>Save</button>
        <button disabled={!saved} onClick={() => run(null)}>Remove</button></div>
      {saved && <div className="help">Saved</div>}
      {msg && <div className="help warn">{msg}</div>}
    </div>
  )
}

export function LeadSourceSettings() {
  const [st, setSt] = useState<Record<Name, boolean> | null>(null)
  const refresh = () => { window.api.leadsKeyStatus().then(setSt).catch(() => setSt(null)) }
  useEffect(refresh, [])
  return (
    <section>
      <h3>Lead sources</h3>
      <p className="help">Keys are stored encrypted with the macOS Keychain and never leave this computer except to the service you connect.</p>
      {CARDS.map((c) => <Card key={c.name} {...c} saved={!!st?.[c.name]} refresh={refresh} />)}
    </section>
  )
}
