import { useMemo, useState } from 'react'
import type { Beat, Settings } from '@shared/types'
import { generateCopy } from '@shared/typebeat'
import { copy } from './crmUtils'

export function CopyPanel({ beat, settings, onTags }: { beat: Beat; settings: Settings | null; onTags: (artists: string[]) => void }) {
  const [free, setFree] = useState(() => { try { return localStorage.getItem('shq-free') !== '0' } catch { return true } })
  const [artist, setArtist] = useState('')
  const [flash, setFlash] = useState('')
  const c = useMemo(
    () => generateCopy(
      { title: beat.title, bpm: beat.bpm, key: beat.key, genre: beat.tags.genre, vibe: beat.tags.vibe, artist: beat.tags.artist },
      { producer: settings?.producerName ?? '', storeUrl: settings?.storeUrl ?? '', email: settings?.contactEmail ?? '', hashtags: settings?.hashtags ?? '' },
      { free, year: new Date().getFullYear() }
    ),
    [beat.id, beat.title, beat.bpm, beat.key, beat.tags, settings, free]
  )
  const [desc, setDesc] = useState<string | null>(null)
  const description = desc ?? c.description
  const say = (m: string, text: string) => { copy(text); setFlash(m); setTimeout(() => setFlash(''), 1400) }
  const tagText = c.tags.join(', ')

  return (
    <div className="copy">
      <div className="copy-top">
        <label className="check"><input type="checkbox" checked={free} onChange={(e) => { setFree(e.target.checked); try { localStorage.setItem('shq-free', e.target.checked ? '1' : '0') } catch { /* ignore */ } setDesc(null) }} /> Free-for-profit style ([FREE] prefix)</label>
        <span className="flash">{flash}</span>
      </div>

      <div className="field">
        <label>Type-beat artists</label>
        <div className="chips">
          {beat.tags.artist.map((a) => <span key={a} className="chip artist">{a}<button onClick={() => onTags(beat.tags.artist.filter((x) => x !== a))}>×</button></span>)}
          <input value={artist} placeholder="e.g. travis scott, don toliver" onChange={(e) => setArtist(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const v = artist.trim().toLowerCase(); if (v && !beat.tags.artist.includes(v)) onTags([...beat.tags.artist, v]); setArtist('') } }} />
        </div>
        {c.missingArtists && <div className="help">Add 1–2 artists this beat sounds like. Type-beat titles and tags are built from them.</div>}
      </div>

      <h3>Titles</h3>
      {c.titles.map((t) => (
        <div key={t} className="titlerow"><span>{t}</span><span className={t.length > 100 ? 'warn mono' : 'dim mono'} title="YouTube allows 100 characters">{t.length}</span><button onClick={() => say('Title copied', t)}>Copy</button></div>
      ))}

      <h3>Description <button className="ghost" onClick={() => say('Description copied', description)}>Copy</button></h3>
      <textarea rows={11} value={description} onChange={(e) => setDesc(e.target.value)} />
      {!settings?.storeUrl && <div className="help">Add your store link and email in Settings and they appear here automatically.</div>}

      <h3>YouTube tags <span className="dim">({tagText.length}/500)</span> <button className="ghost" onClick={() => say('Tags copied', tagText)}>Copy</button></h3>
      <div className="preview">{tagText || '—'}</div>

      <h3>TikTok / Reels caption <button className="ghost" onClick={() => say('Caption copied', c.caption)}>Copy</button></h3>
      <div className="preview">{c.caption}</div>
    </div>
  )
}
