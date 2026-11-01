import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Confidence, HealthFinding, HealthKind, PluginFile, PluginInfo } from '@shared/types'

const size = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')
const short = (p: string) => p.replace(/^\/Users\/(?!Shared(\/|$))[^/]+/, '~')
const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => short(p.slice(0, p.lastIndexOf('/')) || '/')
const FMT: Record<string, string> = { vst2: 'VST', vst3: 'VST3', au: 'AU', aax: 'AAX' }
const KIND: Record<HealthKind, string> = {
  crash: 'Crashes FL Studio', 'fl-error': 'FL flagged it as failing', arch: 'Wrong chip', quarantine: 'Blocked by macOS', signature: 'Signature problem', 'broken-bundle': 'Broken install',
  duplicate: 'Duplicate copies', 'stale-fl-db': 'FL’s plugin list is out of date', 'missing-content': 'Missing content'
}
const CONF: Record<Confidence, string> = { exact: 'installed by it', likely: 'likely', maybe: 'maybe' }
const LOC_ORDER = ['Plugin folders', 'Installer receipt', 'Application Support', 'System support', 'Preferences', 'Caches', 'Logs', 'Saved state', 'Applications', 'Documents', 'Sample libraries']

// Most useful first: what makes FL crash or say "not found" comes before the advisory checks.
const KIND_ORDER: HealthKind[] = ['crash', 'fl-error', 'stale-fl-db', 'broken-bundle', 'duplicate', 'quarantine', 'signature', 'arch', 'missing-content']

type Tab = 'plugins' | 'problems' | 'disabled'
type Sort = 'size' | 'name' | 'vendor'
type Disabled = { actionId: number; name: string; originalPath: string; at: number }

