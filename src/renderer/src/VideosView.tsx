import { useEffect, useState } from 'react'
import type { VideoFile } from '@shared/types'
import { ago } from './format'
import { Button, Reveal } from './reachUi'

const FORMAT = { vertical: 'Vertical', horizontal: 'Horizontal', youtube: 'YouTube' } as const
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`)

export function VideosView({ toast, onEdit }: { toast: (m: string) => void; onEdit: (v: VideoFile) => void }) {
  const [files, setFiles] = useState<VideoFile[] | null>(null)
  const [sure, setSure] = useState<number | null>(null)
  const load = () => window.api.videosList().then(setFiles)
  useEffect(() => { load().then() }, [])

  const run = async (f: () => Promise<unknown>) => { try { await f() } catch (e) { toast(String((e as Error).message)) } load() }
  if (!files) return <div className="pc-empty rc-empty">Loading…</div>
  if (!files.length) return <div className="pc-empty rc-empty"><b>No finished videos yet</b>Videos you make in Content appear here.</div>

  return (
    <div className="rc-vids">
      <p className="pc-help">{files.length} finished video{files.length === 1 ? '' : 's'}. They are saved in your videos folder (change it in Settings).</p>
      {files.map((v, i) => (
        <Reveal key={v.id} delay={Math.min(i, 8) * 0.03}>
          <div className={`rc-vid${v.exists ? '' : ' gone'}`}>
            <span className="rc-fmt" aria-hidden="true">{(FORMAT[v.format] ?? v.format).slice(0, 4)}</span>
            <div style={{ minWidth: 0 }}>
              <b>{v.beatTitle}</b>
              <small>{FORMAT[v.format] ?? v.format} · {ago(v.createdAt)}{v.exists ? ` · ${size(v.size)}` : ''}{v.youtube ? ` · ${v.youtube.uploaded ? 'Uploaded (private)' : v.youtube.hasDraft ? 'Not uploaded yet' : 'No saved details'}` : ''}</small>
            </div>
            <div className="rc-acts">
              {v.exists ? (
                <>
                  {v.youtube?.uploaded
                    ? <Button size="sm" onClick={() => window.api.ytOpenStudio(v.youtube!.uploaded!.studioUrl)}>Open in YouTube Studio</Button>
                    : v.youtube?.hasDraft
                      ? <Button size="sm" onClick={() => onEdit(v)}>Edit details</Button>
                      : <Button size="sm" onClick={() => run(() => window.api.videoOpen(v.id))}>Play</Button>}
                  {(v.youtube?.hasDraft || v.youtube?.uploaded) && <Button variant="outline" size="sm" onClick={() => run(() => window.api.videoOpen(v.id))}>Play</Button>}
                  <Button variant="outline" size="sm" onClick={() => run(() => window.api.videoReveal(v.id))}>Show in Finder</Button>
                  {sure === v.id
                    ? <Button variant="outline" size="sm" className="pc-warn" onClick={() => { setSure(null); run(async () => { await window.api.videoTrash(v.id); toast('Moved to the Trash') }) }}>Move to Trash?</Button>
                    : <Button variant="ghost" size="sm" onClick={() => setSure(v.id)}>Delete</Button>}
                </>
              ) : (
                <>
                  <span className="pc-help">File not found</span>
                  <Button variant="outline" size="sm" onClick={() => run(() => window.api.videoTrash(v.id))}>Remove from list</Button>
                </>
              )}
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  )
}
