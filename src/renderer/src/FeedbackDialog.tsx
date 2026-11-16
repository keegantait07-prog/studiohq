import { useMemo, useState } from 'react'
import type { Beat, PackResult } from '@shared/types'
import { displayKey } from '@shared/key'
import { parseQuery } from './query'
import { fmtBpm } from './format'
import { copy } from './crmUtils'
import { errMsg } from './salesUtils'
import { Button, Dlg } from './reachUi'

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
      <Dlg title="Feedback link ready" onClose={onClose} closeLabel="Done" size="sm">
        {res.url ? (
          <>
            <div className="pc-fld"><label>Send this link</label><div className="rf-link-row"><code>{res.url}</code><Button variant="outline" size="sm" onClick={() => copy(res.url!)}>Copy</Button><Button variant="outline" size="sm" onClick={() => window.api.openExternal(res.url!)}>Open</Button></div></div>
            <p className="pc-help">Anyone with the link can listen and comment. They don't need an account. Comments appear in Feedback within a few minutes, or press Sync now.</p>
          </>
        ) : (
          <div className="pc-err">{res.deployError ? `Built, but publishing failed: ${res.deployError}` : 'Built locally. Add a Netlify token in Settings to publish it and get a link to send.'}{' '}<Button variant="link" size="xs" onClick={() => window.api.openPackLocal(res.packId)}>Open local preview</Button> (comments only work on the published link).</div>
        )}
        <p className="pc-help">Comments are collected with Netlify Forms. Netlify's free plan allows 100 submissions per month across your site, so heavy feedback may need a paid plan.</p>
      </Dlg>
    )
  }
  return (
    <Dlg
      title="New feedback link" onClose={onClose}
      footer={<><span className="sum">{picked.length} beat{picked.length === 1 ? '' : 's'} selected</span><div className="r"><Button disabled={!picked.length || busy} onClick={go}>{busy ? 'Building previews…' : 'Create link'}</Button></div></>}
    >
      <div className="rf-pick">
        <div className="pc-fld">
          <input className="pc-in" value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Find beats…" aria-label="Find beats" />
          <div className="rf-plist">
            {list.map((b) => (
              <label key={b.id} className={`rf-pit${picked.includes(b.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={picked.includes(b.id)} onChange={() => setPicked((p) => (p.includes(b.id) ? p.filter((x) => x !== b.id) : [...p, b.id]))} />
                <span>{b.title}</span><span className="pc-help">{fmtBpm(b.bpm)} {displayKey(b.key)}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="pc-fld">
          <label>Page title</label><input className="pc-in" value={title} placeholder={pageTitle} onChange={(e) => setTitle(e.target.value)} />
          <label>Message at the top of the page</label><textarea className="pc-in" rows={5} value={intro} onChange={(e) => setIntro(e.target.value)} />
          {!hasToken && <div className="pc-help">No Netlify token yet. You can build the page locally to look at it; add a token in Settings to publish.</div>}
          {error && <div className="pc-err">{error}</div>}
        </div>
      </div>
    </Dlg>
  )
}