export function Plugins({ toast }: { toast: (m: string) => void }) {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [findings, setFindings] = useState<HealthFinding[]>([])
  const [disabled, setDisabled] = useState<Disabled[]>([])
  const [tab, setTab] = useState<Tab>('plugins')
  const [sel, setSel] = useState<number | null>(null)
  const [files, setFiles] = useState<PluginFile[] | null>(null)
  const [marks, setMarks] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('size')
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState('')
  const [fixing, setFixing] = useState<{ id: number; preview: string } | null>(null)

  const reload = useCallback(async () => {
    const [p, f, d] = await Promise.all([window.api.pluginsList(), window.api.pluginsFindings(), window.api.pluginsDisabled()])
    setPlugins(p); setFindings(f); setDisabled(d)
    return p
  }, [])

  const scan = useCallback(async () => {
    setBusy('Looking for plugins…')
    try { setPlugins(await window.api.pluginsScan()); setFindings(await window.api.pluginsFindings()) } catch (e) { setMsg(e instanceof Error ? e.message : 'Scan failed') }
    setBusy('')
  }, [])

  useEffect(() => { reload().then((p) => { if (!p.length) scan() }) }, [reload, scan])

  const cur = plugins?.find((p) => p.id === sel) ?? null
  useEffect(() => {
    setFiles(null); setMarks(new Set()); setConfirm(false)
    if (sel == null) return
    let live = true
    window.api.pluginFiles(sel).then((f) => {
      if (!live) return
      setFiles(f)
      setMarks(new Set(f.filter((x) => x.confidence !== 'maybe').map((x) => x.path)))
    })
    return () => { live = false }
  }, [sel])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (plugins ?? []).filter((p) => !s || `${p.name} ${p.vendor}`.toLowerCase().includes(s))
    const by: Record<Sort, (a: PluginInfo, b: PluginInfo) => number> = { size: (a, b) => b.totalSize - a.totalSize, name: (a, b) => a.name.localeCompare(b.name), vendor: (a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name) }
    return [...list].sort(by[sort])
  }, [plugins, q, sort])

  const grouped = useMemo(() => {
    const m = new Map<string, PluginFile[]>()
    for (const f of files ?? []) m.set(f.location, [...(m.get(f.location) ?? []), f])
    return [...m.entries()].sort((a, b) => LOC_ORDER.indexOf(a[0]) - LOC_ORDER.indexOf(b[0]))
  }, [files])

  const markedFiles = (files ?? []).filter((f) => marks.has(f.path))
  const markedBytes = markedFiles.reduce((a, f) => a + f.size, 0)
  const toggle = (p: string) => setMarks((m) => { const n = new Set(m); n.has(p) ? n.delete(p) : n.add(p); return n })
  const totalSize = (plugins ?? []).reduce((a, p) => a + p.totalSize, 0)
  const pluginFindings = (id: number | null) => findings.filter((f) => f.pluginId === id)

  const uninstall = async () => {
    if (!cur) return
    setBusy('Moving to the Trash…')
    try {
      const r = await window.api.pluginsRemove(cur.id, markedFiles.map((f) => f.path))
      setMsg(`Moved ${r.removed} item${r.removed === 1 ? '' : 's'} to the Trash (${size(r.bytes)}). You can put them back from the Trash in Finder.${r.skipped.length ? ` ${r.skipped.length} skipped (not allowed, or the password prompt was cancelled).` : ''}${r.failed.length ? ` ${r.failed.length} could not be moved: ${r.failed[0]}` : ''}`)
      setConfirm(false); setSel(null)
      setPlugins(await window.api.pluginsScan()); await reload()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Something went wrong, nothing was deleted.') }
    setBusy('')
  }

  const health = async () => {
    setBusy('Checking every plugin. This can take a minute…')
    try { setFindings(await window.api.pluginsHealth()); setPlugins(await window.api.pluginsList()); setTab('problems') } catch (e) { setMsg(e instanceof Error ? e.message : 'Check failed') }
    setBusy('')
  }

  const applyFix = async () => {
    if (!fixing) return
    setBusy('Applying fix…')
    const r = await window.api.pluginsFixApply(fixing.id)
    setBusy(''); setFixing(null)
    if (r.error) setMsg(r.error); else toast('Fixed. Restart FL Studio and rescan its plugin list if it was open.')
    await reload()
  }

  const restore = async (d: Disabled) => {
    const r = await window.api.pluginsRestore([d.actionId])
    if (r.failed.length) setMsg(r.failed[0]); else toast(`${d.name} restored`)
    await reload()
  }

  const healthBadge = (p: PluginInfo) => p.health === 'bad' ? <em className="cb pl-bad">problem</em> : p.health === 'warn' ? <em className="cb pl-warn">check</em> : null
  const bad = findings.filter((f) => f.severity === 'bad').length
  const ordered = useMemo(() => [...findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)), [findings])

  return (
    <section className="sales">
      <div className="sales-head">
        <h2>Plugins</h2>
        <span className="dim">{plugins ? `${plugins.length} plugins · ${size(totalSize)} in plugin folders` : ''}</span>
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
      {busy && <p className="notice">{busy}</p>}
      {msg && <p className="notice" onClick={() => setMsg('')}>{msg}</p>}

      {tab === 'plugins' && (
        <>
          <div className="cl-bar">
            <input type="text" placeholder="Search plugins" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="size">Largest first</option><option value="name">Name</option><option value="vendor">Vendor</option></select>
          </div>
          <div className="cl-body">
            <div className="cl-list">
              {plugins && !shown.length && <p className="help dim" style={{ padding: 20 }}>{plugins.length ? 'Nothing matches that search.' : 'No plugins found in the standard plugin folders.'}</p>}
              {shown.map((p) => (
                <div key={p.id} className={`pl-row ${p.id === sel ? 'sel' : ''}`} onClick={() => setSel(p.id)}>
                  <div className="cl-name"><b>{p.name}</b><span className="dim">{p.vendor || 'Unknown vendor'}</span></div>
                  <div className="cl-tags">{healthBadge(p)}{[...new Set(p.bundles.map((b) => FMT[b.format]))].map((f) => <em key={f} className="cb">{f}</em>)}</div>
                  <span className="pl-size">{size(p.totalSize)}</span>
                </div>
              ))}
            </div>

            <aside className="cl-pane">
              {cur ? (
                <>
                  <h3>{cur.name}</h3>
                  <div className="dim">{cur.vendor || 'Unknown vendor'}{cur.bundles[0]?.version ? ` · v${cur.bundles[0].version}` : ''}</div>
                  {pluginFindings(cur.id).map((f) => <p key={f.id} className={`notice ${f.severity === 'bad' ? 'pl-bad-note' : ''}`}><b>{KIND[f.kind]}.</b> {f.detail}</p>)}
                  {!files ? <p className="help dim">Looking for every file this plugin installed…</p> : (
                    <>
                      <p className="help">{files.length} item{files.length === 1 ? '' : 's'} · {size(files.reduce((a, f) => a + f.size, 0))} in total. Checked items go to the Trash. “Maybe” ones are unchecked, so look before you add them.</p>
                      {grouped.map(([loc, list]) => (
                        <div key={loc} className="pl-group">
                          <h4>{loc}</h4>
                          {list.map((f) => (
                            <label key={f.path} className="pl-file" title={f.path}>
                              <input type="checkbox" checked={marks.has(f.path)} onChange={() => toggle(f.path)} />
                              <span className="pl-path"><b>{fileName(f.path)}</b><small className="dim">{dirName(f.path)}</small></span>
                              <em className={`cb ${f.confidence === 'exact' ? 'ok' : f.confidence === 'maybe' ? 'pl-warn' : ''}`}>{CONF[f.confidence]}</em>
                              <span className="dim">{size(f.size)}</span>
                              <button className="ghost" onClick={(e) => { e.preventDefault(); window.api.pluginReveal(f.path) }} title="Show in Finder">Show</button>
                            </label>
                          ))}
                        </div>
                      ))}
                    </>
                  )}
                </>
              ) : <div className="cl-empty"><p className="help">Pick a plugin to see every file it has on this Mac, including presets, caches and licenses, and remove it completely.</p></div>}
            </aside>
          </div>

          {cur && files && !confirm && (
            <footer className="cl-foot">
              <span><b>{markedFiles.length}</b> checked · {size(markedBytes)}</span>
              <span className="grow" />
              <button className="danger" disabled={!markedFiles.length || !!busy} onClick={() => { setMsg(''); setConfirm(true) }}>Uninstall…</button>
            </footer>
          )}
          {cur && confirm && (
            <footer className="cl-foot confirm">
              <div>
                <b>Move {markedFiles.length} item{markedFiles.length === 1 ? '' : 's'} ({size(markedBytes)}) for {cur.name} to the Trash?</b>
                <ul className="pl-confirm">{markedFiles.map((f) => <li key={f.path} title={f.path}>{short(f.path)}</li>)}</ul>
                <div className="dim">Files in /Library ask for your Mac password. Nothing is deleted outright; put anything back from the Trash in Finder.</div>
              </div>
              <button onClick={() => setConfirm(false)} disabled={!!busy}>Cancel</button>
              <button className="danger" onClick={uninstall} disabled={!!busy}>Move to Trash</button>
            </footer>
          )}
        </>
      )}

      {tab === 'problems' && (
        <div className="pl-problems">
          {!findings.length ? (
            <div className="empty" style={{ padding: '50px 28px' }}>
              <p>No problems on record. “Check for problems” looks at FL Studio’s crash reports, each plugin’s chip type, signature and quarantine flag, duplicate copies, and FL’s own plugin list.</p>
              <button className="primary" onClick={health} disabled={!!busy}>Check for problems</button>
            </div>
          ) : (
            <>
              <p className="help">{bad} serious, {findings.length - bad} to look at. Every fix is shown first and can be undone.</p>
              {ordered.map((f) => (
                <div key={f.id} className={`pl-find ${f.severity}`}>
                  <div className="pl-find-head">
                    <b>{f.name || 'Unknown plugin'}</b><em className={`cb ${f.severity === 'bad' ? 'pl-bad' : 'pl-warn'}`}>{KIND[f.kind]}</em>
                    <em className="cb">{f.certainty === 'confirmed' ? 'confirmed' : 'likely cause'}</em>
                  </div>
                  <p>{f.detail}</p>
                  {fixing?.id === f.id ? (
                    <div className="pl-fix">
                      <p className="notice">{fixing.preview}</p>
                      <button onClick={() => setFixing(null)} disabled={!!busy}>Cancel</button>
                      <button className="primary" onClick={applyFix} disabled={!!busy}>Apply fix</button>
                    </div>
                  ) : f.fix ? (
                    <button onClick={async () => setFixing({ id: f.id, preview: await window.api.pluginsFixPreview(f.id) })}>Fix…</button>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'disabled' && (
        <div className="pl-problems">
          {!disabled.length ? <div className="empty" style={{ padding: '50px 28px' }}><p>Nothing is disabled. When a fix turns a plugin off it waits here, and Restore puts it back exactly where it was.</p></div> : (
            disabled.map((d) => (
              <div key={d.actionId} className="pl-find">
                <div className="pl-find-head"><b>{d.name}</b><span className="dim" title={d.originalPath}>{short(d.originalPath)}</span><span className="grow" /><button onClick={() => restore(d)}>Restore</button></div>
              </div>
            ))
          )}
        </div>
      )}
      </div>
    </section>
  )
}
