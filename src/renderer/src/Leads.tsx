import { presetGroups, type LeadPreset } from '@shared/leadPresets'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lead, LeadSize, LeadSource } from '@shared/leads'
import { clickable } from './a11y'
import { Search, Plus, X, Settings2 } from 'lucide-react'
import { ScrollArea } from '@/components/lib/scroll-area'
import { AnimatedCircularProgressBar } from '@/components/lib/animated-circular-progress-bar'
import { Avatar, Button, ChartCard, Dlg, Num, Reveal, Seg, SPAN } from './reachUi'
import { leadsSeries, type LeadMetric } from './leadsSeries'
import type { MadePeriod } from './dashUtils'
import { errMsg } from './salesUtils'
import {
  ROLE_LABEL, SIZE_LABEL, SOURCE_LABEL, emailSourceLabel, fmtFollowers, genreCounts, groupLeads, hasEmail, inView, ladderCounts, matchesText, reasonText, toPromote,
  type EmailTab, type LeadView
} from './leadsUtils'

type StatusFilter = 'active' | 'in_crm' | 'skipped' | 'all'
const SIZES: LeadSize[] = ['big', 'small', 'team']
const sameView = (a: LeadView, b: LeadView) => a.t === b.t && ('k' in a ? 'k' in b && a.k === b.k : true)
const viewTitle = (v: LeadView) => (v.t === 'all' ? 'All leads' : v.t === 'size' ? SIZE_LABEL[v.k] : v.k)
const viewKind = (v: LeadView) => (v.t === 'all' ? 'Everyone' : v.t === 'size' ? 'Size' : v.t === 'genre' ? 'Genre they want' : 'Works with')

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
  const [metric, setMetric] = useState<LeadMetric>('added')
  const [period, setPeriod] = useState<MadePeriod>('Weekly')
  const [pop, setPop] = useState(false)
  const [now] = useState(() => Date.now())

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


  /** Library circular gauge that creeps toward 90 while a lookup runs (the search has no real progress to report). */
  const ring = (
    <AnimatedCircularProgressBar value={90} gaugePrimaryColor="var(--accent-ink)" gaugeSecondaryColor="color-mix(in srgb, var(--accent-ink) 25%, transparent)" className="ldx-ring" />
  )
  const act = (l: Lead, size: 'xs' | 'sm' = 'sm') => (
    <Button variant={hasEmail(l) ? 'default' : 'outline'} size={size} className="ldx-act" disabled={looking === l.id} onClick={(e) => { e.stopPropagation(); hasEmail(l) ? pitch(l) : findEmail(l) }}>
      {looking === l.id && ring}{hasEmail(l) ? 'Pitch' : looking === l.id ? 'Looking…' : 'Find email'}
    </Button>
  )

  const sizeColor = (s: LeadSize) => `var(--lh-${s}, var(--idea))`
  const row = (l: Lead, i: number) => (
    <Reveal key={l.id} delay={Math.min(i, 8) * 0.03}>
      <div className={`ldx-row${openId === l.id ? ' on' : ''}`} style={{ ['--c' as string]: sizeColor(l.size) }} {...clickable(() => setOpenId(l.id))} aria-label={`${l.name}, open details`}>
        <input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.has(l.id)} onClick={(e) => e.stopPropagation()} onChange={() => flip(l.id)} />
        <Avatar name={l.name} />
        <div className="ldx-nm"><b>{l.name}</b><small>{l.size === 'team' ? ROLE_LABEL[l.role] : l.size === 'big' ? 'Big' : 'Small'}{l.handle ? ` · @${l.handle}` : ''}</small></div>
        <div className={`ldx-em${l.email ? '' : ' none'}`} title={l.email}>
          <span>{l.email ? <>{l.email}{l.moreEmails.length > 0 && ` +${l.moreEmails.length}`}</> : 'No email yet'}</span>
          <small>{l.genres.slice(0, 2).map((g) => <span key={g} className="ldx-gc">{g}</span>)}</small>
        </div>
        {act(l)}
      </div>
    </Reveal>
  )

  const empty = leads !== null && !leads.length
  const sideItem = (v: LeadView, label: string, n: number, dot?: string) => (
    <button key={label} type="button" className="ldx-item" onClick={() => goto(v)} aria-pressed={sameView(view, v)}>
      {dot && <span className="ldx-dot" style={{ ['--c' as string]: dot }} />}<span>{label}</span><span className="ldx-n">{n}</span>
    </button>
  )

  const s = useMemo(() => leadsSeries(leads ?? [], metric, period, now), [leads, metric, period, now])
  const total = s.data.reduce((a, b) => a + b, 0)
  const contacted = useMemo(() => leadsSeries(leads ?? [], 'contacted', period, now).data.reduce((a, b) => a + b, 0), [leads, period, now])

  return (
    <section className="ldx">
      <aside className="ldx-side" aria-label="Browse leads">
        <div className="ldx-search"><div className="pc-search"><Search aria-hidden="true" /><input className="pc-in" aria-label="Search leads" placeholder={`Search ${visible.length} leads`} value={text} onChange={(e) => setText(e.target.value)} /></div></div>
        <ScrollArea className="ldx-scroll-wrap h-full min-h-0"><div className="ldx-scroll">
          <h3 className="rx-h">Browse</h3>
          {sideItem({ t: 'all' }, 'All leads', visible.length)}
          {SIZES.map((z) => sideItem({ t: 'size', k: z }, SIZE_LABEL[z], counts.size[z], sizeColor(z)))}
          {counts.genres.length > 0 && <h3 className="rx-h">Genres they want</h3>}
          {counts.genres.map(([g, n]) => sideItem({ t: 'genre', k: g }, g, n))}
          {counts.ladders.length > 0 && <h3 className="rx-h">Works with</h3>}
          {counts.ladders.map(([g, n]) => sideItem({ t: 'ladder', k: g }, g, n))}
        </div></ScrollArea>
        <div className="ldx-foot"><Button onClick={() => setAdding(true)}><Plus aria-hidden="true" />Add leads</Button></div>
      </aside>

      <div className="ldx-main">
        <header className="ldx-head">
          <div className="rx-h">{viewKind(view)}</div>
          <h2 className="rx-title">{viewTitle(view)}</h2>
          <div className="rx-stats" aria-live="polite">
            <span><b><Num value={inScope.length} /></b> leads</span>
            <span><b><Num value={inScope.filter(hasEmail).length} /></b> with email</span>
            {view.t !== 'size' && SIZES.map((z) => <span key={z}><b>{inScope.filter((l) => l.size === z).length}</b> {z}</span>)}
          </div>
        </header>
        <div className="ldx-bar">
          <Seg label="Layout" value={mode} onChange={setMode} options={[{ v: 'list', label: 'List' }, { v: 'tree', label: 'Groups' }]} />
          {(['all', 'email', 'dm'] as const).map((t) => (
            <button key={t} type="button" className="pc-chip" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'all' ? 'All' : t === 'email' ? 'Has email' : 'No email yet'}</button>
          ))}
          <select className="pc-in" style={{ width: 'auto', height: 30 }} aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="active">Not skipped</option><option value="in_crm">In CRM</option><option value="skipped">Skipped</option><option value="all">Everything</option>
          </select>
          <div className="pc-sp" />
          <Button variant="outline" size="sm" className="rx-narrow" onClick={() => { setOpenId(null); setPop((v) => !v) }}>Chart</Button>
          <Button variant="outline" size="sm" disabled={busy || !ready.length} onClick={() => addToCrm(ready)}>Add {ready.length} to CRM</Button>
        </div>
        {view.t !== 'genre' && counts.genres.length > 0 ? (
          <div className="ldx-genres" role="group" aria-label="Filter by genre">
            <span>Genre</span>
            {genreCounts(inScope).map(([g]) => (
              <button key={g} type="button" className="pc-chip" aria-pressed={genre === g} onClick={() => setGenre(genre === g ? null : g)}>{g}</button>
            ))}
          </div>
        ) : <div />}
        <div>
          {error && <div className="pc-err rx-notice" role="alert">{error} <Button variant="link" size="xs" onClick={() => { setError(''); load() }}>Try again</Button></div>}
          {notice && <div className="pc-help rx-notice" role="status">{notice}</div>}
        </div>

        <ScrollArea className="ldx-lw h-full min-h-0">
          <div className="ldx-list">
            {leads === null && !error && <p className="pc-help rx-notice">Loading leads…</p>}
            {empty && (
              <div className="pc-empty ldx-empty"><b>No leads yet</b><p>Paste a list of artists, or search YouTube, SoundCloud and more for ones who need beats.</p><div><Button onClick={() => setAdding(true)}>Add leads</Button></div></div>
            )}
            {!empty && leads !== null && !groups.length && <div className="pc-empty ldx-empty"><b>Nothing matches</b>Try a different view or clear the filters above.</div>}
            {mode === 'list' && groups.map((g) => (
              <section key={g.title} aria-label={g.title}>
                <div className="ldx-sec"><h3>{g.title}</h3><span>{g.leads.length}{g.hint ? ` · ${g.hint}` : ''}</span>
                  {g.leads.some(hasEmail) && <Button variant="link" size="xs" className="pc-xlink" disabled={busy} onClick={() => addToCrm(g.leads.filter(hasEmail))}>Add {g.leads.filter(hasEmail).length} with email to CRM</Button>}
                </div>
                {g.leads.map(row)}
              </section>
            ))}
            {mode === 'tree' && groups.map((g) => (
              <section key={g.title} className="ldx-tier" aria-label={g.title}>
                <h4>{g.title}</h4>
                <div className="ldx-nodes">
                  {g.leads.map((l) => (
                    <button key={l.id} type="button" className="ldx-node" aria-pressed={openId === l.id} onClick={() => setOpenId(l.id)}>
                      <Avatar name={l.name} />{l.name}<span className={`ldx-led${l.email ? ' on' : ''}`} title={l.email ? 'Has email' : 'No email yet'} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </ScrollArea>

        {sel.size > 0 && (
          <div className="ldx-bulk" role="region" aria-label="Selected leads">
            <b>{sel.size} selected</b>
            <div className="pc-sp" />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => skip([...sel])}>Skip</Button>
            <Button size="sm" disabled={busy} onClick={() => addToCrm((leads ?? []).filter((l) => sel.has(l.id)))}>Add to CRM</Button>
            <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>Clear</Button>
          </div>
        )}
      </div>

      {open ? (
        <aside className="ldx-aside" aria-label="Lead details">
          <div className="ldx-drawer">
            <div className="top"><Avatar name={open.name} big /><button type="button" className="rx-x" aria-label="Close details" onClick={() => setOpenId(null)}><X className="rx-ico" aria-hidden="true" /></button></div>
            <h2>{open.name}</h2>
            <p className="ldx-sub">{open.size === 'team' ? ROLE_LABEL[open.role] : open.size === 'big' ? 'Big artist' : 'Small artist'}{open.handle ? ` · @${open.handle}` : ''}</p>
            <dl className="ldx-kv">
              <dt>Wants</dt><dd>{open.genres.length ? open.genres.map((g) => <span key={g} className="ldx-gc">{g}</span>) : <span className="pc-help">Not set</span>}</dd>
              <dt>Works with</dt><dd>{open.ladder || <span className="pc-help">Nobody yet</span>}</dd>
              <dt>Size</dt>
              <dd>
                <select className="pc-in" style={{ height: 30 }} aria-label="Size" value={open.size} onChange={(e) => setSize(open, e.target.value as LeadSize)}>
                  {SIZES.map((z) => <option key={z} value={z}>{SIZE_LABEL[z]}</option>)}
                </select>
              </dd>
              <dt>{open.moreEmails.length ? 'Emails' : 'Email'}</dt>
              <dd>
                {open.email ? [open.email, ...open.moreEmails].map((e) => <div key={e}>{e}</div>) : <span className="pc-help">None yet</span>}
                {open.email && <small className="pc-help">{emailSourceLabel(open.email, open.emailSourceUrl)}</small>}
              </dd>
              <dt>Where</dt><dd>{open.url ? <code>{open.url.replace(/^https?:\/\/(www\.)?/, '')}</code> : SOURCE_LABEL[open.source]}</dd>
              {open.followers !== null && (<><dt>Followers</dt><dd>{fmtFollowers(open.followers)}</dd></>)}
              <dt>Status</dt><dd>{open.status === 'in_crm' ? 'In CRM' : open.status[0].toUpperCase() + open.status.slice(1)}</dd>
            </dl>
            {open.note && <p className="ldx-note">{open.note}</p>}
            {open.reasons.length > 0 && <p className="ldx-note">{open.reasons.map(reasonText).join(' · ')}</p>}
            <div className="ldx-btns">
              {act(open)}
              <Button variant="outline" size="sm" disabled={busy || open.status === 'in_crm'} onClick={() => addToCrm([open])}>{open.status === 'in_crm' ? 'In CRM' : 'Add to CRM'}</Button>
              <Button variant="ghost" size="sm" disabled={busy || open.status === 'skipped'} onClick={() => skip([open.id])}>Skip</Button>
            </div>
          </div>
        </aside>
      ) : (
        <aside className={`ldx-aside chart${pop ? ' pop' : ''}`} aria-label="Leads chart">
          <ChartCard
            label="Leads found" accent={metric === 'added' ? '--sent' : '--finished'} data={s.data} labels={s.labels} value={total} period={period} onPeriod={setPeriod}
            seg={<Seg full label="Chart shows" value={metric} onChange={setMetric} options={[{ v: 'added', label: 'Leads found' }, { v: 'contacted', label: 'Contacted' }]} />}
            title={metric === 'added' ? 'Leads found' : 'Contacted'} caption={SPAN[period]}
            updatedText={metric === 'added' ? `${contacted} moved to Pitch CRM` : `${leads?.length ?? 0} leads in total`}
            unit={(n) => `${n} ${metric === 'added' ? (n === 1 ? 'lead' : 'leads') : 'contacted'}`}
          />
        </aside>
      )}

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
    <Dlg
      title="Add leads" onClose={onClose} closeLabel="Close" size="md"
      footer={tab === 'paste'
        ? <><span className="sum">{error ? '' : result}</span><div className="r"><Button disabled={!text.trim() || busy} onClick={paste}>{busy ? 'Adding…' : 'Add leads'}</Button></div></>
        : <span className="sum">{error ? '' : result}</span>}
    >
      <Seg label="How to add" value={tab} onChange={setTab} options={[{ v: 'paste', label: 'Paste a list' }, { v: 'search', label: 'Search the web' }]} />
      {tab === 'paste' ? (
        <>
          <Seg label="What you are pasting" value={kind} onChange={setKind} options={[{ v: 'csv', label: 'CSV' }, { v: 'handles', label: 'Handles or links' }]} />
          <p className="pc-help">
            {kind === 'handles'
              ? 'One per line: @handle, or a YouTube, SoundCloud or Instagram profile link.'
              : 'Columns: name, url, email, genre, followers, role, size, ladder, note. Only name and url are required. Role is manager, engineer, a&r, media, producer, label or artist. Size is big, small or team.'}
          </p>
          <textarea
            className="pc-in" aria-label={kind === 'handles' ? 'Handles or links, one per line' : 'CSV rows'} rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            placeholder={kind === 'handles' ? '@artistname\nhttps://www.youtube.com/@artistname\nhttps://soundcloud.com/artistname' : 'name,url,email,genre,followers,role,size,ladder\nNova Kid,https://soundcloud.com/novakid,,southside,1800,artist,small,Lil Baby'}
          />
        </>
      ) : (
        <>
          <select
            className="pc-in" aria-label="Search presets" value={preset?.id ?? ''}
            onChange={(e) => {
              const p = presetGroups().flatMap((g) => g.presets).find((x) => x.id === e.target.value) ?? null
              setPreset(p)
              if (p) { setSource(p.source); setQuery(p.query) }
            }}
          >
            <option value="">Presets…</option>
            {presetGroups().map((g) => <optgroup key={g.group} label={g.group}>{g.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>)}
          </select>
          <div className="ldx-sr">
            <select className="pc-in" aria-label="Search source" value={source} onChange={(e) => { setSource(e.target.value as LeadSource); setPreset(null) }}>
              {(['youtube', 'reddit', 'soundcloud', 'audiomack', 'x'] as const).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
            <input
              className="pc-in" aria-label="Search for artists" placeholder={source === 'reddit' || source === 'x' ? 'looking for beats' : 'trap rapper'} value={query}
              onChange={(e) => { setQuery(e.target.value); if (preset && e.target.value !== preset.query) setPreset(null) }} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) search() }}
            />
            <Button disabled={busy || !query.trim()} onClick={search}>{busy ? 'Searching…' : 'Search'}</Button>
          </div>
          {preset && (
            <p className="pc-help">
              {preset.note}
              {preset.source === 'youtube' && ` Under ${(preset.maxSubs ?? 0).toLocaleString()} subscribers, uploaded in the last ${preset.days} days. A search uses about 100 of your daily YouTube quota.`}
            </p>
          )}
        </>
      )}
      {error && <div className="pc-err" role="alert">{error}</div>}
    </Dlg>
  )
}
