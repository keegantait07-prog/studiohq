import { presetGroups, type LeadPreset } from '@shared/leadPresets'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lead, LeadSize, LeadSource } from '@shared/leads'
import { clickable } from './a11y'
import { errMsg } from './salesUtils'
import {
  ROLE_LABEL, SIZE_LABEL, SOURCE_LABEL, emailSourceLabel, fmtFollowers, genreCounts, groupLeads, hasEmail, inView, ladderCounts, matchesText, reasonText, toPromote,
  type EmailTab, type LeadView
} from './leadsUtils'

type StatusFilter = 'active' | 'in_crm' | 'skipped' | 'all'
const SIZES: LeadSize[] = ['big', 'small', 'team']
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)
const initials = (n: string) => n.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
const sameView = (a: LeadView, b: LeadView) => a.t === b.t && ('k' in a ? 'k' in b && a.k === b.k : true)
const viewTitle = (v: LeadView) => (v.t === 'all' ? 'All leads' : v.t === 'size' ? SIZE_LABEL[v.k] : v.k)
const viewKind = (v: LeadView) => (v.t === 'all' ? 'Everyone' : v.t === 'size' ? 'Size' : v.t === 'genre' ? 'Genre they want' : 'Works with')

function Avatar({ name, big }: { name: string; big?: boolean }) {
  return <span className={`lh-av${big ? ' big' : ''}`} style={{ background: `hsl(${hue(name)} 36% 68%)` }} aria-hidden="true">{initials(name)}</span>
}

