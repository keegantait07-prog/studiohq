import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Settings as S } from '@shared/types'
import type { YtStatus } from '@shared/ytTypes'
import { Button, Line, Row } from './settingsUi'

export function YouTubeSettings({ s, reload }: { s: S; reload: () => void }) {
  const [st, setSt] = useState<YtStatus | null>(null)
  const [channel, setChannel] = useState('')
  const [google, setGoogle] = useState('')
  const [claude, setClaude] = useState('')
  const [msg, setMsg] = useState('')
  const refresh = () => window.api.ytStatus().then(setSt)
  useEffect(() => { refresh().then() }, [s.ytImageFolder])
  const run = async (f: () => Promise<unknown>) => { setMsg(''); try { await f() } catch (e) { setMsg(String((e as Error).message)) } refresh(); reload() }

  return (
    <Row id="youtube" title="YouTube publisher" help="Studio HQ studies these channels, packages a beat the same way, and uploads it as a private video for you to publish in YouTube Studio.">
      <h4 className="set-sub">Channels to study (a name, @handle or link)</h4>
      {s.ytSeedChannels.map((c) => (
        <Line key={c} actions={<Button variant="ghost" size="sm" onClick={() => run(() => window.api.setSetting({ ytSeedChannels: s.ytSeedChannels.filter((x) => x !== c) }))}><X aria-hidden="true" />Remove</Button>}>{c}</Line>
      ))}
      <div className="set-inrow">
        <input className="sx-in" value={channel} placeholder="e.g. Soulker" aria-label="Channel to study" onChange={(e) => setChannel(e.target.value)} />
        <Button variant="outline" disabled={!channel.trim()} onClick={() => run(async () => { await window.api.setSetting({ ytSeedChannels: [...s.ytSeedChannels, channel.trim()] }); setChannel('') })}>Add</Button>
      </div>

      <h4 className="set-sub">Image folder</h4>
      <Line mono actions={<Button variant="outline" size="sm" onClick={() => run(() => window.api.ytChooseImageFolder())}>Choose…</Button>}>{s.ytImageFolder || 'Not chosen yet'}</Line>
      {st?.imagesLeft != null && <p className={st.imagesLeft < 5 ? 'sx-help sx-warn' : 'sx-help'}>{st.imagesLeft} unused image{st.imagesLeft === 1 ? '' : 's'} left{st.imagesLeft < 5 ? '. Add more soon.' : '.'}</p>}

      <h4 className="set-sub">Google sign-in</h4>
      <p className="sx-help">Create a free project at console.cloud.google.com, turn on <i>YouTube Data API v3</i>, and make an OAuth client of type <i>Desktop app</i>. Paste its client ID (and secret, if Google shows one) here.</p>
      <input className="sx-in" defaultValue={s.ytClientId} placeholder="Client ID" aria-label="Google client ID" onBlur={(e) => run(() => window.api.setSetting({ ytClientId: e.target.value.trim() }))} />
      <div className="set-inrow">
        <input className="sx-in" type="password" value={google} placeholder="Client secret" aria-label="Google client secret" onChange={(e) => setGoogle(e.target.value)} />
        <Button variant="outline" disabled={!google.trim()} onClick={() => run(async () => { await window.api.ytSetSecret('google', google); setGoogle('') })}>Save</Button>
      </div>
      <Line actions={st?.signedIn
        ? <Button variant="ghost" size="sm" onClick={() => run(() => window.api.ytSignOut())}>Sign out</Button>
        : <Button size="sm" disabled={!st?.hasClientId} onClick={() => run(() => window.api.ytSignIn())}>Sign in…</Button>}>
        {st?.signedIn ? 'Signed in to Google' : 'Not signed in'}
      </Line>

      <h4 className="set-sub">Anthropic API key (for writing titles and descriptions)</h4>
      {st?.hasAnthropicKey
        ? <Line actions={<Button variant="ghost" size="sm" onClick={() => run(() => window.api.ytSetSecret('anthropic', null))}>Remove</Button>}>Key saved</Line>
        : <div className="set-inrow">
            <input className="sx-in" type="password" value={claude} placeholder="sk-ant-…" aria-label="Anthropic API key" onChange={(e) => setClaude(e.target.value)} />
            <Button variant="outline" disabled={!claude.trim()} onClick={() => run(async () => { await window.api.ytSetSecret('anthropic', claude); setClaude('') })}>Save</Button>
          </div>}
      <p className="sx-help">Without a key the text comes from the built-in templates. Keys and secrets are stored encrypted with the macOS Keychain.</p>

      <p className="sx-help">YouTube API quota used today: {st ? st.quotaToday.toLocaleString() : '…'} of Studio HQ's 10,000-unit daily budget. An upload counts as 1,650.</p>
      {st && !st.encryptionOk && <p className="sx-help sx-warn">Secure storage is not available, so secrets cannot be saved.</p>}
      {msg && <p className="sx-help sx-warn" role="alert">{msg}</p>}
    </Row>
  )
}
