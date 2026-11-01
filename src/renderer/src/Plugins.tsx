import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Confidence, HealthFinding, PluginFile, PluginInfo } from '@shared/types'
import { groupFindings, type FindingGroup } from '@shared/cleanup'

const size = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')
const short = (p: string) => p.replace(/^\/Users\/(?!Shared(\/|$))[^/]+/, '~')
const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => short(p.slice(0, p.lastIndexOf('/')) || '/')
const plural = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`
const FMT: Record<string, string> = { vst2: 'VST', vst3: 'VST3', au: 'AU', aax: 'AAX' }
const CONF: Record<Confidence, string> = { exact: 'installed by it', likely: 'likely', maybe: 'maybe' }
const LOC_ORDER = ['Plugin folders', 'Installer receipt', 'Application Support', 'System support', 'Preferences', 'Caches', 'Logs', 'Saved state', 'Applications', 'Documents', 'Sample libraries']

type Tab = 'plugins' | 'problems' | 'disabled'
type Sort = 'size' | 'name' | 'vendor'
type Filter = 'all' | 'problems' | 'unscanned' | 'dupes' | 'big'
type Disabled = { actionId: number; name: string; originalPath: string; at: number }
type Plan = { plugin: PluginInfo; files: PluginFile[]; marks: Set<string> }
type Section = { key: string; title: string; action: string; ids: number[]; names: string[]; on: boolean }
type Dialog =
  | { kind: 'uninstall'; plans: Plan[]; open: Set<number> }
  | { kind: 'fix'; heading: string; sections: Section[]; cleanup: boolean }
  | null

const FILTERS: { id: Filter; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every plugin' },
  { id: 'problems', label: 'Has a problem', hint: 'Plugins with something flagged' },
  { id: 'unscanned', label: 'Not in FL’s list', hint: 'Installed, but FL has not scanned them' },
  { id: 'dupes', label: 'Duplicates', hint: 'Installed twice' },
  { id: 'big', label: 'Largest 25', hint: 'The 25 biggest on disk' }
]

export function Plugins({ toast }: { toast: (m: string) => void }) {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [findings, setFindings] = useState<HealthFinding[]>([])
  const [disabled, setDisabled] = useState<Disabled[]>([])
  const [tab, setTab] = useState<Tab>('plugins')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('size')
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<number | null>(null)
  const [files, setFiles] = useState<PluginFile[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set()) // findings the user took out of a group
  const [open, setOpen] = useState<Set<string>>(new Set()) // problem groups whose list is expanded
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [rev, setRev] = useState(0) // bumps after a rescan so the open plugin's file list is read again
  const last = useRef<number | null>(null)

  const reload = useCallback(async () => {
    const [p, f, d] = await Promise.all([window.api.pluginsList(), window.api.pluginsFindings(), window.api.pluginsDisabled()])
    setPlugins(p); setFindings(f); setDisabled(d)
    return p
  }, [])

  const scan = useCallback(async () => {
    setBusy('Looking for plugins…')
    try { setPlugins(await window.api.pluginsScan()); setFindings(await window.api.pluginsFindings()); setRev((r) => r + 1) } catch (e) { setMsg(e instanceof Error ? e.message : 'Scan failed') }
    setBusy('')
  }, [])

  useEffect(() => { reload().then((p) => { if (!p.length) scan() }) }, [reload, scan])
  useEffect(() => { setDialog((d) => (d?.kind === 'fix' ? null : d)); setUnchecked(new Set()) }, [findings]) // a preview belongs to the findings it was made from

  const cur = plugins?.find((p) => p.id === sel) ?? null
  useEffect(() => {
    setFiles(null)
    if (sel == null) return
    let live = true
    window.api.pluginFiles(sel).then((f) => { if (live) setFiles(f) })
    return () => { live = false }
  }, [sel, rev])

  // ---- what each plugin's flags are, for the filters ----
  const flagged = useMemo(() => new Set(findings.map((f) => f.pluginId).filter((x): x is number => x != null)), [findings])
  const unscanned = useMemo(() => new Set(findings.filter((f) => f.kind === 'stale-fl-db' && f.fix === null && f.pluginId != null).map((f) => f.pluginId as number)), [findings])
  const dupes = useMemo(() => new Set(findings.filter((f) => f.kind === 'duplicate' && f.pluginId != null).map((f) => f.pluginId as number)), [findings])
  const biggest = useMemo(() => new Set([...(plugins ?? [])].sort((a, b) => b.totalSize - a.totalSize).slice(0, 25).map((p) => p.id)), [plugins])
  const counts: Record<Filter, number> = { all: plugins?.length ?? 0, problems: flagged.size, unscanned: unscanned.size, dupes: dupes.size, big: biggest.size }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const ok: Record<Filter, (p: PluginInfo) => boolean> = { all: () => true, problems: (p) => flagged.has(p.id), unscanned: (p) => unscanned.has(p.id), dupes: (p) => dupes.has(p.id), big: (p) => biggest.has(p.id) }
    const by: Record<Sort, (a: PluginInfo, b: PluginInfo) => number> = { size: (a, b) => b.totalSize - a.totalSize, name: (a, b) => a.name.localeCompare(b.name), vendor: (a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name) }
    return [...(plugins ?? [])].filter((p) => ok[filter](p) && (!s || `${p.name} ${p.vendor}`.toLowerCase().includes(s))).sort(by[sort])
  }, [plugins, q, sort, filter, flagged, unscanned, dupes, biggest])

  // ---- selection ----
  const pick = (id: number, idx: number, shift: boolean) => setPicked((prev) => {
    const n = new Set(prev)
    if (shift && last.current != null) {
      const [a, b] = [last.current, idx].sort((x, y) => x - y)
      const on = !prev.has(id)
      for (let i = a; i <= b; i++) { if (on) n.add(shown[i].id); else n.delete(shown[i].id) }
    } else if (n.has(id)) n.delete(id)
    else n.add(id)
    last.current = idx
    return n
  })
  const allShownPicked = shown.length > 0 && shown.every((p) => picked.has(p.id))
  const toggleAll = () => setPicked((prev) => { const n = new Set(prev); for (const p of shown) { if (allShownPicked) n.delete(p.id); else n.add(p.id) } return n })
  const pickedPlugins = (plugins ?? []).filter((p) => picked.has(p.id))
  const pickedBytes = pickedPlugins.reduce((a, p) => a + p.totalSize, 0)

  // ---- uninstall ----
  const openUninstall = async (list: PluginInfo[]) => {
    if (!list.length || busy) return
    const plans: Plan[] = []
    try {
      for (let i = 0; i < list.length; i++) {
        setBusy(list.length === 1 ? 'Finding every file this plugin installed…' : `Finding every file… ${i + 1} of ${list.length}`)
        const f = await window.api.pluginFiles(list[i].id)
        plans.push({ plugin: list[i], files: f, marks: new Set(f.filter((x) => x.confidence !== 'maybe').map((x) => x.path)) })
      }
      setDialog({ kind: 'uninstall', plans, open: new Set(list.length === 1 ? [list[0].id] : []) })
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not read the files.') }
    setBusy('')
  }

  const doUninstall = async () => {
    if (dialog?.kind !== 'uninstall') return
    const items = dialog.plans.map((p) => ({ id: p.plugin.id, paths: p.files.filter((f) => p.marks.has(f.path)).map((f) => f.path) })).filter((i) => i.paths.length)
    setBusy('Moving to the Trash…')
    try {
      const r = await window.api.pluginsRemoveMany(items)
      setMsg(`Moved ${plural(r.removed, 'item', 'items')} from ${plural(r.plugins, 'plugin', 'plugins')} to the Trash (${size(r.bytes)}). You can put them back from the Trash in Finder.` +
        (r.declined ? ' You cancelled the password prompt, so files in /Library were left alone.' : r.skipped.length ? ` ${r.skipped.length} skipped.` : '') + (r.failed.length ? ` ${r.failed.length} could not be moved: ${r.failed[0]}` : ''))
      setDialog(null); setPicked(new Set()); setSel(null)
      await reload(); setRev((n) => n + 1)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Something went wrong, nothing was deleted.') }
    setBusy('')
  }

  // ---- problems ----
  const health = async () => {
    setBusy('Checking every plugin. This can take a minute…')
    try { setFindings(await window.api.pluginsHealth()); setPlugins(await window.api.pluginsList()); setTab('problems') } catch (e) { setMsg(e instanceof Error ? e.message : 'Check failed') }
    setBusy('')
  }
  const groups = useMemo(() => groupFindings(findings), [findings])
  const section = (g: FindingGroup, on = true): Section => {
    const keep = g.findings.filter((f) => !unchecked.has(f.id))
    return { key: g.key, title: g.title, action: g.action, ids: keep.map((f) => f.id), names: keep.map((f) => f.name), on }
  }
  const safeGroups = groups.filter((g) => g.safe && g.fix)
  const safeCount = safeGroups.reduce((a, g) => a + g.findings.length, 0)

  const doFix = async () => {
    if (dialog?.kind !== 'fix') return
    const ids = dialog.sections.filter((s) => s.on).flatMap((s) => s.ids)
    if (!ids.length) return
    setBusy('Applying fixes…')
    try {
      const r = await window.api.pluginsFixApplyMany(ids)
      setMsg(`Fixed ${r.applied} of ${ids.length}.${r.failed.length ? ` ${r.failed.slice(0, 3).join(' · ')}${r.failed.length > 3 ? ` · and ${r.failed.length - 3} more` : ''}` : ' Restart FL Studio and rescan its plugin list if it was open.'}`)
      setDialog(null); await reload(); setRev((n) => n + 1)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'The fixes did not run.') }
    setBusy('')
  }

  const restore = async (list: Disabled[]) => {
    if (busy || !list.length) return
    setBusy('Restoring…')
    try {
      const r = await window.api.pluginsRestore(list.map((d) => d.actionId))
      if (r.failed.length) setMsg(r.failed[0]); else toast(list.length === 1 ? `${list[0].name} restored` : `${list.length} plugins restored`)
      await reload(); setRev((n) => n + 1)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not restore it.') }
    setBusy('')
  }

  const dot = (p: PluginInfo) => (p.health === 'bad' ? 'bad' : p.health === 'warn' || flagged.has(p.id) ? 'warn' : 'ok')
  const bad = findings.filter((f) => f.severity === 'bad').length
  const totalSize = (plugins ?? []).reduce((a, p) => a + p.totalSize, 0)

  const grouped = useMemo(() => {
    const m = new Map<string, PluginFile[]>()
    for (const f of files ?? []) m.set(f.location, [...(m.get(f.location) ?? []), f])
    return [...m.entries()].sort((a, b) => LOC_ORDER.indexOf(a[0]) - LOC_ORDER.indexOf(b[0]))
  }, [files])

  return (
    <section className="sales pl2">
      <div className="sales-head">
        <h2>Plugins</h2>
        <div className="grow" />
        <div className="seg">
          <button className={tab === 'plugins' ? 'on' : ''} onClick={() => setTab('plugins')}>All plugins</button>
          <button className={tab === 'problems' ? 'on' : ''} onClick={() => setTab('problems')}>Problems{findings.length ? ` ${findings.length}` : ''}</button>
          <button className={tab === 'disabled' ? 'on' : ''} onClick={() => setTab('disabled')}>Disabled{disabled.length ? ` ${disabled.length}` : ''}</button>
        </div>
        <button onClick={scan} disabled={!!busy}>Rescan</button>
        <button className="primary" onClick={health} disabled={!!busy} title="Looks for plugins that crash FL or show “not found”">Check for problems</button>
      </div>

      <div className="pl-wrap">
        <div className="stats pl-stats">
          <div className="stat"><b>{plugins ? plugins.length : '…'}</b><span>plugins</span></div>
          <div className="stat"><b>{size(totalSize)}</b><span>in plugin folders</span></div>
          <div className={`stat ${bad ? 'hot' : ''}`}><b>{findings.length}</b><span>{bad ? `${bad} serious` : 'things to look at'}</span></div>
          <div className={`stat ${picked.size ? 'hot' : ''}`}><b>{picked.size ? size(pickedBytes) : '—'}</b><span>{picked.size ? `${plural(picked.size, 'plugin', 'plugins')} selected` : 'nothing selected'}</span></div>
        </div>
        {busy && <p className="notice">{busy}</p>}
        {msg && <p className="notice" onClick={() => setMsg('')} title="Click to dismiss">{msg}</p>}

        {tab === 'plugins' && (
          <>
            <div className="pl-tools">
              <input type="text" placeholder="Search plugins" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="pl-chips">{FILTERS.map((f) => <button key={f.id} className={`pl-chip ${filter === f.id ? 'on' : ''}`} title={f.hint} onClick={() => setFilter(f.id)}>{f.label}<i>{counts[f.id]}</i></button>)}</div>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="size">Largest first</option><option value="name">Name</option><option value="vendor">Vendor</option></select>
            </div>
            <div className="cl-body">
              <div className="pl-list">
                <div className="pl-listhead">
                  <input type="checkbox" checked={allShownPicked} onChange={toggleAll} aria-label="select all shown" />
                  <span>{picked.size ? `${picked.size} selected` : `${shown.length} shown`}</span>
                  {picked.size > 0 && <button className="ghost" onClick={() => setPicked(new Set())}>Clear</button>}
                  <span className="grow" /><span className="dim">Shift-click selects a range</span>
                </div>
                <div className="pl-rows">
                  {plugins && !shown.length && <p className="help dim" style={{ padding: 20 }}>{plugins.length ? 'Nothing matches.' : 'No plugins found in the standard plugin folders.'}</p>}
                  {shown.map((p, i) => (
                    <div key={p.id} className={`pl-row ${p.id === sel ? 'sel' : ''} ${picked.has(p.id) ? 'pk' : ''}`} onClick={() => setSel(p.id)}>
                      <input type="checkbox" checked={picked.has(p.id)} onChange={() => {}} onClick={(e) => { e.stopPropagation(); pick(p.id, i, e.shiftKey) }} aria-label={`select ${p.name}`} />
                      <span className={`dot ${dot(p)}`} title={dot(p) === 'ok' ? 'No problems found' : 'Something was flagged'} />
                      <div className="cl-name"><b>{p.name}</b><span className="dim">{p.vendor || 'Unknown vendor'}</span></div>
                      <div className="cl-tags">{[...new Set(p.bundles.map((b) => FMT[b.format]))].map((f) => <em key={f} className="cb">{f}</em>)}</div>
                      <span className="pl-size">{size(p.totalSize)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="pl-detail">
                {cur ? (
                  <>
                    <div className="pl-dhead">
                      <h3>{cur.name}</h3>
                      <div className="dim">{cur.vendor || 'Unknown vendor'}{cur.bundles[0]?.version ? ` · v${cur.bundles[0].version}` : ''}</div>
                      <div className="cl-tags" style={{ marginTop: 6 }}>{[...new Set(cur.bundles.map((b) => FMT[b.format]))].map((f) => <em key={f} className="cb">{f}</em>)}<em className="cb">{size(cur.totalSize)}</em></div>
                    </div>
                    {findings.filter((f) => f.pluginId === cur.id).map((f) => <p key={f.id} className={`notice ${f.severity === 'bad' ? 'pl-bad-note' : ''}`}>{f.detail}</p>)}
                    <div className="pl-dbody">
                      {!files ? <p className="help dim">Looking for every file this plugin installed…</p> : (
                        <>
                          <p className="help">{plural(files.length, 'item', 'items')} · {size(files.reduce((a, f) => a + f.size, 0))} in total. You choose what goes when you uninstall.</p>
                          {grouped.map(([loc, list]) => (
                            <div key={loc} className="pl-group">
                              <h4>{loc}</h4>
                              {list.map((f) => (
                                <div key={f.path} className="pl-file" title={f.path}>
                                  <span className="pl-path"><b>{fileName(f.path)}</b><small className="dim">{dirName(f.path)}</small></span>
                                  <em className={`cb ${f.confidence === 'exact' ? 'ok' : f.confidence === 'maybe' ? 'pl-warn' : ''}`}>{CONF[f.confidence]}</em>
                                  <span className="dim">{size(f.size)}</span>
                                  <button className="ghost" onClick={() => window.api.pluginReveal(f.path)} title="Show in Finder">Show</button>
                                </div>
                              ))}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                    <div className="pl-dfoot"><button className="danger" disabled={!files || !!busy} onClick={() => openUninstall([cur])}>Uninstall…</button></div>
                  </>
                ) : <div className="cl-empty"><p className="help">Pick a plugin to see every file it has on this Mac. Tick the boxes to select several and remove them together.</p></div>}
              </aside>
            </div>

            {picked.size > 0 && (
              <div className="pl-bar">
                <span><b>{plural(picked.size, 'plugin', 'plugins')}</b> selected · up to {size(pickedBytes)}</span>
                <span className="grow" />
                <button onClick={() => setPicked(new Set())}>Clear</button>
                <button className="danger" disabled={!!busy} onClick={() => openUninstall(pickedPlugins)}>Uninstall {picked.size}…</button>
              </div>
            )}
          </>
        )}

        {tab === 'problems' && (
          <div className="pl-problems">
            {!findings.length ? (
              <div className="empty" style={{ padding: '50px 28px' }}>
                <p>No problems on record. “Check for problems” looks at FL Studio’s crash reports, FL’s own plugin list, broken installs, duplicate copies, and quarantined plugins.</p>
                <button className="primary" onClick={health} disabled={!!busy}>Check for problems</button>
              </div>
            ) : (
              <>
                {safeCount > 0 && (
                  <div className="pl-clean">
                    <div>
                      <b>Clean up for me</b>
                      <p>{plural(safeCount, 'thing', 'things')} can be fixed safely and undone: {safeGroups.map((g) => g.title).join(' · ')}.</p>
                    </div>
                    <button className="primary" disabled={!!busy} onClick={() => setDialog({ kind: 'fix', heading: 'Clean up for me', cleanup: true, sections: safeGroups.map((g) => section(g)) })}>Review and clean up</button>
                  </div>
                )}
                {groups.map((g) => {
                  const keep = g.findings.filter((f) => !unchecked.has(f.id))
                  const isOpen = open.has(g.key) || !g.fix
                  return (
                    <div key={g.key} className={`pl-find ${g.findings.some((f) => f.severity === 'bad') ? 'bad' : ''}`}>
                      <div className="pl-find-head">
                        <b>{g.title}</b>
                        {g.safe && <em className="cb ok">safe to undo</em>}
                        <span className="grow" />
                        {g.fix && <button onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>{isOpen ? 'Hide list' : 'Choose which'}</button>}
                        {g.fix && <button className="primary" disabled={!!busy || !keep.length} onClick={() => setDialog({ kind: 'fix', heading: g.title, cleanup: false, sections: [section(g)] })}>Fix {keep.length === g.findings.length ? 'all ' : ''}{keep.length}…</button>}
                      </div>
                      <p>{g.blurb}</p>
                      {isOpen && (
                        <div className="pl-items">
                          {g.findings.map((f) => (
                            <label key={f.id} className="pl-item" title={f.detail}>
                              {g.fix ? <input type="checkbox" checked={!unchecked.has(f.id)} onChange={() => setUnchecked((u) => { const n = new Set(u); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })} /> : <span />}
                              <b>{f.name || 'Unknown plugin'}</b>
                              <span className="dim pl-path-s">{short(f.path)}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {tab === 'disabled' && (
          <div className="pl-problems">
            {!disabled.length ? <div className="empty" style={{ padding: '50px 28px' }}><p>Nothing is disabled. When a fix turns a plugin off it waits here, and Restore puts it back exactly where it was.</p></div> : (
              <>
                <div className="pl-find-head"><span className="dim">{plural(disabled.length, 'plugin', 'plugins')} turned off</span><span className="grow" /><button disabled={!!busy} onClick={() => restore(disabled)}>Restore all</button></div>
                {disabled.map((d) => (
                  <div key={d.actionId} className="pl-find">
                    <div className="pl-find-head"><b>{d.name}</b><span className="dim pl-path-s" title={d.originalPath}>{short(d.originalPath)}</span><span className="grow" /><button disabled={!!busy} onClick={() => restore([d])}>Restore</button></div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {dialog?.kind === 'uninstall' && (() => {
        const checked = dialog.plans.reduce((a, p) => a + p.marks.size, 0)
        const bytes = dialog.plans.reduce((a, p) => a + p.files.filter((f) => p.marks.has(f.path)).reduce((s, f) => s + f.size, 0), 0)
        const setPlan = (id: number, fn: (m: Set<string>) => void) => setDialog({ ...dialog, plans: dialog.plans.map((p) => { if (p.plugin.id !== id) return p; const m = new Set(p.marks); fn(m); return { ...p, marks: m } }) })
        return (
          <div className="overlay" onClick={() => !busy && setDialog(null)}>
            <div className="modal pl-modal" onClick={(e) => e.stopPropagation()}>
              <header><h2>Uninstall {plural(dialog.plans.length, 'plugin', 'plugins')}?</h2></header>
              <p className="help">{plural(checked, 'item', 'items')} · {size(bytes)} will move to the Trash. “Maybe” items are unchecked, so look before you add them. Files in /Library ask for your Mac password, once.</p>
              <div className="pl-plans">
                {dialog.plans.map((p) => {
                  const isOpen = dialog.open.has(p.plugin.id)
                  const sub = p.files.filter((f) => p.marks.has(f.path)).reduce((s, f) => s + f.size, 0)
                  return (
                    <div key={p.plugin.id} className="pl-plan">
                      <div className="pl-plan-head" onClick={() => setDialog({ ...dialog, open: (() => { const n = new Set(dialog.open); if (n.has(p.plugin.id)) n.delete(p.plugin.id); else n.add(p.plugin.id); return n })() })}>
                        <span className="pl-caret">{isOpen ? '▾' : '▸'}</span>
                        <b>{p.plugin.name}</b>
                        <span className="dim">{p.marks.size} of {p.files.length} items · {size(sub)}</span>
                      </div>
                      {isOpen && p.files.map((f) => (
                        <label key={f.path} className="pl-file pl-fc" title={f.path}>
                          <input type="checkbox" checked={p.marks.has(f.path)} onChange={() => setPlan(p.plugin.id, (m) => { if (m.has(f.path)) m.delete(f.path); else m.add(f.path) })} />
                          <span className="pl-path"><b>{fileName(f.path)}</b><small className="dim">{dirName(f.path)}</small></span>
                          <em className={`cb ${f.confidence === 'exact' ? 'ok' : f.confidence === 'maybe' ? 'pl-warn' : ''}`}>{CONF[f.confidence]}</em>
                          <span className="dim">{size(f.size)}</span>
                        </label>
                      ))}
                    </div>
                  )
                })}
              </div>
              <footer className="pl-mfoot">
                <span className="grow" />
                <button onClick={() => setDialog(null)} disabled={!!busy}>Cancel</button>
                <button className="danger" onClick={doUninstall} disabled={!!busy || !checked}>Move {checked} to Trash</button>
              </footer>
            </div>
          </div>
        )
      })()}

      {dialog?.kind === 'fix' && (() => {
        const on = dialog.sections.filter((s) => s.on)
        const n = on.reduce((a, s) => a + s.ids.length, 0)
        return (
          <div className="overlay" onClick={() => !busy && setDialog(null)}>
            <div className="modal pl-modal" onClick={(e) => e.stopPropagation()}>
              <header><h2>{dialog.heading}</h2></header>
              <p className="help">Here is exactly what will happen. Nothing runs until you press the button. If any of it is in /Library, macOS asks for your password once.</p>
              <div className="pl-plans">
                {dialog.sections.map((s) => (
                  <label key={s.key} className={`pl-plan pl-sec ${s.on ? '' : 'off'}`}>
                    {dialog.cleanup ? <input type="checkbox" checked={s.on} onChange={() => setDialog({ ...dialog, sections: dialog.sections.map((x) => (x.key === s.key ? { ...x, on: !x.on } : x)) })} /> : <span />}
                    <div>
                      <b>{s.title}</b>
                      <p>{s.action}</p>
                      <span className="dim">{s.names.slice(0, 8).join(', ')}{s.names.length > 8 ? ` and ${s.names.length - 8} more` : ''}</span>
                    </div>
                  </label>
                ))}
              </div>
              <footer className="pl-mfoot">
                <span className="grow" />
                <button onClick={() => setDialog(null)} disabled={!!busy}>Cancel</button>
                <button className="primary" onClick={doFix} disabled={!!busy || !n}>Apply {plural(n, 'fix', 'fixes')}</button>
              </footer>
            </div>
          </div>
        )
      })()}
    </section>
  )
}
