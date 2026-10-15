import { useState } from 'react'
import { PLATFORMS, type Beat, type Platform, type Post } from '@shared/types'
import { BeatPicker } from './BeatPicker'
import { errMsg, fromInputDate, toInputDate } from './salesUtils'

interface Props {
  beats: Beat[]
  post?: Post
  beatId?: number
  platform?: Platform
  date?: number
  status?: Post['status']
  caption?: string
  onClose: () => void
  onSaved: () => void
}

export function PostDialog({ beats, post, beatId: b0, platform: p0, date: d0, status: s0, caption: c0, onClose, onSaved }: Props) {
  const [beatId, setBeatId] = useState<number | null>(post?.beatId ?? b0 ?? null)
  const [platform, setPlatform] = useState<Platform>(post?.platform ?? p0 ?? 'tiktok')
  const [status, setStatus] = useState<Post['status']>(post?.status ?? s0 ?? 'planned')
  const [date, setDate] = useState(toInputDate(post?.date ?? d0 ?? Date.now()))
  const [url, setUrl] = useState(post?.url ?? '')
  const [caption, setCaption] = useState(post?.caption ?? c0 ?? '')
  const [error, setError] = useState('')

  const save = async () => {
    if (!beatId) return
    try {
      await window.api.savePost({ id: post?.id, beatId, platform, status, date: fromInputDate(date), url: url.trim(), caption })
      onSaved()
    } catch (e) { setError(errMsg(e)) }
  }
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}>
        <header><h2>{post ? 'Edit post' : status === 'posted' ? 'Log a post' : 'Plan a post'}</h2><button onClick={onClose}>Cancel</button></header>
        <div className="field"><label>Beat</label><BeatPicker beats={beats} value={beatId} onChange={setBeatId} /></div>
        <div className="three">
          <div className="field"><label>Platform</label><select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
          <div className="field"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value as Post['status'])}><option value="planned">Planned</option><option value="posted">Posted</option></select></div>
          <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {status === 'posted' && <div className="field"><label>Link to the post (optional)</label><input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} /></div>}
        <div className="field"><label>Caption / notes</label><textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
        {error && <div className="notice err">{error}</div>}
        <div className="draft-actions">
          {post && <button onClick={async () => { await window.api.deletePost(post.id); onSaved() }}>Delete</button>}
          <span className="flash" />
          <button className="primary" disabled={!beatId} onClick={save}>Save <kbd>⌘↵</kbd></button>
        </div>
      </div>
    </div>
  )
}
