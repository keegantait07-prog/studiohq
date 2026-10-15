import { useMemo, useState } from 'react'
import type { Beat, PackResult } from '@shared/types'
import { displayKey } from '@shared/key'
import { parseQuery } from './query'
import { fmtBpm } from './format'
import { copy } from './crmUtils'
import { errMsg } from './salesUtils'

export function FeedbackDialog({ beats, initial, hasToken, onClose, onBuilt }: { beats: Beat[]; initial?: number[]; hasToken: boolean; onClose: () => void; onBuilt: () => void }) {
  const [picked, setPicked] = useState<number[]>(initial ?? [])
  const [q, setQ] = useState('')
  const [title, setTitle] = useState('')
  const [intro, setIntro] = useState('Thanks for listening. Play it through and drop a comment at any moment you want to react to: what works, what to change, anything.')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<PackResult | null>(null)
  const [error, setError] = useState('')
  const parsed = useMemo(() => parseQuery(q), [q])
  const list = useMemo(() => {
    const seen = new Set<number>()
    return beats.filter((b) => parsed.test(b)).filter((b) => (seen.has(b.groupId) && !picked.includes(b.id) ? false : (seen.add(b.groupId), true)))
  }, [beats, parsed, picked])
  const first = beats.find((b) => b.id === picked[0])
  const pageTitle = title || (picked.length === 1 && first ? `Feedback on “${first.title}”` : 'Beat feedback')

  const go = async () => {
    setBusy(true); setError('')
    try { setRes(await window.api.buildFeedback({ title: pageTitle, intro, beatIds: picked })); onBuilt() } catch (e) { setError(errMsg(e)) }
    setBusy(false)
  }

  if (res) {
    return (
      <div className="overlay" onMouseDown={onClose}>
        <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
          <header><h2>Feedback link ready</h2><button onClick={onClose}>Done</button></header>
          {res.url ? (
            <>
              <div className="field"><label>Send this link</label><div className="linkrow"><code>{res.url}</code><button onClick={() => copy(res.url!)}>Copy</button><button onClick={() => window.api.openExternal(res.url!)}>Open</button></div></div>
              <p className="help">Anyone with the link can listen and comment. They don't need an account. Comments appear in Feedback within a few minutes, or press Sync now.</p>
            </>
          ) : (
            <div className="notice">{res.deployError ? `Built, but publishing failed: ${res.deployError}` : 'Built locally. Add a Netlify token in Settings to publish it and get a link to send.'}{' '}<a onClick={() => window.api.openPackLocal(res.packId)}>Open local preview</a> (comments only work on the published link).</div>
          )}
          <p className="help">Comments are collected with Netlify Forms. Netlify's free plan allows 100 submissions per month across your site, so heavy feedback may need a paid plan.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal wide-modal pitch" onMouseDown={(e) => e.stopPropagation()}>
        <header><h2>New feedback link</h2><button onClick={onClose}>Cancel</button></header>
        <div className="pitch-grid">
          <div className="picker">
            <input value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Find beats…" />
            <div className="plist">
              {list.map((b) => (
                <label key={b.id} className={`pitem ${picked.includes(b.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.includes(b.id)} onChange={() => setPicked((p) => (p.includes(b.id) ? p.filter((x) => x !== b.id) : [...p, b.id]))} />
                  <span className="pt">{b.title}</span><span className="mono dim">{fmtBpm(b.bpm)} {displayKey(b.key)}</span><span className={`dot st-${b.status}`} />
                </label>
              ))}
            </div>
          </div>
          <div className="opts">
            <div className="field"><label>Page title</label><input value={title} placeholder={pageTitle} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="field"><label>Message at the top of the page</label><textarea rows={5} value={intro} onChange={(e) => setIntro(e.target.value)} /></div>
            {!hasToken && <div className="help">No Netlify token yet. You can build the page locally to look at it; add a token in Settings to publish.</div>}
            {error && <div className="notice err">{error}</div>}
            <div className="selected-note">{picked.length} beat{picked.length === 1 ? '' : 's'} selected</div>
            <button className="primary" disabled={!picked.length || busy} onClick={go}>{busy ? 'Building previews…' : 'Create link'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
