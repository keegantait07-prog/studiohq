import { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu } from 'electron'
import { join } from 'path'
import { createReadStream, statSync, mkdirSync } from 'fs'
import { Readable } from 'stream'
import { openDb } from './db'
import { Store } from './store'
import { Watcher } from './watcher'
import type { BeatPatch, Settings, TagKind } from '../shared/types'

app.setName('Studio HQ')
app.setPath('userData', join(app.getPath('appData'), 'Studio HQ'))

protocol.registerSchemesAsPrivileged([
  { scheme: 'shqa', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, standard: true, secure: true } }
])

let win: BrowserWindow | null = null
let store: Store
let watcher: Watcher

const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aif: 'audio/aiff', aiff: 'audio/aiff', ogg: 'audio/ogg' }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0d0e11', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

function serveAudio(req: Request): Response {
  const id = Number(new URL(req.url).pathname.replace('/', ''))
  const path = store.pathOf(id)
  if (!path) return new Response('not found', { status: 404 })
  let size: number
  try { size = statSync(path).size } catch { return new Response('missing', { status: 404 }) }
  const ext = path.split('.').pop()!.toLowerCase()
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' }
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/)
  let start = 0, end = size - 1, status = 200
  if (range) {
    if (range[1]) start = parseInt(range[1], 10)
    if (range[2]) end = Math.min(parseInt(range[2], 10), size - 1)
    if (!range[1] && range[2]) { start = Math.max(0, size - parseInt(range[2], 10)); end = size - 1 }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  headers['Content-Length'] = String(end - start + 1)
  const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
  return new Response(body, { status, headers })
}

function backupNow(): Promise<string> {
  const dir = join(app.getPath('userData'), 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = join(dir, `studio-hq-${stamp}.db`)
  return store.db.backup(dest).then(() => dest)
}

function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('beats:list', () => store.listBeats())
  h('beats:get', (_, id: number) => store.getBeat(id))
  h('beats:update', (_, id: number, patch: BeatPatch) => store.updateBeat(id, patch))
  h('beats:setTags', (_, id: number, tags: Record<TagKind, string[]>) => store.setTags(id, tags))
  h('beats:allTags', () => store.allTags())
  h('beats:reanalyze', (_, id: number) => store.reanalyze(id))
  h('beats:reveal', (_, id: number) => { const p = store.pathOf(id); if (p) shell.showItemInFolder(p) })
  h('beats:openProject', async (_, id: number) => {
    const p = store.getBeat(id)?.projectPath
    if (p) await shell.openPath(p)
  })
  h('beats:linkProject', async (_, id: number) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Link FL Studio project', properties: ['openFile'], filters: [{ name: 'FL Studio project', extensions: ['flp'] }],
      defaultPath: store.getSettings().projectFolders[0]
    })
    if (!r.canceled && r.filePaths[0]) store.updateBeat(id, { projectPath: r.filePaths[0] })
  })
  h('settings:get', () => store.getSettings())
  h('settings:addFolder', async (_, kind: 'watchFolders' | 'projectFolders') => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return
    const s = store.getSettings()
    if (!s[kind].includes(r.filePaths[0])) s[kind].push(r.filePaths[0])
    store.saveSettings(s)
    await watcher.restart()
  })
  h('settings:removeFolder', async (_, kind: 'watchFolders' | 'projectFolders', path: string) => {
    const s = store.getSettings()
    s[kind] = s[kind].filter((f) => f !== path)
    store.saveSettings(s)
    await watcher.restart()
  })
  h('settings:set', async (_, patch: Partial<Settings>) => {
    store.saveSettings({ ...store.getSettings(), ...patch })
    await watcher.restart()
  })
  h('app:backup', backupNow)
  h('app:dataPath', () => app.getPath('userData'))
}

app.whenReady().then(async () => {
  protocol.handle('shqa', serveAudio)
  const db = openDb(app.getPath('userData'))
  const send = (ch: string, ...a: unknown[]) => win?.webContents.send(ch, ...a)
  store = new Store(db, (ids) => send('beats:changed', ids), (s) => send('scan:status', s))
  watcher = new Watcher(store)
  registerIpc()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [{ label: 'Back Up Database Now', click: () => backupNow() }, { role: 'close' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]))
  createWindow()
  watcher.restart()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { void watcher?.close() })
