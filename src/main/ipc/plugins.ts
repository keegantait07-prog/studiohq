import { ipcMain } from 'electron'
import { app, shell } from 'electron'
import { join } from 'path'
import { listPlugins, scanPlugins } from '../plugins'
import { findPluginFiles } from '../plugin-files'
import { removePluginsMany, type RemoveItem } from '../plugin-remove'
import { getFinding, listFindings, runHealthChecks } from '../plugin-health'
import { applyFix, applyFixes, listDisabled, previewFix, realFixDeps, restoreDisabled } from '../plugin-fix'
import { isKnownPath } from '../safe-path'
import type { HealthFinding, RemoveManyResult, RemoveResult } from '../../shared/types'
import type { IpcCtx } from './context'

export function registerPluginsIpc(c: IpcCtx): void {
  const h = ipcMain.handle.bind(ipcMain)
  // ---- Plugin manager ----
  const pluginHome = () => app.getPath('home')
  const pluginExtraRoots = () => [join(pluginHome(), 'Documents'), ...c.store.getSettings().soundFolders]
  h('plugins:list', () => listPlugins(c.store.db))
  h('plugins:scan', () => scanPlugins(c.store.db, pluginHome()))
  h('plugins:files', (_, id: number) => {
    const p = listPlugins(c.store.db).find((x) => x.id === id)
    return p ? findPluginFiles(p, pluginHome(), c.store.getSettings().soundFolders) : []
  })
  // The window is not trusted to name files: only paths the finder itself proposes for that plugin can be removed.
  const removeMany = async (items: { id: number; paths: string[] }[]): Promise<RemoveManyResult> => {
    const plan: RemoveItem[] = []
    const rejected: string[] = []
    const unknown: string[] = []
    for (const it of items) {
      if (!it || !Number.isInteger(it.id)) continue
      const p = listPlugins(c.store.db).find((x) => x.id === it.id)
      if (!p || !Array.isArray(it.paths)) { unknown.push(`Unknown plugin ${it.id}`); continue }
      const proposed = new Set((await findPluginFiles(p, pluginHome(), c.store.getSettings().soundFolders)).map((f) => f.path))
      const asked = it.paths.filter((x): x is string => typeof x === 'string')
      plan.push({ plugin: p, paths: asked.filter((x) => proposed.has(x)) })
      rejected.push(...asked.filter((x) => !proposed.has(x)))
    }
    // everything that needs administrator rights is moved in one batch: one password prompt, however many plugins
    const r = await removePluginsMany(c.store.db, plan, pluginHome(), pluginExtraRoots())
    r.skipped.push(...rejected); r.failed.push(...unknown)
    await scanPlugins(c.store.db, pluginHome())
    return r
  }
  h('plugins:remove', async (_, id: number, paths: string[]): Promise<RemoveResult> => {
    const r = await removeMany([{ id, paths }])
    return { removed: r.removed, bytes: r.bytes, skipped: r.skipped, failed: r.failed, ...(r.declined ? { declined: true } : {}) }
  })
  h('plugins:removeMany', (_, items: { id: number; paths: string[] }[]) => removeMany(Array.isArray(items) ? items : []))
  h('plugins:health', () => runHealthChecks(c.store.db, pluginHome()))
  h('plugins:findings', () => listFindings(c.store.db))
  h('plugins:fixPreview', (_, id: number) => { const f = getFinding(c.store.db, id); return f ? previewFix(f) : 'That finding is gone. Run the health check again.' })
  h('plugins:fixApply', async (_, id: number) => {
    const f = getFinding(c.store.db, id)
    if (!f) return { error: 'That finding is gone. Run the health check again.' }
    try {
      await applyFix(c.store.db, realFixDeps(), f, pluginHome())
      await scanPlugins(c.store.db, pluginHome())
      await runHealthChecks(c.store.db, pluginHome())
      return {}
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  })
  h('plugins:fixApplyMany', async (_, ids: number[]) => {
    const fs = (Array.isArray(ids) ? ids : []).filter((n) => Number.isInteger(n)).map((n) => getFinding(c.store.db, n)).filter((f): f is HealthFinding => !!f)
    const r = await applyFixes(c.store.db, realFixDeps(), fs, pluginHome())
    await scanPlugins(c.store.db, pluginHome())
    await runHealthChecks(c.store.db, pluginHome())
    return r
  })
  h('plugins:disabled', () => listDisabled(c.store.db))
  h('plugins:restore', async (_, ids: number[]) => {
    const r = await restoreDisabled(c.store.db, realFixDeps(), (Array.isArray(ids) ? ids : []).filter((n) => Number.isInteger(n)))
    await scanPlugins(c.store.db, pluginHome())
    return r
  })
  // Reveal only plugin files the scan already found (or the Disabled Plugins folder), never an arbitrary renderer-supplied path.
  h('plugins:reveal', (_, path: string) => {
    if (typeof path !== 'string') return
    const known = c.store.db.prepare('SELECT 1 FROM plugin_bundles WHERE path=? UNION SELECT 1 FROM plugin_files WHERE path=? UNION SELECT 1 FROM plugin_findings WHERE path=? LIMIT 1').get(path, path, path)
    if (known || isKnownPath(path, [join(pluginHome(), 'Library/Application Support/Studio HQ')])) shell.showItemInFolder(path)
  })
}
