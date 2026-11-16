import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Confidence, HealthFinding, PluginFile, PluginInfo } from '@shared/types'
import { Search, ChevronRight } from 'lucide-react'
import { ScrollArea } from '@/components/lib/scroll-area'
import { clickable } from './a11y'
import { Button, Collapse, DynToggle, DialogFade, Num } from './pluginsUi'
import './plugins.css'
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

  const maxSize = (plugins ?? []).reduce((a, p) => Math.max(a, p.totalSize), 1)
  const fmts = (p: PluginInfo) => [...new Set(p.bundles.map((b) => FMT[b.format]))]
  const fileRow = (f: PluginFile) => (
    <>
      <span className="pg-path"><b>{fileName(f.path)}</b><small>{dirName(f.path)}</small></span>
      <em className={`pg-conf ${f.confidence === 'exact' ? 'ok' : f.confidence === 'maybe' ? 'maybe' : ''}`}>{CONF[f.confidence]}</em>
      <span className="pg-sz">{size(f.size)}</span>
    </>
  )

  return (
    <section className="pgx">
      <header className="pg-head">
        <div>
          <div className="pg-eyebrow">Your plugin folders</div>
          <h1 className="pg-disp">Plugins</h1>
          <p>Every plugin FL Studio can see, what each one left on this Mac, and what needs fixing.</p>
        </div>
        <div className="pg-actions">
          <div className="pg-seg" role="tablist" aria-label="Plugin views">
            <button type="button" role="tab" aria-selected={tab === 'plugins'} onClick={() => setTab('plugins')}>All plugins</button>
            <button type="button" role="tab" aria-selected={tab === 'problems'} onClick={() => setTab('problems')}>Problems{findings.length ? ` ${findings.length}` : ''}</button>
            <button type="button" role="tab" aria-selected={tab === 'disabled'} onClick={() => setTab('disabled')}>Disabled{disabled.length ? ` ${disabled.length}` : ''}</button>
          </div>
          <Button variant="outline" onClick={scan} disabled={!!busy}>Rescan</Button>
          <Button onClick={health} disabled={!!busy} title="Looks for plugins that crash FL or show “not found”">Check for problems</Button>
        </div>
      </header>

      <div className="pg-stats">
        <div className="pg-blk c"><small>plugins</small><b>{plugins ? <Num value={plugins.length} /> : '…'}</b></div>
        <div className="pg-blk"><small>in plugin folders</small><b>{size(totalSize)}</b></div>
        <div className={`pg-blk ${bad ? 'hot' : ''}`}><small>{bad ? `${bad} serious` : 'things to look at'}</small><b><Num value={findings.length} /></b></div>
        <div className={`pg-blk ${picked.size ? 'sel' : ''}`}><small>{picked.size ? `${plural(picked.size, 'plugin', 'plugins')} selected` : 'nothing selected'}</small><b>{picked.size ? size(pickedBytes) : '—'}</b></div>
      </div>
      {(busy || msg) && (
        <div className="pg-notes">
          {busy && <p className="pg-note">{busy}</p>}
          {msg && <p className="pg-note" onClick={() => setMsg('')} title="Click to dismiss">{msg}</p>}
        </div>
      )}

      {tab === 'plugins' && (
        <div className="pg-main">
          <div className="pg-tools">
            <label className="pg-search"><Search aria-hidden="true" /><input type="text" placeholder="Search plugins" aria-label="Search plugins" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <div className="pg-chips">{FILTERS.map((f) => <button key={f.id} type="button" className="pg-chip" aria-pressed={filter === f.id} title={f.hint} onClick={() => setFilter(f.id)}>{f.label}<i>{counts[f.id]}</i></button>)}</div>
            <select className="pg-select" aria-label="Sort plugins" value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="size">Largest first</option><option value="name">Name</option><option value="vendor">Vendor</option></select>
          </div>
          <div className="pg-listhead">
            <input type="checkbox" checked={allShownPicked} onChange={toggleAll} aria-label="select all shown" />
            <span>{picked.size ? `${picked.size} selected` : `${shown.length} shown`}</span>
            {picked.size > 0 && <Button variant="ghost" size="xs" onClick={() => setPicked(new Set())}>Clear</Button>}
            <span className="pg-sp" /><span className="pg-hint">Shift-click selects a range · click a row to open it</span>
          </div>
          <div className="pg-listwrap">
            <ScrollArea className="pg-rows">
              {plugins && !shown.length && <p className="pg-empty">{plugins.length ? 'Nothing matches.' : 'No plugins found in the standard plugin folders.'}</p>}
              {shown.map((p, i) => {
                const isOpen = p.id === sel
                return (
                  <div key={p.id} className={`pg-item ${isOpen ? 'open' : ''} ${picked.has(p.id) ? 'pk' : ''}`}>
                    <div className="pg-row" aria-expanded={isOpen} {...clickable(() => setSel(isOpen ? null : p.id))}>
                      <input type="checkbox" checked={picked.has(p.id)} onChange={() => {}} onClick={(e) => { e.stopPropagation(); pick(p.id, i, e.shiftKey) }} aria-label={`select ${p.name}`} />
                      <span className={`pg-dot ${dot(p)}`} title={dot(p) === 'ok' ? 'No problems found' : 'Something was flagged'} />
                      <div className="pg-name"><b>{p.name}</b><small>{p.vendor || 'Unknown vendor'}</small></div>
                      <div className="pg-fmts">{fmts(p).map((f) => <em key={f} className="pg-fmt">{f}</em>)}</div>
                      <div className="pg-sizecell"><span className="pg-sz">{size(p.totalSize)}</span><i className="pg-bar"><u style={{ width: `${Math.max(2, (p.totalSize / maxSize) * 100)}%` }} /></i></div>
                      <ChevronRight className="pg-caret" aria-hidden="true" />
                    </div>
                    <Collapse open={isOpen && !!cur} className="pg-bodywrap">
                      {cur && cur.id === p.id && (
                        <div className="pg-body">
                          <div className="pg-dhead">
                            <span>{cur.vendor || 'Unknown vendor'}{cur.bundles[0]?.version ? ` · v${cur.bundles[0].version}` : ''} · {size(cur.totalSize)}</span>
                            <span className="pg-sp" />
                            <Button variant="destructive" size="sm" disabled={!files || !!busy} onClick={() => openUninstall([cur])}>Uninstall…</Button>
                          </div>
                          {findings.filter((f) => f.pluginId === cur.id).map((f) => <p key={f.id} className={`pg-note ${f.severity === 'bad' ? 'bad' : ''}`}>{f.detail}</p>)}
                          {!files ? <p className="pg-help">Looking for every file this plugin installed…</p> : (
                            <>
                              <p className="pg-help">{plural(files.length, 'item', 'items')} · {size(files.reduce((a, f) => a + f.size, 0))} in total. You choose what goes when you uninstall.</p>
                              {grouped.map(([loc, list]) => (
                                <div key={loc} className="pg-group">
                                  <h4>{loc}</h4>
                                  {list.map((f) => (
                                    <div key={f.path} className="pg-file" title={f.path}>
                                      {fileRow(f)}
                                      <Button variant="ghost" size="xs" onClick={() => window.api.pluginReveal(f.path)} title="Show in Finder">Show</Button>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </Collapse>
                  </div>
                )
              })}
            </ScrollArea>
          </div>
          {picked.size > 0 && (
            <div className="pg-bar2">
              <span><b>{plural(picked.size, 'plugin', 'plugins')}</b> selected · up to {size(pickedBytes)}</span>
              <span className="pg-sp" />
              <Button variant="outline" onClick={() => setPicked(new Set())}>Clear</Button>
              <Button variant="destructive" disabled={!!busy} onClick={() => openUninstall(pickedPlugins)}>Uninstall {picked.size}…</Button>
            </div>
          )}
        </div>
      )}

      {tab === 'problems' && (
        <ScrollArea className="pg-pane">
          <div className="pg-stack">
            {!findings.length ? (
              <div className="pg-emptybox">
                <p>No problems on record. “Check for problems” looks at FL Studio’s crash reports, FL’s own plugin list, broken installs, duplicate copies, and quarantined plugins.</p>
                <Button onClick={health} disabled={!!busy}>Check for problems</Button>
              </div>
            ) : (
              <>
                {safeCount > 0 && (
                  <div className="pg-clean">
                    <div>
                      <b>Clean up for me</b>
                      <p>{plural(safeCount, 'thing', 'things')} can be fixed safely and undone: {safeGroups.map((g) => g.title).join(' · ')}.</p>
                    </div>
                    <Button disabled={!!busy} onClick={() => setDialog({ kind: 'fix', heading: 'Clean up for me', cleanup: true, sections: safeGroups.map((g) => section(g)) })}>Review and clean up</Button>
                  </div>
                )}
                {groups.map((g) => {
                  const keep = g.findings.filter((f) => !unchecked.has(f.id))
                  const isOpen = open.has(g.key) || !g.fix
                  return (
                    <div key={g.key} className={`pg-find ${g.findings.some((f) => f.severity === 'bad') ? 'bad' : ''}`}>
                      <div className="pg-find-head">
                        <b>{g.title}</b>
                        {g.safe && <em className="pg-conf ok">safe to undo</em>}
                        <span className="pg-sp" />
                        {g.fix && <Button variant="outline" size="sm" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>{isOpen ? 'Hide list' : 'Choose which'}</Button>}
                        {g.fix && <Button size="sm" disabled={!!busy || !keep.length} onClick={() => setDialog({ kind: 'fix', heading: g.title, cleanup: false, sections: [section(g)] })}>Fix {keep.length === g.findings.length ? 'all ' : ''}{keep.length}…</Button>}
                      </div>
                      <p>{g.blurb}</p>
                      <Collapse open={isOpen} className="pg-itemswrap">
                        <div className="pg-items">
                          {g.findings.map((f) => (
                            <label key={f.id} className="pg-item2" title={f.detail}>
                              {g.fix ? <DynToggle checked={!unchecked.has(f.id)} label={f.name || 'Unknown plugin'} onChange={() => setUnchecked((u) => { const n = new Set(u); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })} /> : <span />}
                              <b>{f.name || 'Unknown plugin'}</b>
                              <span className="pg-path-s">{short(f.path)}</span>
                            </label>
                          ))}
                        </div>
                      </Collapse>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </ScrollArea>
      )}

      {tab === 'disabled' && (
        <ScrollArea className="pg-pane">
          <div className="pg-stack">
            {!disabled.length ? <div className="pg-emptybox"><p>Nothing is disabled. When a fix turns a plugin off it waits here, and Restore puts it back exactly where it was.</p></div> : (
              <>
                <div className="pg-find-head"><span className="pg-hint">{plural(disabled.length, 'plugin', 'plugins')} turned off</span><span className="pg-sp" /><Button variant="outline" size="sm" disabled={!!busy} onClick={() => restore(disabled)}>Restore all</Button></div>
                {disabled.map((d) => (
                  <div key={d.actionId} className="pg-find">
                    <div className="pg-find-head"><b>{d.name}</b><span className="pg-path-s" title={d.originalPath}>{short(d.originalPath)}</span><span className="pg-sp" /><Button variant="outline" size="sm" disabled={!!busy} onClick={() => restore([d])}>Restore</Button></div>
                  </div>
                ))}
              </>
            )}
          </div>
        </ScrollArea>
      )}

      {dialog?.kind === 'uninstall' && (() => {
        const checked = dialog.plans.reduce((a, p) => a + p.marks.size, 0)
        const bytes = dialog.plans.reduce((a, p) => a + p.files.filter((f) => p.marks.has(f.path)).reduce((s, f) => s + f.size, 0), 0)
        const setPlan = (id: number, fn: (m: Set<string>) => void) => setDialog({ ...dialog, plans: dialog.plans.map((p) => { if (p.plugin.id !== id) return p; const m = new Set(p.marks); fn(m); return { ...p, marks: m } }) })
        return (
          <div className="overlay pg-scrim" onClick={(e) => { if (e.target === e.currentTarget && !busy) setDialog(null) }}>
            <DialogFade className="modal pg-dlg">
              <header><h2 className="pg-disp">Uninstall {plural(dialog.plans.length, 'plugin', 'plugins')}?</h2></header>
              <p className="pg-help pad">{plural(checked, 'item', 'items')} · {size(bytes)} will move to the Trash. “Maybe” items are unchecked, so look before you add them. Files in /Library ask for your Mac password, once.</p>
              <div className="pg-plans">
                {dialog.plans.map((p) => {
                  const isOpen = dialog.open.has(p.plugin.id)
                  const sub = p.files.filter((f) => p.marks.has(f.path)).reduce((s, f) => s + f.size, 0)
                  return (
                    <div key={p.plugin.id} className={`pg-plan ${isOpen ? 'open' : ''}`}>
                      <div className="pg-plan-head" aria-expanded={isOpen} {...clickable(() => setDialog({ ...dialog, open: (() => { const n = new Set(dialog.open); if (n.has(p.plugin.id)) n.delete(p.plugin.id); else n.add(p.plugin.id); return n })() }))}>
                        <ChevronRight className="pg-caret" aria-hidden="true" />
                        <b>{p.plugin.name}</b>
                        <span className="pg-hint">{p.marks.size} of {p.files.length} items · {size(sub)}</span>
                      </div>
                      <Collapse open={isOpen}>
                        {p.files.map((f) => (
                          <label key={f.path} className="pg-file fc" title={f.path}>
                            <DynToggle checked={p.marks.has(f.path)} label={fileName(f.path)} onChange={() => setPlan(p.plugin.id, (m) => { if (m.has(f.path)) m.delete(f.path); else m.add(f.path) })} />
                            {fileRow(f)}
                          </label>
                        ))}
                      </Collapse>
                    </div>
                  )
                })}
              </div>
              <footer>
                <span className="pg-sp" />
                <Button variant="outline" onClick={() => setDialog(null)} disabled={!!busy}>Cancel</Button>
                <Button variant="destructive" onClick={doUninstall} disabled={!!busy || !checked}>Move {checked} to Trash</Button>
              </footer>
            </DialogFade>
          </div>
        )
      })()}

      {dialog?.kind === 'fix' && (() => {
        const on = dialog.sections.filter((s) => s.on)
        const n = on.reduce((a, s) => a + s.ids.length, 0)
        return (
          <div className="overlay pg-scrim" onClick={(e) => { if (e.target === e.currentTarget && !busy) setDialog(null) }}>
            <DialogFade className="modal pg-dlg">
              <header><h2 className="pg-disp">{dialog.heading}</h2></header>
              <p className="pg-help pad">Here is exactly what will happen. Nothing runs until you press the button. If any of it is in /Library, macOS asks for your password once.</p>
              <div className="pg-plans">
                {dialog.sections.map((s) => (
                  <label key={s.key} className={`pg-plan pg-sec ${s.on ? '' : 'off'}`}>
                    {dialog.cleanup ? <DynToggle checked={s.on} label={s.title} onChange={() => setDialog({ ...dialog, sections: dialog.sections.map((x) => (x.key === s.key ? { ...x, on: !x.on } : x)) })} /> : <span />}
                    <div>
                      <b>{s.title}</b>
                      <p>{s.action}</p>
                      <small>{s.names.slice(0, 8).join(', ')}{s.names.length > 8 ? ` and ${s.names.length - 8} more` : ''}</small>
                    </div>
                  </label>
                ))}
              </div>
              <footer>
                <span className="pg-sp" />
                <Button variant="outline" onClick={() => setDialog(null)} disabled={!!busy}>Cancel</Button>
                <Button onClick={doFix} disabled={!!busy || !n}>Apply {plural(n, 'fix', 'fixes')}</Button>
              </footer>
            </DialogFade>
          </div>
        )
      })()}
    </section>
  )
}
