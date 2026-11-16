import { useState } from 'react'
import { PLATFORMS, type Beat, type Platform, type Post } from '@shared/types'
import { BeatPicker } from './BeatPicker'
import { Button, Dlg } from './reachUi'
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
    <Dlg
      title={post ? 'Edit post' : status === 'posted' ? 'Log a post' : 'Plan a post'} onClose={onClose} size="sm"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
      footer={<>
        {post && <Button variant="outline" onClick={async () => { await window.api.deletePost(post.id); onSaved() }}>Delete</Button>}
        <div className="r"><Button disabled={!beatId} onClick={save}>Save <kbd>⌘↵</kbd></Button></div>
      </>}
    >
      <div className="pc-fld"><label>Beat</label><BeatPicker beats={beats} value={beatId} onChange={setBeatId} /></div>
      <div className="pc-two">
        <div className="pc-fld"><label>Platform</label><select className="pc-in" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <div className="pc-fld"><label>Status</label><select className="pc-in" value={status} onChange={(e) => setStatus(e.target.value as Post['status'])}><option value="planned">Planned</option><option value="private">Private on YouTube</option><option value="posted">Posted</option></select></div>
      </div>
      <div className="pc-fld"><label>Date</label><input className="pc-in" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {status !== 'planned' && <div className="pc-fld"><label>Link to the post (optional)</label><input className="pc-in" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} /></div>}
      <div className="pc-fld"><label>Caption / notes</label><textarea className="pc-in" rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
      {caption.trim() && <div className="pc-fld"><label>Preview</label><div className="rc-prev">{caption.slice(0, 140)}</div></div>}
      {error && <div className="pc-err">{error}</div>}
    </Dlg>
  )
}
