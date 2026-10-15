import { useEffect, useState } from 'react'
import type { Settings as S } from '@shared/types'

export function Settings({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<S | null>(null)
  const [dataPath, setDataPath] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => window.api.getSettings().then(setS)
  useEffect(() => { load(); window.api.dataPath().then(setDataPath) }, [])
  if (!s) return null

  const list = (kind: 'watchFolders' | 'projectFolders', title: string, help: string) => (
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
        {list('projectFolders', 'FL Studio project folders', 'Searched for .flp files to link to your bounces. FL’s Backup folders are skipped.')}
        <section>
          <h3>Your data</h3>
          <p className="help">Everything lives in one local database:<br /><code>{dataPath}/studio-hq.db</code></p>
          <button onClick={async () => setMsg('Saved to ' + (await window.api.backup()))}>Back up now</button>
          {msg && <p className="help">{msg}</p>}
        </section>
      </div>
    </div>
  )
}