/** Leads: artists and the people around them, sorted by size (big, small, team) and by the genres they want. */
export function Leads({ onPitch }: { onPitch: (contactId: number) => void }) {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [view, setView] = useState<LeadView>({ t: 'all' })
  const [tab, setTab] = useState<EmailTab>('all')
  const [genre, setGenre] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'list' | 'tree'>('list')
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const all = await window.api.leadsList({})
      setLeads(all)
      setSel((s) => new Set([...s].filter((id) => all.some((l) => l.id === id))))
      setError('')
    } catch (e) {
      setError(`Could not load leads: ${errMsg(e)}`)
    }
  }, [])
  useEffect(() => {
    load()
    return window.api.onCrmChanged(load)
  }, [load])

  const visible = useMemo(() => (leads ?? []).filter((l) => (status === 'all' ? true : status === 'active' ? l.status !== 'skipped' : l.status === status)), [leads, status])
  const inScope = useMemo(() => visible.filter((l) => inView(l, view)), [visible, view])
  const shown = useMemo(
    () => inScope.filter((l) => (tab === 'all' ? true : tab === 'email' ? hasEmail(l) : !hasEmail(l)) && (!genre || l.genres.includes(genre)) && matchesText(l, text)),
    [inScope, tab, genre, text]
  )
  const groups = useMemo(() => groupLeads(shown, view), [shown, view])
  const open = leads?.find((l) => l.id === openId) ?? null
  const ready = shown.filter(hasEmail)
  const counts = useMemo(() => ({
    size: Object.fromEntries(SIZES.map((s) => [s, visible.filter((l) => l.size === s).length])) as Record<LeadSize, number>,
    genres: genreCounts(visible),
    ladders: ladderCounts(visible)
  }), [visible])

  const goto = (v: LeadView) => { setView(v); setGenre(null); setOpenId(null); setSel(new Set()) }
  const flip = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const addToCrm = async (list: Lead[]) => {
    const todo = toPromote(list, new Set(list.map((l) => l.id)))
    setBusy(true); setNotice(''); setError('')
    let done = 0
    try {
      for (const l of todo) { await window.api.leadsPromote(l.id); done++ }
      const already = list.length - todo.length
      setNotice(`Added ${done} to Pitch CRM${already ? `. ${already} already there.` : '.'}`)
      setSel(new Set())
    } catch (e) {
      setError(`Added ${done} of ${todo.length}, then stopped: ${errMsg(e)}`)
    }
    setBusy(false)
    load()
  }
  const skip = async (ids: number[]) => {
    setBusy(true); setNotice(''); setError('')
    try {
      await window.api.leadsSkip(ids)
      setNotice(`Skipped ${ids.length}.`)
      setSel(new Set())
      if (openId !== null && ids.includes(openId)) setOpenId(null)
    } catch (e) {
      setError(`Could not skip: ${errMsg(e)}`)
    }
    setBusy(false)
    load()
  }
  const pitch = async (l: Lead) => {
    setNotice(''); setError('')
    if (!l.email) { setNotice(`${l.name} has no email yet. Find or add an email before pitching.`); return }
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
      setNotice(r.found ? `Found ${r.email} for ${l.name}.` : r.reason)
    } catch (e) {
      setError(`Could not look up an email: ${errMsg(e)}`)
    }
    setLooking(null)
    load()
  }
  const setSize = async (l: Lead, size: LeadSize) => {
    try { await window.api.leadsSetSize([l.id], size) } catch (e) { setError(`Could not change the size: ${errMsg(e)}`) }
    load()
  }

  const act = (l: Lead) => (
    <button className={hasEmail(l) ? 'lh-act pri' : 'lh-act'} disabled={looking === l.id} onClick={(e) => { e.stopPropagation(); hasEmail(l) ? pitch(l) : findEmail(l) }}>
      {hasEmail(l) ? 'Pitch' : looking === l.id ? 'Looking…' : 'Find email'}
    </button>
  )

  const row = (l: Lead) => (
    <div key={l.id} className={`lh-row${openId === l.id ? ' on' : ''}`} {...clickable(() => setOpenId(l.id))} aria-label={`${l.name}, open details`}>
      <input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.has(l.id)} onClick={(e) => e.stopPropagation()} onChange={() => flip(l.id)} />
      <Avatar name={l.name} />
      <div className="lh-nm"><b>{l.name}</b><small>{l.handle ? `@${l.handle}` : ROLE_LABEL[l.role]}</small></div>
      <span className={`lh-size ${l.size}`}>{l.size === 'team' ? ROLE_LABEL[l.role] : l.size === 'big' ? 'Big' : 'Small'}</span>
      <div className="lh-gen">{l.genres.slice(0, 2).map((g) => <span key={g} className="lh-gc">{g}</span>)}</div>
      <div className={`lh-em${l.email ? '' : ' none'}`} title={l.email}>{l.email ? <>{l.email}{l.moreEmails.length > 0 && <i> +{l.moreEmails.length}</i>}</> : 'No email yet'}</div>
      {act(l)}
    </div>
  )

  const empty = leads !== null && !leads.length
  const sideItem = (v: LeadView, label: string, n: number, dot?: string) => (
    <button key={label} className={`lh-item${sameView(view, v) ? ' on' : ''}`} onClick={() => goto(v)} aria-pressed={sameView(view, v)}>
      {dot && <span className="lh-dot" style={{ background: dot }} />}<span className="lh-lbl">{label}</span><span className="lh-n">{n}</span>
    </button>
  )

  return (
    <section className={`lh${open ? ' has-open' : ''}`}>
      <aside className="lh-side" aria-label="Browse leads">
        <div className="lh-search"><input aria-label="Search leads" placeholder={`Search ${visible.length} leads`} value={text} onChange={(e) => setText(e.target.value)} /></div>
        <div className="lh-scroll">
          <h3 className="lh-h">Browse</h3>
          {sideItem({ t: 'all' }, 'All leads', visible.length)}
          {SIZES.map((s) => sideItem({ t: 'size', k: s }, SIZE_LABEL[s], counts.size[s], `var(--lh-${s})`))}
          {counts.genres.length > 0 && <h3 className="lh-h">Genres they want</h3>}
          {counts.genres.map(([g, n]) => sideItem({ t: 'genre', k: g }, g, n))}
          {counts.ladders.length > 0 && <h3 className="lh-h">Works with</h3>}
          {counts.ladders.map(([g, n]) => sideItem({ t: 'ladder', k: g }, g, n))}
        </div>
        <div className="lh-foot"><button className="primary" onClick={() => setAdding(true)}>Add leads</button></div>
      </aside>

      <div className="lh-main">
        <header className="lh-head">
          <div className="lh-kind">{viewKind(view)}</div>
          <h2>{viewTitle(view)}</h2>
          <div className="lh-stats" aria-live="polite">
            <span><b>{inScope.length}</b> leads</span>
            <span><b>{inScope.filter(hasEmail).length}</b> with email</span>
            {view.t !== 'size' && SIZES.map((s) => <span key={s}><b>{inScope.filter((l) => l.size === s).length}</b> {s}</span>)}
          </div>
        </header>
        <div className="lh-bar">
          <div className="seg lh-seg" role="group" aria-label="Layout">
            <button className={mode === 'list' ? 'on' : ''} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>List</button>
            <button className={mode === 'tree' ? 'on' : ''} aria-pressed={mode === 'tree'} onClick={() => setMode('tree')}>Groups</button>
          </div>
          {(['all', 'email', 'dm'] as const).map((t) => (
            <button key={t} className={`lh-chip${tab === t ? ' on' : ''}`} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'all' ? 'All' : t === 'email' ? 'Has email' : 'No email yet'}</button>
          ))}
          <select className="grp" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="active">Not skipped</option><option value="in_crm">In CRM</option><option value="skipped">Skipped</option><option value="all">Everything</option>
          </select>
          <div className="grow" />
          <button disabled={busy || !ready.length} onClick={() => addToCrm(ready)}>Add {ready.length} to CRM</button>
        </div>
        {view.t !== 'genre' && counts.genres.length > 0 && (
          <div className="lh-genres" role="group" aria-label="Filter by genre">
            <span>Genre</span>
            {genreCounts(inScope).map(([g]) => (
              <button key={g} className={`lh-chip${genre === g ? ' on' : ''}`} aria-pressed={genre === g} onClick={() => setGenre(genre === g ? null : g)}>{g}</button>
            ))}
          </div>
        )}
        {error && <div className="notice err" role="alert">{error} <a onClick={() => { setError(''); load() }}>Try again</a></div>}
        {notice && <div className="notice" role="status">{notice}</div>}

        <div className="lh-list">
          {leads === null && !error && <p className="help">Loading leads…</p>}
          {empty && (
            <div className="lh-empty"><h3>No leads yet</h3><p>Paste a list of artists, or search YouTube, SoundCloud and more for ones who need beats.</p><button className="primary" onClick={() => setAdding(true)}>Add leads</button></div>
          )}
          {!empty && leads !== null && !groups.length && <div className="lh-empty"><h3>Nothing matches</h3><p>Try a different view or clear the filters above.</p></div>}
          {mode === 'list' && groups.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <div className="lh-sec"><h3>{g.title}</h3><span>{g.leads.length}{g.hint ? ` · ${g.hint}` : ''}</span>
                {g.leads.some(hasEmail) && <button className="lh-link" disabled={busy} onClick={() => addToCrm(g.leads.filter(hasEmail))}>Add {g.leads.filter(hasEmail).length} with email to CRM</button>}
              </div>
              {g.leads.map(row)}
            </section>
          ))}
          {mode === 'tree' && groups.map((g) => (
            <section key={g.title} className="lh-tier" aria-label={g.title}>
              <h4>{g.title}</h4>
              <div className="lh-nodes">
                {g.leads.map((l) => (
                  <button key={l.id} className={`lh-node${openId === l.id ? ' on' : ''}`} onClick={() => setOpenId(l.id)}>
                    <Avatar name={l.name} />{l.name}<span className={`lh-led${l.email ? ' on' : ''}`} title={l.email ? 'Has email' : 'No email yet'} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        {sel.size > 0 && (
          <div className="lh-bulk" role="region" aria-label="Selected leads">
            <b>{sel.size} selected</b>
            <div className="grow" />
            <button disabled={busy} onClick={() => skip([...sel])}>Skip</button>
            <button className="primary" disabled={busy} onClick={() => addToCrm((leads ?? []).filter((l) => sel.has(l.id)))}>Add to CRM</button>
            <button onClick={() => setSel(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {open && <aside className="lh-drawer" aria-label="Lead details">
        {open && (
          <>
            <Avatar name={open.name} big />
            <h2>{open.name}</h2>
            <p className="lh-sub">{open.size === 'team' ? ROLE_LABEL[open.role] : open.size === 'big' ? 'Big artist' : 'Small artist'}{open.handle ? ` · @${open.handle}` : ''}</p>
            <dl className="lh-kv">
              <dt>Wants</dt><dd>{open.genres.length ? open.genres.map((g) => <span key={g} className="lh-gc">{g}</span>) : <span className="dim">Not set</span>}</dd>
              <dt>Works with</dt><dd>{open.ladder || <span className="dim">Nobody yet</span>}</dd>
              <dt>Size</dt>
              <dd>
                <select className="grp" aria-label="Size" value={open.size} onChange={(e) => setSize(open, e.target.value as LeadSize)}>
                  {SIZES.map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
                </select>
              </dd>
              <dt>{open.moreEmails.length ? 'Emails' : 'Email'}</dt>
              <dd>
                {open.email ? [open.email, ...open.moreEmails].map((e) => <div key={e} className="lh-mail">{e}</div>) : <span className="dim">None yet</span>}
                {open.email && <small className="dim">{emailSourceLabel(open.email, open.emailSourceUrl)}</small>}
              </dd>
              <dt>Where</dt><dd>{open.url ? <code>{open.url.replace(/^https?:\/\/(www\.)?/, '')}</code> : SOURCE_LABEL[open.source]}</dd>
              {open.followers !== null && (<><dt>Followers</dt><dd>{fmtFollowers(open.followers)}</dd></>)}
              <dt>Status</dt><dd>{open.status === 'in_crm' ? 'In CRM' : open.status[0].toUpperCase() + open.status.slice(1)}</dd>
            </dl>
            {open.note && <p className="lh-note">{open.note}</p>}
            {open.reasons.length > 0 && <p className="lh-why">{open.reasons.map(reasonText).join(' · ')}</p>}
            <div className="lh-btns">
              {act(open)}
              <button disabled={busy || open.status === 'in_crm'} onClick={() => addToCrm([open])}>{open.status === 'in_crm' ? 'In CRM' : 'Add to CRM'}</button>
              <button disabled={busy || open.status === 'skipped'} onClick={() => skip([open.id])}>Skip</button>
            </div>
          </>
        )}
      </aside>}

      {adding && <AddDialog onClose={() => setAdding(false)} onDone={load} />}
    </section>
  )
}

/** Add leads two ways: search the web for artists who need beats, or paste handles and a CSV. */
function AddDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<'search' | 'paste'>('paste')
  const [kind, setKind] = useState<'handles' | 'csv'>('csv')
  const [text, setText] = useState('')
  const [source, setSource] = useState<LeadSource>('youtube')
  const [query, setQuery] = useState('')
  const [preset, setPreset] = useState<LeadPreset | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const sum = (r: { added: number; duplicates: number }) => (!r.added && !r.duplicates ? 'No new artists found.' : `Added ${r.added} lead${r.added === 1 ? '' : 's'}${r.duplicates ? `, ${r.duplicates} already in your list` : ''}.`)

  const run = async (go: () => Promise<{ added: number; duplicates: number } | { error: string }>) => {
    setBusy(true); setError(''); setResult('')
    try {
      const r = await go()
      if ('error' in r) setError(r.error)
      else { setResult(sum(r)); onDone() }
    } catch (e) {
      setError(`That did not work: ${errMsg(e)}`)
    }
    setBusy(false)
  }
  const search = () => run(() => {
    const opts = preset && preset.source === 'youtube' && query === preset.query ? { maxSubs: preset.maxSubs, days: preset.days } : undefined
    return window.api.leadsSearch(source, query, opts)
  })
  const paste = () => run(async () => { const r = await window.api.leadsImport(text, kind); setText(''); return r })

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal wide-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header><h2>Add leads</h2><button onClick={onClose}>Close</button></header>
        <div className="seg" role="group" aria-label="How to add" style={{ marginTop: 12 }}>
          <button className={tab === 'paste' ? 'on' : ''} aria-pressed={tab === 'paste'} onClick={() => setTab('paste')}>Paste a list</button>
          <button className={tab === 'search' ? 'on' : ''} aria-pressed={tab === 'search'} onClick={() => setTab('search')}>Search the web</button>
        </div>
        {tab === 'paste' ? (
          <>
            <div className="seg" role="group" aria-label="What you are pasting" style={{ marginTop: 10 }}>
              <button className={kind === 'csv' ? 'on' : ''} aria-pressed={kind === 'csv'} onClick={() => setKind('csv')}>CSV</button>
              <button className={kind === 'handles' ? 'on' : ''} aria-pressed={kind === 'handles'} onClick={() => setKind('handles')}>Handles or links</button>
            </div>
            <p className="help" style={{ marginTop: 10 }}>
              {kind === 'handles'
                ? 'One per line: @handle, or a YouTube, SoundCloud or Instagram profile link.'
                : 'Columns: name, url, email, genre, followers, role, size, ladder, note. Only name and url are required. Role is manager, engineer, a&r, media, producer, label or artist. Size is big, small or team.'}
            </p>
            <textarea
              aria-label={kind === 'handles' ? 'Handles or links, one per line' : 'CSV rows'} rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
              placeholder={kind === 'handles' ? '@artistname\nhttps://www.youtube.com/@artistname\nhttps://soundcloud.com/artistname' : 'name,url,email,genre,followers,role,size,ladder\nNova Kid,https://soundcloud.com/novakid,,southside,1800,artist,small,Lil Baby'}
            />
            <div className="draft-actions"><div className="grow" /><button className="primary" disabled={!text.trim() || busy} onClick={paste}>{busy ? 'Adding…' : 'Add leads'}</button></div>
          </>
        ) : (
          <>
            <div className="field" style={{ marginTop: 12 }}>
              <select
                className="grp" aria-label="Search presets" value={preset?.id ?? ''}
                onChange={(e) => {
                  const p = presetGroups().flatMap((g) => g.presets).find((x) => x.id === e.target.value) ?? null
                  setPreset(p)
                  if (p) { setSource(p.source); setQuery(p.query) }
                }}
              >
                <option value="">Presets…</option>
                {presetGroups().map((g) => <optgroup key={g.group} label={g.group}>{g.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>)}
              </select>
            </div>
            <div className="lh-searchrow">
              <select className="grp" aria-label="Search source" value={source} onChange={(e) => { setSource(e.target.value as LeadSource); setPreset(null) }}>
                {(['youtube', 'reddit', 'soundcloud', 'audiomack', 'x'] as const).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
              </select>
              <input
                aria-label="Search for artists" placeholder={source === 'reddit' || source === 'x' ? 'looking for beats' : 'trap rapper'} value={query}
                onChange={(e) => { setQuery(e.target.value); if (preset && e.target.value !== preset.query) setPreset(null) }} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) search() }}
              />
              <button className="primary" disabled={busy || !query.trim()} onClick={search}>{busy ? 'Searching…' : 'Search'}</button>
            </div>
            {preset && (
              <p className="help" style={{ marginTop: 10 }}>
                {preset.note}
                {preset.source === 'youtube' && ` Under ${(preset.maxSubs ?? 0).toLocaleString()} subscribers, uploaded in the last ${preset.days} days. A search uses about 100 of your daily YouTube quota.`}
              </p>
            )}
          </>
        )}
        {error && <div className="notice err" role="alert">{error}</div>}
        {result && <div className="notice" role="status">{result}</div>}
      </div>
    </div>
  )
}
