import { useEffect, useState } from 'react'
import type { NetlifyStatus, Settings as S } from '@shared/types'

export function Settings({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<S | null>(null)
  const [dataPath, setDataPath] = useState('')
  const [msg, setMsg] = useState('')
  const [nl, setNl] = useState<NetlifyStatus | null>(null)
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const load = () => window.api.getSettings().then(setS)
  useEffect(() => { load().then(); window.api.getSettings().then((x) => setName(x.producerName)); window.api.dataPath().then(setDataPath); window.api.netlifyStatus().then(setNl) }, [])
  if (!s) return null

  const list = (kind: 'watchFolders' | 'projectFolders' | 'soundFolders', title: string, help: string) => (
    <section>
      <h3>{title}</h3>
      <p className="help">{help}</p>
      {s[kind].map((f) => (
        <div className="folder" key={f}><span>{f}</span><button onClick={async () => { await window.api.removeFolder(kind, f); load() }}>Remove</button></div>
      ))}
      <button onClick={async () => { await window.api.addFolder(kind); load() }}>Add folder…</button>
    </section>
  )

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header><h2>Settings</h2><button onClick={onClose}>Done</button></header>
        {list('watchFolders', 'Beat folders', 'Every audio file in these folders is imported automatically, and new bounces appear as soon as they finish writing.')}
        <section>
          <label className="check">
            <input type="checkbox" checked={s.includeIdeas} onChange={async (e) => { await window.api.setSetting({ includeIdeas: e.target.checked }); load() }} />
            Include folders named “ideas” / “scraps”
          </label>
        </section>
        {list('soundFolders', 'Sound library folders', 'Drum kits and sample packs, scanned into the Sound Library. Files are never moved or changed.')}
        <section>
          <label className="check"><input type="checkbox" checked={s.includeMidiPacks} onChange={async (e) => { await window.api.setSetting({ includeMidiPacks: e.target.checked }); load(); window.api.soundsScan() }} /> Also index MIDI files inside my sound folders (MIDI packs can be tens of thousands of files)</label>
          <p className="help">MIDI made from your own FL projects is always included.</p>
        </section>
        <section>
          <h3>FL projects as beats</h3>
          <p className="help">Every FL Studio project in your project folders shows up in the Vault as a beat, even before you export it, so a new beat never goes missing. This is how far back to look (0 = every project you've ever made).</p>
          <div className="field"><label>Show projects saved in the last (days)</label><input style={{ width: 100 }} defaultValue={s.projectBeatDays} onBlur={async (e) => { const n = parseInt(e.target.value, 10); if (n >= 0) { await window.api.setSetting({ projectBeatDays: n }); window.api.reindexProjects() } }} /></div>
        </section>
        {list('projectFolders', 'FL Studio project folders', 'Searched for .flp files to link to your bounces. FL’s Backup folders are skipped.')}
        <section>
          <h3>Pitching</h3>
          <div className="two">
            <div className="field"><label>Your producer name (used in emails and pages)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => window.api.setSetting({ producerName: name.trim() })} />
            </div>
            <div className="field"><label>Default follow-up after (days)</label>
              <input defaultValue={s.followupDays} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n > 0) window.api.setSetting({ followupDays: n }) }} />
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={s.notify} onChange={async (e) => { await window.api.setSetting({ notify: e.target.checked }); load() }} /> Send a macOS notification when follow-ups are due</label>
        </section>
        <section>
          <h3>Content & store</h3>
          <p className="help">Used in titles, descriptions and captions so you don't retype them.</p>
          <div className="two">
            <div className="field"><label>Store / lease link</label><input defaultValue={s.storeUrl} placeholder="https://…" onBlur={(e) => window.api.setSetting({ storeUrl: e.target.value.trim() })} /></div>
            <div className="field"><label>Business email</label><input defaultValue={s.contactEmail} onBlur={(e) => window.api.setSetting({ contactEmail: e.target.value.trim() })} /></div>
          </div>
          <div className="field"><label>Default hashtags</label><input defaultValue={s.hashtags} onBlur={(e) => window.api.setSetting({ hashtags: e.target.value.trim() })} /></div>
          <div className="folder" style={{ marginTop: 8 }}><span>Videos are saved to: {s.exportDir}</span><button onClick={async () => { await window.api.chooseExportDir(); load() }}>Change…</button></div>
        </section>
        <section>
          <h3>Netlify (private pitch pages)</h3>
          <p className="help">Pages and audio previews are published to your own Netlify site, under unguessable links. Create a personal access token in Netlify → User settings → Applications, and paste it here. It is stored encrypted with the macOS Keychain.</p>
          {nl?.hasToken ? (
            <div className="folder"><span>Token saved{nl.siteUrl ? ` · ${nl.siteUrl}` : ''}</span><button onClick={async () => { await window.api.setNetlifyToken(null); setNl(await window.api.netlifyStatus()) }}>Remove</button></div>
          ) : (
            <div className="folder"><input type="password" value={token} placeholder="Netlify personal access token" onChange={(e) => setToken(e.target.value)} />
              <button disabled={!token.trim()} onClick={async () => { try { await window.api.setNetlifyToken(token); setToken(''); setNl(await window.api.netlifyStatus()) } catch (e) { setMsg(String((e as Error).message)) } }}>Save</button></div>
          )}
        </section>
        <section>
          <h3>Your data</h3>
          <p className="help">Everything lives in one local database:<br /><code>{dataPath}/studio-hq.db</code></p>
          <button onClick={async () => setMsg('Saved to ' + (await window.api.backup()))}>Back up now</button>{' '}
          <button onClick={async () => { const d = await window.api.exportCsv(); if (d) setMsg('Exported beats and sales (CSV) to ' + d) }}>Export beats and sales (CSV)</button>
          {msg && <p className="help">{msg}</p>}
        </section>
      </div>
    </div>
  )
}
