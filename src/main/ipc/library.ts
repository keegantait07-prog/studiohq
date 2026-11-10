import { app, ipcMain, dialog, shell, nativeImage } from 'electron'
import { join } from 'path'
import { exportKit } from '../kitmaker'
import { Feedback } from '../feedback'
import { cleanupList, trashProjects } from '../cleanup'
import type { BeatPatch, Settings, TagKind, VaultKind } from '../../shared/types'
import type { FolderKind, IpcCtx } from './context'
import { cleanSettingsPatch } from '../settings-guard'

export function registerLibraryIpc(c: IpcCtx): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('beats:list', () => c.store.listBeats())
  h('loops:list', () => c.store.listLoops())
  h('beats:get', (_, id: number) => c.store.getBeat(id))
  h('release:get', (_, id: number) => c.store.releaseFor(id))
  // a project link is only set through the file picker below, because Open in FL hands that path to the system
  h('beats:update', (_, id: number, patch: BeatPatch) => c.store.updateBeat(id, patch?.projectPath ? { ...patch, projectPath: undefined } : patch))
  h('beats:setTags', (_, id: number, tags: Record<TagKind, string[]>) => c.store.setTags(id, tags))
  h('beats:allTags', (_, kind?: VaultKind) => c.store.allTags(kind === 'loop' ? 'loop' : 'beat'))
  h('beats:reanalyze', (_, id: number) => c.store.reanalyze(id))
  h('beats:reveal', (_, id: number) => { const p = c.store.pathOf(id); if (p) shell.showItemInFolder(p) })
  h('beats:openProject', async (_, id: number) => {
    const p = c.store.getBeat(id)?.projectPath
    if (p) await shell.openPath(p)
  })
  h('beats:linkProject', async (_, id: number) => {
    const r = await dialog.showOpenDialog(c.win!, {
      title: 'Link FL Studio project', properties: ['openFile'], filters: [{ name: 'FL Studio project', extensions: ['flp'] }],
      defaultPath: c.store.getSettings().projectFolders[0]
    })
    if (!r.canceled && r.filePaths[0]) c.store.updateBeat(id, { projectPath: r.filePaths[0] })
  })
  h('settings:get', () => c.store.getSettings())
  h('settings:addFolder', async (_, kind: FolderKind) => {
    const r = await dialog.showOpenDialog(c.win!, { properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return
    const s = c.store.getSettings()
    if (!s[kind].includes(r.filePaths[0])) s[kind].push(r.filePaths[0])
    c.store.saveSettings(s)
    c.writeBridgeConfig()
    await c.restartWatchers()
  })
  h('settings:removeFolder', async (_, kind: FolderKind, path: string) => {
    const s = c.store.getSettings()
    s[kind] = s[kind].filter((f) => f !== path)
    c.store.saveSettings(s)
    c.writeBridgeConfig()
    await c.restartWatchers()
  })
  h('settings:chooseClaudePath', async (_, clear?: boolean) => {
    if (!clear) {
      const r = await dialog.showOpenDialog(c.win!, { title: 'Choose the Claude CLI', properties: ['openFile', 'showHiddenFiles'], defaultPath: '/usr/local/bin' })
      if (r.canceled || !r.filePaths[0]) return c.store.getSettings().claudePath
      c.store.saveSettings({ ...c.store.getSettings(), claudePath: r.filePaths[0] })
    } else c.store.saveSettings({ ...c.store.getSettings(), claudePath: '' })
    return c.store.getSettings().claudePath
  })
  h('settings:set', async (_, raw: unknown) => {
    const patch = cleanSettingsPatch(raw, c.store.getSettings())
    c.store.saveSettings({ ...c.store.getSettings(), ...patch })
    if ('includeIdeas' in patch || 'ownHandles' in patch) await c.restartWatchers()
    else c.sendCrm()
  })

  // ---- Sound Library ----
  h('sounds:list', () => c.sounds.list(c.projectIndex.list()))
  h('sounds:scan', () => c.scanLibrary())
  h('kits:defaults', () => ({ outDir: join(app.getPath('home'), 'Desktop', '!DRUM KITS', '! MY KITS') }))
  h('kits:pickFolder', async () => {
    const r = await dialog.showOpenDialog(c.win!, { title: 'Where should the kit be saved?', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Save kits here' })
    return r.canceled ? null : r.filePaths[0]
  })
  h('kits:export', async (_, req: { name: string; tag: string; outDir: string; files: { id: number; folder: string; name: string }[] }) => {
    const files = req.files.map((f) => ({ from: c.sounds.pathOf(f.id), folder: f.folder, name: f.name })).filter((f): f is { from: string; folder: string; name: string } => !!f.from)
    const r = await exportKit(files, req.outDir, req.name, join(app.getPath('userData'), 'kit-map.json'))
    shell.showItemInFolder(r.dir)
    c.scanLibrary().catch((e) => console.error('library scan failed', e))
    return r
  })
  h('projects:reindex', () => c.reindexProjects())
  h('cleanup:list', () => cleanupList(c.store.db, c.store.getSettings().projectFolders))
  h('cleanup:trash', async (_, ids: number[], withBackups: boolean) => {
    const r = await trashProjects(c.store.db, c.store.getSettings().projectFolders, (path) => (c.store.db.prepare('SELECT m.path FROM flp_midis m JOIN flp_projects p ON p.id=m.project_id WHERE p.path=?').all(path) as { path: string }[]).map((m) => m.path), ids.filter((n) => Number.isInteger(n)), !!withBackups)
    c.store.bumpAll()
    c.win?.webContents.send('sounds:changed')
    return r
  })
  h('projects:open', (_, id: number) => { const p = (c.store.db.prepare('SELECT path FROM flp_projects WHERE id=?').get(id) as { path: string } | undefined)?.path; if (p) return shell.openPath(p) })
  h('projects:reveal', (_, id: number) => { const p = (c.store.db.prepare('SELECT path FROM flp_projects WHERE id=?').get(id) as { path: string } | undefined)?.path; if (p) shell.showItemInFolder(p) })
  h('sounds:tag', (_, ids: number[], add: string[], remove: string[]) => c.sounds.tag(ids, add, remove))
  h('sounds:fav', (_, ids: number[], fav: boolean) => c.sounds.fav(ids, fav))
  h('sounds:dupes', () => c.sounds.duplicates())
  h('sounds:trash', (_, ids: number[]) => c.sounds.trash(ids))
  h('sounds:reveal', (_, id: number) => { const p = c.sounds.pathOf(id); if (p) shell.showItemInFolder(p) })
  ipcMain.on('app:startDrag', (e, kind: 'sound' | 'beat', ids: number[]) => {
    const files = ids.slice(0, 60).map((id) => (kind === 'sound' ? c.sounds.pathOf(id) : c.store.pathOf(id))).filter((p): p is string => !!p)
    if (!files.length) return
    const px = Buffer.alloc(32 * 32 * 4)
    for (let i = 0; i < 32 * 32; i++) { px[i * 4] = 0x3d; px[i * 4 + 1] = 0x6b; px[i * 4 + 2] = 0xff; px[i * 4 + 3] = 0xff } // BGRA accent square
    e.sender.startDrag({ file: files[0], files, icon: nativeImage.createFromBitmap(px, { width: 32, height: 32 }) })
  })

  // ---- Feedback links ----
}
