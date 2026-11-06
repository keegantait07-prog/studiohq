import { ipcMain } from 'electron'
import { app, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { Sales } from '../sales'
import { coverData, pickCover, vizFeatures } from '../video'
import { setSecret } from '../ytkv'
import type { PublishDraft, YtDraftEdits, YtPublishEdits } from '../../shared/ytTypes'
import type { Post, VideoOptions } from '../../shared/types'
import { isKnownPath } from '../safe-path'
import type { IpcCtx } from './context'
import { runContentPack } from '../contentpack'
import type { ContentPackRequest } from '../../shared/types'

export function registerContentIpc(c: IpcCtx): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('content:all', () => c.content.all())
  h('content:savePost', (_, p: Post) => c.content.savePost(p))
  h('content:deletePost', (_, id: number) => c.content.deletePost(id))
  h('content:export', (_, o: VideoOptions) => c.videos.run(o, (p) => c.win?.webContents.send('video:progress', p)))
  h('content:cancel', () => c.videos.cancel())
  h('content:saveCover', (_, id: number, png: string) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(png)
    if (!m) return false
    const dir = join(app.getPath('userData'), 'covers')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}-${Date.now()}.png`)
    writeFileSync(file, Buffer.from(m[1], 'base64'))
    c.store.db.prepare('UPDATE beats SET cover_path=? WHERE id=?').run(file, id)
    c.store.bumpAll()
    return true
  })
  h('content:coverData', (_, id: number) => coverData(c.store.db, id))
  h('content:vizFeatures', (_, id: number, start: number, length: number) => vizFeatures(c.store.db, id, start, length))
  h('content:chooseCover', async (_, id: number) => { const ok = await pickCover(c.store.db, c.win!, id); if (ok) c.store.bumpAll(); return ok })
  h('content:clearCover', (_, id: number) => { c.store.db.prepare('UPDATE beats SET cover_path=NULL WHERE id=?').run(id); c.store.bumpAll() })
  // ---- Finished videos ----
  h('videos:list', () => c.content.videoFiles(c.store.getSettings().exportDir))
  h('videos:open', async (_, id: number) => { const p = c.content.videoPath(id); if (p) await shell.openPath(p) })
  h('videos:reveal', (_, id: number) => { const p = c.content.videoPath(id); if (p) shell.showItemInFolder(p) })
  h('videos:trash', async (_, id: number) => {
    const p = c.content.videoPath(id)
    if (p) { try { await shell.trashItem(p) } catch { /* already gone */ } }
    c.content.forgetVideo(id)
  })

  h('content:pack', (_, r: ContentPackRequest) => runContentPack({
    beat: (id) => c.store.getBeat(id),
    render: (o, p) => c.videos.run(o, p),
    videoIdOf: (path) => (c.store.db.prepare('SELECT id FROM videos WHERE path=? ORDER BY id DESC').get(path) as { id: number } | undefined)?.id ?? null,
    draftBlocker: async () => { const s = await c.yt.status(); return !s.signedIn ? 'Sign in to Google in Settings to get a YouTube draft.' : !s.imagesLeft ? 'Add unused pictures to your image folder to get a YouTube draft.' : null },
    prepareDraft: (id, artists, p, videoId) => c.yt.prepare(id, artists, p, videoId),
    savePost: (p) => c.content.savePost(p),
    footer: () => c.store.getSettings().producerName
  }, r, (p) => c.win?.webContents.send('video:progress', p)))

  // ---- YouTube publisher ----
  h('yt:status', () => c.yt.status())
  h('yt:suggestArtists', (_, id: number) => c.yt.suggestArtists(id))
  h('yt:prepare', (_, id: number, artists: string[], reuseVideoId?: number) => c.yt.prepare(id, artists, (label, pct) => c.win?.webContents.send('yt:progress', { label, pct }), reuseVideoId))
  h('yt:publish', (_, draft: PublishDraft, edits: YtPublishEdits) => c.yt.publish(draft, edits, (label, pct) => c.win?.webContents.send('yt:progress', { label, pct })))
  h('yt:loadDraft', (_, id: number) => c.yt.loadDraft(id))
  h('yt:saveEdits', (_, id: number, edits: YtDraftEdits) => c.yt.saveEdits(id, edits))
  h('yt:signIn', () => c.ytAuth.signIn())
  h('yt:signOut', () => c.ytAuth.signOut())
  h('yt:setSecret', (_, kind: 'google' | 'anthropic', value: string | null) => { if (kind === 'google') c.ytAuth.setClientSecret(value); else setSecret(c.store.db, 'anthropic_key', value) })
  h('yt:chooseImageFolder', async () => {
    const r = await dialog.showOpenDialog(c.win!, { title: 'Folder of images for YouTube videos', properties: ['openDirectory'] })
    if (!r.canceled && r.filePaths[0]) c.store.saveSettings({ ...c.store.getSettings(), ytImageFolder: r.filePaths[0] })
  })
  h('yt:openStudio', (_, url: string) => { if (url.startsWith('https://studio.youtube.com/')) return shell.openExternal(url) })
  // Reveal only files the app produced or tracks: exported videos, or anything inside the export, image or watched folders.
  h('app:revealPath', (_, p: string) => {
    if (typeof p !== 'string') return
    const s = c.store.getSettings()
    const roots = [s.exportDir, s.ytImageFolder, app.getPath('userData'), ...s.watchFolders, ...s.loopFolders, ...s.projectFolders, ...s.soundFolders].filter(Boolean)
    const isVideo = !!c.store.db.prepare('SELECT 1 FROM videos WHERE path=?').get(p)
    if (isVideo || isKnownPath(p, roots)) shell.showItemInFolder(p)
  })
  h('settings:chooseExportDir', async () => {
    const r = await dialog.showOpenDialog(c.win!, { title: 'Where should videos be saved?', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return
    c.store.saveSettings({ ...c.store.getSettings(), exportDir: r.filePaths[0] })
    c.sendCrm()
  })

  // ---- Sales & Collabs ----
}
