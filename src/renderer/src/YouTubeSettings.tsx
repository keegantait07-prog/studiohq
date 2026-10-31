import { useEffect, useState } from 'react'
import type { Settings as S } from '@shared/types'
import type { YtStatus } from '@shared/ytTypes'

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
    <section>
      <h3>YouTube publisher</h3>
      <p className="help">Studio HQ studies these channels, packages a beat the same way, and uploads it as a private video for you to publish in YouTube Studio.</p>

      <div className="field"><label>Channels to study (a name, @handle or link)</label>
        {s.ytSeedChannels.map((c) => <div className="folder" key={c}><span>{c}</span><button onClick={() => run(() => window.api.setSetting({ ytSeedChannels: s.ytSeedChannels.filter((x) => x !== c) }))}>Remove</button></div>)}
        <div className="folder"><input value={channel} placeholder="e.g. Soulker" onChange={(e) => setChannel(e.target.value)} />
          <button disabled={!channel.trim()} onClick={() => run(async () => { await window.api.setSetting({ ytSeedChannels: [...s.ytSeedChannels, channel.trim()] }); setChannel('') })}>Add</button></div>
      </div>

      <div className="field"><label>Image folder</label>
        <div className="folder"><span>{s.ytImageFolder || 'Not chosen yet'}</span><button onClick={() => run(() => window.api.ytChooseImageFolder())}>Choose…</button></div>
        {st?.imagesLeft != null && <div className={st.imagesLeft < 5 ? 'help warn' : 'help'}>{st.imagesLeft} unused image{st.imagesLeft === 1 ? '' : 's'} left{st.imagesLeft < 5 ? '. Add more soon.' : '.'}</div>}
      </div>

      <div className="field"><label>Google sign-in</label>
        <p className="help">Create a free project at console.cloud.google.com, turn on <i>YouTube Data API v3</i>, and make an OAuth client of type <i>Desktop app</i>. Paste its client ID (and secret, if Google shows one) here.</p>
        <input defaultValue={s.ytClientId} placeholder="Client ID" onBlur={(e) => run(() => window.api.setSetting({ ytClientId: e.target.value.trim() }))} />
        <div className="folder" style={{ marginTop: 6 }}><input type="password" value={google} placeholder="Client secret" onChange={(e) => setGoogle(e.target.value)} />
          <button disabled={!google.trim()} onClick={() => run(async () => { await window.api.ytSetSecret('google', google); setGoogle('') })}>Save</button></div>
        <div className="folder" style={{ marginTop: 6 }}><span>{st?.signedIn ? 'Signed in to Google' : 'Not signed in'}</span>
          {st?.signedIn
            ? <button onClick={() => run(() => window.api.ytSignOut())}>Sign out</button>
            : <button disabled={!st?.hasClientId} onClick={() => run(() => window.api.ytSignIn())}>Sign in…</button>}</div>
      </div>

      <div className="field"><label>Anthropic API key (for writing titles and descriptions)</label>
        {st?.hasAnthropicKey
          ? <div className="folder"><span>Key saved</span><button onClick={() => run(() => window.api.ytSetSecret('anthropic', null))}>Remove</button></div>
          : <div className="folder"><input type="password" value={claude} placeholder="sk-ant-…" onChange={(e) => setClaude(e.target.value)} />
              <button disabled={!claude.trim()} onClick={() => run(async () => { await window.api.ytSetSecret('anthropic', claude); setClaude('') })}>Save</button></div>}
        <div className="help">Without a key the text comes from the built-in templates. Keys and secrets are stored encrypted with the macOS Keychain.</div>
      </div>

      <div className="help">YouTube API quota used today: {st ? st.quotaToday.toLocaleString() : '…'} of Studio HQ's 10,000-unit daily budget. An upload counts as 1,650.</div>
      {st && !st.encryptionOk && <div className="help warn">Secure storage is not available, so secrets cannot be saved.</div>}
      {msg && <div className="help warn">{msg}</div>}
    </section>
  )
}
