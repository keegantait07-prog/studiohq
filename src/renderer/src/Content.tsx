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
import { Search, Plus } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { ScrollArea } from '@/components/lib/scroll-area'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/lib/carousel'
import { TypingAnimation } from '@/components/lib/typing-animation'
import { Button, ChartCard, Num, Reveal, Seg, SPAN } from './reachUi'
import { postsSeries } from './contentSeries'
import type { MadePeriod } from './dashUtils'

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
  const [period, setPeriod] = useState<MadePeriod>('Weekly')
  const [pop, setPop] = useState(false)
  const [now] = useState(() => Date.now())
  const still = useReducedMotion()
  const [editVideo, setEditVideo] = useState<number | null>(null)
  const [dlg, setDlg] = useState<{ post?: Post; beatId?: number; date?: number; status?: Post['status']; platform?: Post['platform'] } | null>(null)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const seen = new Set<number>()
    return p.beats.filter((b) => (!s || b.title.toLowerCase().includes(s)) && b.status !== 'idea').filter((b) => (seen.has(b.groupId) ? false : (seen.add(b.groupId), true)))
  }, [p.beats, q])
  const beat = p.beats.find((b) => b.id === p.beatId) ?? null
  const postsOf = (id: number) => p.content.posts.filter((x) => x.beatId === id)
  const ser = useMemo(() => postsSeries(p.content.posts, period, now), [p.content.posts, period, now])
  const total = ser.data.reduce((a, b) => a + b, 0)
  const planned = p.content.posts.filter((x) => x.status === 'planned').length
  const posted = p.content.posts.filter((x) => x.status === 'posted').length

  return (
    <section className="rc">
      <header className="rc-head">
        <div>
          <div className="rx-h">Get heard</div>
          <h2 className="rx-title">Content Machine</h2>
          <div className="rc-row">
            <Seg tabs label="Section" value={tab} onChange={setTab} options={[{ v: 'create', label: 'Create' }, { v: 'calendar', label: 'Calendar' }, { v: 'videos', label: 'Videos' }]} />
            <div className="rc-tk" role="group" aria-label={`${planned} posts planned, ${posted} posted, ${p.content.videos.length} videos made`}>
              <span><b><Num value={planned} /></b>planned</span><span><b><Num value={posted} /></b>posted</span><span><b><Num value={p.content.videos.length} /></b>videos</span>
            </div>
          </div>
        </div>
        <div className="rc-row">
          <Button variant="outline" size="sm" className="rx-narrow" onClick={() => setPop((v) => !v)}>Chart</Button>
          <Button onClick={() => setDlg({ status: 'planned', beatId: beat?.id })}><Plus aria-hidden="true" />Plan a post</Button>
        </div>
      </header>

      <div className="rc-body">
        <div className="rc-main">
          {tab === 'videos' ? (
            <VideosView toast={p.toast} onEdit={(v) => { p.onSelectBeat(v.beatId); setEditVideo(v.id); setSub('youtube'); setTab('create') }} />
          ) : tab === 'calendar' ? (
            <div className="rc-pane-only">
              <Calendar beats={p.beats} content={p.content} sales={p.sales}
                onEditPost={(post) => setDlg({ post })} onNewPost={(date) => setDlg({ date, status: 'planned' })}
                onMakeVideo={(id) => { p.onSelectBeat(id); setSub('video'); setTab('create') }} reload={p.reload} toast={p.toast} />
            </div>
          ) : (
            <div className="rc-create">
              <div className="rc-list">
                <div className="rc-search"><div className="pc-search"><Search aria-hidden="true" /><input className="pc-in" aria-label="Find a beat" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a beat…" /></div></div>
                <ScrollArea className="rc-rows h-full min-h-0">
                  {list.map((b) => {
                    const ps = postsOf(b.id).filter((x) => x.status === 'posted')
                    const plats = [...new Set(ps.map((x) => x.platform))]
                    return (
                      <button key={b.id} type="button" className="rc-cv" aria-pressed={p.beatId === b.id} onClick={() => { setEditVideo(null); p.onSelectBeat(b.id) }}>
                        <span style={{ minWidth: 0 }}><b>{b.title}</b><small>{fmtBpm(b.bpm)} {displayKey(b.key)}</small></span>
                        <span className="rc-dots">{plats.length ? plats.map((pl) => <i key={pl} className="rc-sw" style={{ ['--c' as string]: platformColor(pl) }} title={`Posted on ${platformLabel(pl)}`} />) : <small>not posted</small>}</span>
                      </button>
                    )
                  })}
                </ScrollArea>
              </div>
              <div className="rc-work">
                {!beat ? <div className="pc-empty rc-empty"><b>Pick a beat</b>Pick a beat to make a video, write its title and tags, or log where you posted it.</div> : (
                  <>
                    <div className="rc-beat"><h3>{beat.title}</h3>
                      <Seg tabs label="Beat tools" value={sub} onChange={setSub} options={[{ v: 'video', label: 'Video' }, { v: 'copy', label: 'Titles & tags' }, { v: 'youtube', label: 'YouTube' }, { v: 'posts', label: `Posts (${postsOf(beat.id).length})` }]} />
                    </div>
                    <div className="rc-pane">
                      {sub === 'video' && <VideoBuilder key={beat.id} beat={beat} settings={p.settings} videos={p.content.videos} onPlayAt={p.onPlayAt} onExported={() => { p.reload(); p.reloadBeats() }} toast={p.toast} playId={p.playId} playing={p.playing} playClock={p.playClock} />}
                      {sub === 'copy' && <CopyPanel beat={beat} settings={p.settings} onTags={async (artists) => { await window.api.setTags(beat.id, { ...beat.tags, artist: artists }); p.reloadBeats() }} />}
                      {sub === 'youtube' && <YouTubePublish key={`${beat.id}-${editVideo ?? 'new'}`} openVideoId={editVideo} beat={beat} settings={p.settings} toast={p.toast} reload={p.reload} reloadBeats={p.reloadBeats} />}
                      {sub === 'posts' && (
                        <div className="rc-posts">
                          <div className="rc-log" role="group" aria-label="Log a post">
                            {PLATFORMS.filter((x) => x.id !== 'other').map((x) => <Button key={x.id} variant="outline" size="sm" onClick={() => setDlg({ beatId: beat.id, platform: x.id, status: 'posted' })}><i className="rc-sw" style={{ ['--c' as string]: x.color }} />Posted on {x.label}</Button>)}
                          </div>
                          {postsOf(beat.id).length > 0 && (
                            <div className="rc-car">
                              <Carousel opts={{ align: 'start', dragFree: true }} aria-label="Posts by platform">
                                <CarouselContent>
                                  {postsOf(beat.id).map((x, i) => (
                                    <CarouselItem key={x.id} className="basis-[240px]">
                                      <Reveal delay={Math.min(i, 6) * 0.04}>
                                        <article className="rc-pcard" style={{ ['--c' as string]: platformColor(x.platform) }}>
                                          <h4>{platformLabel(x.platform)}<span className="pc-pill">{x.status}</span></h4>
                                          <span className="pc-help">{new Date(x.date).toLocaleDateString()}</span>
                                          <div className="rc-cap">{x.caption ? (still ? x.caption : <TypingAnimation duration={22} showCursor={false}>{x.caption.slice(0, 90)}</TypingAnimation>) : <span className="pc-help">No caption</span>}</div>
                                          <div className="pc-row">
                                            {x.url && <Button variant="link" size="xs" className="pc-xlink" onClick={() => window.api.openExternal(x.url)}>Open post</Button>}
                                            <span className="pc-sp" />
                                            <Button variant="outline" size="xs" onClick={() => setDlg({ post: x })}>Edit</Button>
                                          </div>
                                        </article>
                                      </Reveal>
                                    </CarouselItem>
                                  ))}
                                </CarouselContent>
                                <CarouselPrevious /><CarouselNext />
                              </Carousel>
                            </div>
                          )}
                          {!postsOf(beat.id).length && <p className="pc-help">Nothing logged for this beat yet.</p>}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <aside className={`rc-aside${pop ? ' pop' : ''}`} aria-label="Posts chart">
          <ChartCard label="Posts published" accent="--sent" data={ser.data} labels={ser.labels} value={total} period={period} onPeriod={setPeriod}
            title="Posts published" caption={SPAN[period]} updatedText={`${planned} more planned`} unit={(n) => `${n} post${n === 1 ? '' : 's'}`} />
        </aside>
      </div>
      {dlg && <PostDialog beats={p.beats} post={dlg.post} beatId={dlg.beatId} date={dlg.date} status={dlg.status} platform={dlg.platform} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); p.reload() }} />}
    </section>
  )
}
