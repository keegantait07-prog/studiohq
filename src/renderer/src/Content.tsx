import { useMemo, useState } from 'react'
import type { PlayerClock } from './player'
import { PLATFORMS, type Beat, type ContentData, type Post, type Sale, type Settings } from '@shared/types'
import { clickable } from './a11y'
import { displayKey } from '@shared/key'
import { VideoBuilder } from './VideoBuilder'
import { CopyPanel } from './CopyPanel'
import { YouTubePublish } from './YouTubePublish'
import { VideosView } from './VideosView'
import { Calendar } from './Calendar'
import { PostDialog } from './PostDialog'
import { fmtBpm } from './format'
import { platformColor, platformLabel } from './suggest'

interface Props {
  beats: Beat[]
  sales: Sale[]
  content: ContentData
  settings: Settings | null
  beatId: number | null
  onSelectBeat: (id: number | null) => void
  onPlayAt: (id: number, at: number) => void
  reload: () => void
  reloadBeats: () => void
  toast: (m: string) => void
  playId: number | null
  playing: boolean
  playClock: PlayerClock
}

export function ContentView(p: Props) {
  const [tab, setTab] = useState<'create' | 'calendar' | 'videos'>('create')
  const [sub, setSub] = useState<'video' | 'copy' | 'youtube' | 'posts'>('video')
  const [q, setQ] = useState('')
  const [editVideo, setEditVideo] = useState<number | null>(null)
  const [dlg, setDlg] = useState<{ post?: Post; beatId?: number; date?: number; status?: Post['status']; platform?: Post['platform'] } | null>(null)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const seen = new Set<number>()
    return p.beats.filter((b) => (!s || b.title.toLowerCase().includes(s)) && b.status !== 'idea').filter((b) => (seen.has(b.groupId) ? false : (seen.add(b.groupId), true)))
  }, [p.beats, q])
  const beat = p.beats.find((b) => b.id === p.beatId) ?? null
  const postsOf = (id: number) => p.content.posts.filter((x) => x.beatId === id)

  return (
    <section className="contentv">
      <div className="sales-head">
        <h2>Content Machine</h2>
        <div className="seg" style={{ width: 'auto' }}>
          <button className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>Create</button>
          <button className={tab === 'calendar' ? 'on' : ''} onClick={() => setTab('calendar')}>Calendar</button>
          <button className={tab === 'videos' ? 'on' : ''} onClick={() => setTab('videos')}>Videos</button>
        </div>
        <div className="grow" />
        <button className="primary" onClick={() => setDlg({ status: 'planned', beatId: beat?.id })}>+ Plan a post</button>
      </div>

      {tab === 'videos' ? (
        <div className="sales-body"><VideosView toast={p.toast} onEdit={(v) => { p.onSelectBeat(v.beatId); setEditVideo(v.id); setSub('youtube'); setTab('create') }} /></div>
      ) : tab === 'calendar' ? (
        <div className="sales-body">
          <Calendar beats={p.beats} content={p.content} sales={p.sales}
            onEditPost={(post) => setDlg({ post })} onNewPost={(date) => setDlg({ date, status: 'planned' })}
            onMakeVideo={(id) => { p.onSelectBeat(id); setSub('video'); setTab('create') }} reload={p.reload} toast={p.toast} />
        </div>
      ) : (
        <div className="cv-split">
          <div className="cv-list">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a beat…" />
            <div className="cv-rows">
              {list.map((b) => {
                const ps = postsOf(b.id).filter((x) => x.status === 'posted')
                const plats = [...new Set(ps.map((x) => x.platform))]
                return (
                  <div key={b.id} className={`cv-row ${p.beatId === b.id ? 'sel' : ''}`} {...clickable(() => { setEditVideo(null); p.onSelectBeat(b.id) })}>
                    <div className="cn"><b>{b.title}</b><span className="mono dim">{fmtBpm(b.bpm)} {displayKey(b.key)}</span></div>
                    <div className="dots">{plats.length ? plats.map((pl) => <i key={pl} className="sw" style={{ background: platformColor(pl) }} title={`Posted on ${platformLabel(pl)}`} />) : <span className="dim small-note">not posted</span>}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="cv-work">
            {!beat ? <div className="empty">Pick a beat to make a video, write its title and tags, or log where you posted it.</div> : (
              <>
                <div className="cv-beat"><h3>{beat.title}</h3>
                  <div className="seg" style={{ width: 'auto' }}>{([['video', 'Video'], ['copy', 'Titles & tags'], ['youtube', 'YouTube'], ['posts', `Posts (${postsOf(beat.id).length})`]] as const).map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}</button>)}</div>
                </div>
                {sub === 'video' && <VideoBuilder key={beat.id} beat={beat} settings={p.settings} videos={p.content.videos} onPlayAt={p.onPlayAt} onExported={() => { p.reload(); p.reloadBeats() }} toast={p.toast} playId={p.playId} playing={p.playing} playClock={p.playClock} />}
                {sub === 'copy' && <CopyPanel beat={beat} settings={p.settings} onTags={async (artists) => { await window.api.setTags(beat.id, { ...beat.tags, artist: artists }); p.reloadBeats() }} />}
                {sub === 'youtube' && <YouTubePublish key={`${beat.id}-${editVideo ?? 'new'}`} openVideoId={editVideo} beat={beat} settings={p.settings} toast={p.toast} reload={p.reload} reloadBeats={p.reloadBeats} />}
                {sub === 'posts' && (
                  <div>
                    <div className="draft-actions" style={{ marginTop: 0 }}>
                      {PLATFORMS.filter((x) => x.id !== 'other').map((x) => <button key={x.id} onClick={() => setDlg({ beatId: beat.id, platform: x.id, status: 'posted' })}><i className="sw" style={{ background: x.color }} />Posted on {x.label}</button>)}
                    </div>
                    {postsOf(beat.id).map((x) => (
                      <div key={x.id} className="ocard" style={{ marginTop: 10 }}>
                        <div className="ohead"><i className="sw" style={{ background: platformColor(x.platform) }} /><b>{platformLabel(x.platform)}</b><span className={x.status === 'posted' ? 'ps-liked pst' : 'pst'}>{x.status}</span><span className="dim">{new Date(x.date).toLocaleDateString()}</span>
                          {x.url && <a onClick={() => window.api.openExternal(x.url)}>Open post ↗</a>}<button style={{ marginLeft: 'auto' }} onClick={() => setDlg({ post: x })}>Edit</button></div>
                        {x.caption && <div className="sub">{x.caption}</div>}
                      </div>
                    ))}
                    {!postsOf(beat.id).length && <p className="help">Nothing logged for this beat yet.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {dlg && <PostDialog beats={p.beats} post={dlg.post} beatId={dlg.beatId} date={dlg.date} status={dlg.status} platform={dlg.platform} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); p.reload() }} />}
    </section>
  )
}
