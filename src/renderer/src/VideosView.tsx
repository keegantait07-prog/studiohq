import { useEffect, useState } from 'react'
import type { VideoFile } from '@shared/types'
import { ago } from './format'

const FORMAT = { vertical: 'Vertical', horizontal: 'Horizontal', youtube: 'YouTube' } as const
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`)

export function VideosView({ toast }: { toast: (m: string) => void }) {
  const [files, setFiles] = useState<VideoFile[] | null>(null)
  const [sure, setSure] = useState<number | null>(null)
  const load = () => window.api.videosList().then(setFiles)
  useEffect(() => { load().then() }, [])

  const run = async (f: () => Promise<unknown>) => { try { await f() } catch (e) { toast(String((e as Error).message)) } load() }
  if (!files) return <div className="empty">Loading…</div>
  if (!files.length) return <div className="empty">No finished videos yet. Videos you make in Content appear here.</div>

  return (
    <div className="vids">
      <p className="help">{files.length} finished video{files.length === 1 ? '' : 's'}. They are saved in your videos folder (change it in Settings).</p>
      {files.map((v) => (
        <div key={v.id} className={`ocard ${v.exists ? '' : 'due'}`}>
          <div className="ohead">
            <b>{v.beatTitle}</b>
            <span className="pst">{FORMAT[v.format] ?? v.format}</span>
            <span className="dim">{ago(v.createdAt)}{v.exists ? ` · ${size(v.size)}` : ''}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {v.exists ? (
                <>
                  <button className="primary" onClick={() => run(() => window.api.videoOpen(v.id))}>Play</button>
                  <button onClick={() => run(() => window.api.videoReveal(v.id))}>Show in Finder</button>
                  {sure === v.id
                    ? <button onClick={() => { setSure(null); run(async () => { await window.api.videoTrash(v.id); toast('Moved to the Trash') }) }}>Move to Trash?</button>
                    : <button onClick={() => setSure(v.id)}>Delete</button>}
                </>
              ) : (
                <>
                  <span className="dim">File not found</span>
                  <button onClick={() => run(() => window.api.videoTrash(v.id))}>Remove from list</button>
                </>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
