import { presetGroups, type LeadPreset } from '@shared/leadPresets'
import { useCallback, useEffect, useState } from 'react'
import type { Lead, LeadSource, LeadStatus } from '@shared/leads'
import { clickable } from './a11y'
import { ago } from './format'
import { errMsg } from './salesUtils'
import {
  DEFAULT_FILTER, SOURCE_LABEL, STATUS_LABEL, apiFilter, emailSourceLabel, fmtFollowers, isDefaultFilter, reasonText, scoreBand, toPromote, visibleLeads,
  type LeadFilterUi
} from './leadsUtils'

const SOURCES = Object.keys(SOURCE_LABEL) as LeadSource[]
const STATUSES = Object.keys(STATUS_LABEL) as LeadStatus[]
const MIN_SCORES = [0, 45, 60, 70, 85]

/** Leads: artists found or imported, ranked by fit, with bulk Add to CRM / Skip and a per-row Pitch. */
export function Leads({ onPitch }: { onPitch: (contactId: number) => void }) {
  const [filter, setFilter] = useState<LeadFilterUi>(DEFAULT_FILTER)
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [looking, setLooking] = useState<number | null>(null)
  const [searchSource, setSearchSource] = useState<LeadSource>('youtube')
  const [query, setQuery] = useState('')
  const [preset, setPreset] = useState<LeadPreset | null>(null)
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    try {
      const all = visibleLeads(await window.api.leadsList(apiFilter(filter)), filter)
      setLeads(all)
      setSel((s) => new Set([...s].filter((id) => all.some((l) => l.id === id))))
      setLoadError('')
    } catch (e) {
      setLoadError(`Could not load leads: ${errMsg(e)}`)
    }
  }, [filter])

  useEffect(() => {
    load()
    return window.api.onCrmChanged(load)
  }, [load])

  const set = <K extends keyof LeadFilterUi>(k: K, v: LeadFilterUi[K]) => setFilter((f) => ({ ...f, [k]: v }))
  const flip = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const rows = leads ?? []
  const allOn = rows.length > 0 && rows.every((l) => sel.has(l.id))

  const addToCrm = async () => {
    const todo = toPromote(rows, sel)
    setBusy(true); setNotice(''); setError('')
    let done = 0
    try {
      for (const l of todo) { await window.api.leadsPromote(l.id); done++ }
      const already = sel.size - todo.length
      setNotice(`Added ${done} to Pitch CRM${already ? `. ${already} already there.` : '.'}`)
      setSel(new Set())
    } catch (e) {
      setError(`Added ${done} of ${todo.length}, then stopped: ${errMsg(e)}`)
    }
    setBusy(false)
    load()
  }

  const skip = async () => {
    setBusy(true); setNotice(''); setError('')
    try {
      await window.api.leadsSkip([...sel])
      setNotice(`Skipped ${sel.size}.`)
      setSel(new Set())
    } catch (e) {
      setError(`Could not skip: ${errMsg(e)}`)
    }
    setBusy(false)
    load()
  }

  const pitch = async (l: Lead) => {
    setNotice(''); setError('')
    if (!l.email) { setNotice(`${l.name} has no email yet. Add an email before pitching.`); return }
    try {
      // promote is idempotent: it returns the linked live contact, or re-links one if that contact was archived
      onPitch(await window.api.leadsPromote(l.id))
    } catch (e) {
      setError(`Could not open the pitch: ${errMsg(e)}`)
    }
  }

  const findEmail = async (l: Lead) => {
    setLooking(l.id); setNotice(''); setError('')
    try {
      const r = await window.api.leadsLookupContact(l.id)
      if (r.found) setNotice(`Found ${r.email} for ${l.name}.`)
      else setNotice(r.reason)
    } catch (e) {
      setError(`Could not look up an email: ${errMsg(e)}`)
    }
    setLooking(null)
    load()
  }

  const search = async () => {
    setSearching(true); setNotice(''); setError('')
    try {
      const opts = preset && preset.source === 'youtube' && query === preset.query ? { maxSubs: preset.maxSubs, days: preset.days } : undefined
      const r = await window.api.leadsSearch(searchSource, query, opts)
      if ('error' in r) setError(r.error)
      else if (!r.added && !r.duplicates) setNotice('No new artists found.')
      else setNotice(`Added ${r.added} lead${r.added === 1 ? '' : 's'}${r.duplicates ? `, ${r.duplicates} already in your list` : ''}.`)
    } catch (e) {
      setError(`Search failed: ${errMsg(e)}`)
    }
    setSearching(false)
    load()
  }

  const empty = leads !== null && !rows.length
  return (
    <section className="sales">
      <div className="sales-head">
        <h2>Leads</h2>
        <div className="grow" />
        <select
          className="grp" aria-label="Search presets" value={preset?.id ?? ''}
          onChange={(e) => {
            const p = presetGroups().flatMap((g) => g.presets).find((x) => x.id === e.target.value) ?? null
            setPreset(p)
            if (p) { setSearchSource(p.source); setQuery(p.query) }
          }}
        >
          <option value="">Presets…</option>
          {presetGroups().map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
          ))}
        </select>
        <select className="grp" aria-label="Search source" value={searchSource} onChange={(e) => { setSearchSource(e.target.value as LeadSource); setPreset(null) }}>
          <option value="youtube">{SOURCE_LABEL.youtube}</option>
          <option value="reddit">{SOURCE_LABEL.reddit}</option>
          <option value="soundcloud">{SOURCE_LABEL.soundcloud}</option>
          <option value="audiomack">{SOURCE_LABEL.audiomack}</option>
          <option value="x">{SOURCE_LABEL.x}</option>
        </select>
        <input
          aria-label="Search for artists" placeholder={searchSource === 'reddit' || searchSource === 'x' ? 'looking for beats' : 'trap rapper'} value={query}
          onChange={(e) => { setQuery(e.target.value); if (preset && e.target.value !== preset.query) setPreset(null) }} onKeyDown={(e) => { if (e.key === 'Enter' && !searching) search() }}
        />
        <button disabled={searching} onClick={search}>{searching ? 'Searching…' : 'Search'}</button>
        <button className="primary" onClick={() => setImporting(true)}>Paste or import</button>
      </div>
      <div className="sales-body">
        {preset && (
          <p className="help" style={{ margin: '0 0 10px' }}>
            {preset.note}
            {preset.source === 'youtube' && ` Under ${(preset.maxSubs ?? 0).toLocaleString()} subscribers, uploaded in the last ${preset.days} days. A search uses about 100 of your daily YouTube quota.`}
          </p>
        )}
        <div className="subbar" style={{ padding: '0 0 10px', flexWrap: 'wrap' }}>
          <label className="check small">Source
            <select className="grp" value={filter.source} onChange={(e) => set('source', e.target.value as LeadFilterUi['source'])}>
              <option value="all">All sources</option>
              {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="check small">Score
            <select className="grp" value={filter.minScore} onChange={(e) => set('minScore', Number(e.target.value))}>
              {MIN_SCORES.map((n) => <option key={n} value={n}>{n ? `${n}+` : 'Any'}</option>)}
            </select>
          </label>
          <label className="check small"><input type="checkbox" checked={filter.hasEmail} onChange={(e) => set('hasEmail', e.target.checked)} /> Has email</label>
          <label className="check small">Status
            <select className="grp" value={filter.status} onChange={(e) => set('status', e.target.value as LeadFilterUi['status'])}>
              <option value="active">Not skipped</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s][0].toUpperCase() + STATUS_LABEL[s].slice(1)}</option>)}
              <option value="all">All</option>
            </select>
          </label>
          <div className="grow" />
          <span className="dim" aria-live="polite">{leads ? `${rows.length} lead${rows.length === 1 ? '' : 's'}` : ''}</span>
        </div>

        {(error || loadError) && <div className="notice err" role="alert">{error || loadError} <a onClick={() => { setError(''); setLoadError(''); load() }}>Try again</a></div>}
        {notice && <div className="notice" role="status">{notice}</div>}

        {leads === null && !error && !loadError && <p className="help">Loading leads…</p>}
        {empty && isDefaultFilter(filter) && (
          <div className="empty">
            <p>Import your first leads. Paste handles or profile links, or bring in a CSV, and Studio HQ ranks them by how well they fit your beats.</p>
            <button className="primary" onClick={() => setImporting(true)}>Paste or import</button>
          </div>
        )}
        {empty && !isDefaultFilter(filter) && <div className="empty-res">No leads match these filters. <a onClick={() => setFilter(DEFAULT_FILTER)}>Clear filters</a></div>}

        {rows.length > 0 && (
          <div className="stable">
            <div className="lrow shead">
              <input type="checkbox" aria-label="Select all leads" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((l) => l.id)))} />
              <span>Artist</span><span className="r">Followers</span><span>Score</span><span>Email</span><span />
            </div>
            {rows.map((l) => {
              const reasons = l.reasons.map(reasonText)
              const meta = [SOURCE_LABEL[l.source], l.lastActiveAt ? `active ${ago(l.lastActiveAt)}` : '', ...reasons].filter(Boolean).join(' · ')
              return (
                <div key={l.id} className={`lrow ${sel.has(l.id) ? 'sel' : ''}`} aria-pressed={sel.has(l.id)} aria-label={`${l.name}, score ${l.score}`} {...clickable(() => flip(l.id))}>
                  <input type="checkbox" aria-label={`Select ${l.name}`} tabIndex={-1} checked={sel.has(l.id)} onClick={(e) => e.stopPropagation()} onChange={() => flip(l.id)} />
                  <div className="lr-artist">
                    <div className="st-title">
                      {l.url ? <a href={l.url} title={`Open ${l.url}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.api.openExternal(l.url) }}>{l.name}</a> : l.name}
                      {l.status !== 'new' && <span className="chip" style={{ marginLeft: 6 }}>{STATUS_LABEL[l.status]}</span>}
                    </div>
                    <div className="sub dim" title={l.reasons.join('\n')}>{meta}</div>
                  </div>
                  <span className="r">{fmtFollowers(l.followers)}</span>
                  <span><span className={`chip lscore ${scoreBand(l.score)}`} title={l.reasons.join('\n') || 'No signals yet'}>{l.score}</span></span>
                  <div className="lr-email">
                    {l.email ? (
                      <>
                        <div>{l.email}</div>
                        <div className="sub dim" title={l.emailSourceUrl}>{emailSourceLabel(l.email, l.emailSourceUrl)}</div>
                      </>
                    ) : (
                      <button
                        disabled={looking !== null}
                        title={l.url ? 'Look for a public email on their page and contact pages' : 'Add a profile or website link first'}
                        onClick={(e) => { e.stopPropagation(); findEmail(l) }}
                      >{looking === l.id ? 'Looking…' : 'Find email'}</button>
                    )}
                  </div>
                  <div className="sact"><button onClick={(e) => { e.stopPropagation(); pitch(l) }}>Pitch</button></div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {sel.size > 0 && (
        <div style={{ padding: '0 28px 16px' }}>
          <div className="pl-bar" role="region" aria-label="Selected leads">
            <b>{sel.size} selected</b>
            <div className="grow" />
            <button disabled={busy} onClick={skip}>Skip</button>
            <button className="primary" disabled={busy} onClick={addToCrm}>Add to CRM</button>
          </div>
        </div>
      )}

      {importing && <ImportDialog onClose={() => setImporting(false)} onImported={load} />}
    </section>
  )
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [kind, setKind] = useState<'handles' | 'csv'>('handles')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; duplicates: number } | null>(null)
  const [error, setError] = useState('')

  const go = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      setResult(await window.api.leadsImport(text, kind))
      setText('')
      onImported()
    } catch (e) {
      setError(`Import failed: ${errMsg(e)}`)
    }
    setBusy(false)
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal wide-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header><h2>Paste or import leads</h2><button onClick={onClose}>Close</button></header>
        <div className="seg" role="group" aria-label="What you are pasting" style={{ marginTop: 12 }}>
          <button className={kind === 'handles' ? 'on' : ''} aria-pressed={kind === 'handles'} onClick={() => setKind('handles')}>Handles / links</button>
          <button className={kind === 'csv' ? 'on' : ''} aria-pressed={kind === 'csv'} onClick={() => setKind('csv')}>CSV</button>
        </div>
        <p className="help" style={{ marginTop: 10 }}>
          {kind === 'handles'
            ? 'One per line: @handle, or a YouTube, SoundCloud or Instagram profile link.'
            : 'Columns: name, url, email, genre, followers. A header row is optional.'}
        </p>
        <textarea
          aria-label={kind === 'handles' ? 'Handles or links, one per line' : 'CSV rows'} rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          placeholder={kind === 'handles' ? '@artistname\nhttps://www.youtube.com/@artistname\nhttps://soundcloud.com/artistname' : 'name,url,email,genre,followers\nNova Kid,https://soundcloud.com/novakid,,trap,1800'}
        />
        {error && <div className="notice err" role="alert">{error}</div>}
        {result && <div className="notice" role="status">Added {result.added} lead{result.added === 1 ? '' : 's'}{result.duplicates ? `, ${result.duplicates} already in your list` : ''}.</div>}
        <div className="draft-actions">
          <div className="grow" />
          <button className="primary" disabled={!text.trim() || busy} onClick={go}>{busy ? 'Importing…' : 'Import'}</button>
        </div>
      </div>
    </div>
  )
}
