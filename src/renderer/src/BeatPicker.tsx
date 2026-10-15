import { useMemo, useState } from 'react'
import type { Beat } from '@shared/types'
import { displayKey } from '@shared/key'
import { fmtBpm } from './format'

export function BeatPicker({ beats, value, onChange }: { beats: Beat[]; value: number | null; onChange: (id: number | null) => void }) {
  const [q, setQ] = useState('')
  const beat = beats.find((b) => b.id === value)
  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (s ? beats.filter((b) => b.title.toLowerCase().includes(s) || b.filename.toLowerCase().includes(s)) : beats).slice(0, 7)
  }, [beats, q])
  if (beat) return <div className="folder"><span><b>{beat.title}</b> <span className="dim mono">{fmtBpm(beat.bpm)} {displayKey(beat.key)} · {beat.status}</span></span><button onClick={() => onChange(null)}>Change</button></div>
  return (
    <>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your beats…" />
      <div className="plist" style={{ height: 'auto', maxHeight: 200, marginTop: 6 }}>
        {results.map((b) => (
          <div key={b.id} className="pitem" style={{ gridTemplateColumns: '1fr auto 10px' }} onClick={() => onChange(b.id)}>
            <span className="pt">{b.title}</span><span className="mono dim">{fmtBpm(b.bpm)} {displayKey(b.key)}</span><span className={`dot st-${b.status}`} />
          </div>
        ))}
      </div>
    </>
  )
}
