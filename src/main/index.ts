import { app, BrowserWindow, dialog, shell, protocol, Menu, Notification } from 'electron'
import { writeFileSync, unlinkSync } from 'fs'
import { pathToFileURL } from 'url'
import { join } from 'path'
import { createReadStream, statSync, mkdirSync } from 'fs'
import { Readable } from 'stream'
import { applyPendingRestore, autoBackupTarget, openDb, stageRestore } from './db'
import { Store } from './store'
import { Watcher } from './watcher'
import { Crm } from './crm'
import { Leads } from './leads'
import { Packs } from './packs'
import { Catalog } from './catalog'
import { Sales } from './sales'
import { Content } from './content'
import { Sounds } from './sounds'
import { ProjectIndex } from './flpindex'
import { Feedback } from './feedback'
import { Sessions } from './sessions'
import { wavToMp3, loopToMp3 } from './bounce'
import { startInbox } from './inbox'
import { VideoExporter } from './video'
import { YtAuth } from './ytauth'
import { YtResearch } from './ytresearch'
import { ImagePool } from './imagepool'
import { YtPublisher } from './ytpublisher'
import { Threads } from './assistant/threads'
import { AssistantService } from './assistant/service'
import { buildTools } from './assistant/tools'
import type { IpcCtx } from './ipc/context'
import { registerLibraryIpc } from './ipc/library'
import { registerPluginsIpc } from './ipc/plugins'
import { registerFeedbackIpc } from './ipc/feedback'
import { registerContentIpc } from './ipc/content'
import { registerBusinessIpc } from './ipc/business'
import { registerAppIpc } from './ipc/app'
import { installFileLog } from './filelog'
import { isAppUrl, isExternalUrl } from './safe-path'


app.setName('Studio HQ')
app.setPath('userData', join(app.getPath('appData'), 'Studio HQ'))

// One copy at a time: two would both write the database and both watch the same folders.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

protocol.registerSchemesAsPrivileged([
  { scheme: 'shqa', privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true, corsEnabled: true } }
])

let win: BrowserWindow | null = null
const timers: ReturnType<typeof setInterval>[] = [] // background intervals, stopped when the app quits
let store: Store
let watcher: Watcher
let loopWatcher: Watcher
let crm: Crm
let leads: Leads
let packs: Packs
let catalog: Catalog
let sales: Sales
let content: Content
let sounds: Sounds
let projectIndex: ProjectIndex
let projectsAdded = 0
let feedback: Feedback
let sessions: Sessions
let videos: VideoExporter
let ytAuth: YtAuth
let yt: YtPublisher
let threads: Threads
let assistant: AssistantService

const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aif: 'audio/aiff', aiff: 'audio/aiff', ogg: 'audio/ogg' }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0d0e11', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  // The window only ever shows the app itself: popups are refused (web links go to the browser) and navigation away is blocked.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url, process.env['ELECTRON_RENDERER_URL'], pathToFileURL(join(__dirname, '../renderer/index.html')).href)) return
    e.preventDefault()
    if (isExternalUrl(url)) void shell.openExternal(url)
  })
  win.on('closed', () => (win = null))
}

let loopQueue: Promise<unknown> = Promise.resolve() // loops are handled one at a time so a newer one replaces the older cleanly

function serveAudio(req: Request): Response {
  const u = new URL(req.url)
  const id = Number(u.pathname.replace('/', ''))
  const path = u.hostname === 'sound' ? sounds.pathOf(id) : store.playPathOf(id)
  if (!path) return new Response('not found', { status: 404 })
  let size: number
  try { size = statSync(path).size } catch { return new Response('missing', { status: 404 }) }
  const ext = path.split('.').pop()!.toLowerCase()
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' } // the renderer (file:// or the dev server) fetches shqa:// cross-origin
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

/** Daily safety net: a consistent snapshot, the newest 5 kept. */
function autoBackup(): void {
  const dest = autoBackupTarget(join(app.getPath('userData'), 'backups'), new Date())
  if (dest) store.db.backup(dest).catch((e) => console.error('auto backup failed', e))
}

async function restoreFromBackup(): Promise<void> {
  const r = await dialog.showOpenDialog({ title: 'Restore a backup', defaultPath: join(app.getPath('userData'), 'backups'), properties: ['openFile'], filters: [{ name: 'Studio HQ backup', extensions: ['db'] }] })
  if (r.canceled || !r.filePaths[0]) return
  const ok = await dialog.showMessageBox({ type: 'warning', buttons: ['Restore and Restart', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Replace your library with this backup?', detail: 'Studio HQ restarts to do this. Your current library is saved to the backups folder first. Your audio files are not touched.' })
  if (ok.response !== 0) return
  try { stageRestore(app.getPath('userData'), r.filePaths[0]) } catch (e) { dialog.showErrorBox('Restore failed', (e as Error).message); return }
  app.relaunch()
  app.quit()
}

/** Lets the FL Studio plugin default to the folder this app watches for beats. */
function writeBridgeConfig(): void {
  try {
    const vault = store.getSettings().watchFolders[0]
    writeFileSync(join(app.getPath('userData'), 'bridge.json'), JSON.stringify({ vaultFolder: vault ?? '', projectFolders: store.getSettings().projectFolders, inbox: join(app.getPath('userData'), 'inbox'), updatedAt: Date.now() }, null, 2))
  } catch { /* the plugin falls back to ~/Desktop/! BEATS */ }
}

function restartWatchers(): Promise<unknown> { return Promise.all([watcher.restart(), loopWatcher.restart()]) }
function sendCrm(): void { win?.webContents.send('crm:changed') }
/** Re-reads your FL project folders: new projects appear in the Vault as beats. Fast, so it runs on focus and on a timer. */
async function reindexProjects(): Promise<{ added: number; total: number }> {
  projectsAdded = 0
  const changed = await projectIndex.index()
  if (changed) { await sounds.scan(); projectIndex.linkMidi() }
  const total = (store.db.prepare(`SELECT COUNT(*) c FROM beats WHERE ext='flp' AND missing=0`).get() as { c: number }).c
  const added = projectsAdded
  if (added) store.bumpAll()
  return { added, total }
}

/** Library scan, then read each FL project's samples and MIDI, then pick up the MIDI files it wrote. */
async function scanLibrary(): Promise<void> {
  await sounds.scan()
  const changed = await projectIndex.index()
  if (changed) await sounds.scan()
  projectIndex.linkMidi()
  win?.webContents.send('sounds:changed')
}
function sendFeedback(): void { win?.webContents.send('feedback:changed') }

async function syncFeedback(quiet: boolean): Promise<{ added: number; error: string | null }> {
  const r = await feedback.sync()
  if (r.added) {
    sendFeedback()
    if (quiet && store.getSettings().notify && Notification.isSupported()) {
      const n = new Notification({ title: `${r.added} new feedback comment${r.added > 1 ? 's' : ''}`, body: 'Open Feedback to see them pinned to the beat.' })
      n.on('click', () => { win?.show(); win?.focus(); win?.webContents.send('nav', 'feedback') })
      n.show()
    }
  }
  return r
}

function checkFollowups(): void {
  sendCrm()
  const s = store.getSettings()
  const due = crm.due()
  if (!due.length || !s.notify || !Notification.isSupported()) return
  const today = new Date().toDateString()
  const last = (store.db.prepare(`SELECT value FROM settings WHERE key='last_notified'`).get() as { value: string } | undefined)?.value
  if (last === today) return
  store.db.prepare(`INSERT INTO settings(key,value) VALUES('last_notified',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(today)
  const names = [...new Set(due.map((d) => d.contact))]
  const n = new Notification({
    title: `${due.length} follow-up${due.length > 1 ? 's' : ''} due`,
    body: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '')
  })
  n.on('click', () => { win?.show(); win?.focus(); win?.webContents.send('nav', 'crm') })
  n.show()
}

function registerIpc(): void {
  const ctx: IpcCtx = {
    get store() { return store },
    get watcher() { return watcher },
    get loopWatcher() { return loopWatcher },
    get crm() { return crm },
    get leads() { return leads },
    get packs() { return packs },
    get catalog() { return catalog },
    get sales() { return sales },
    get content() { return content },
    get sounds() { return sounds },
    get projectIndex() { return projectIndex },
    get feedback() { return feedback },
    get sessions() { return sessions },
    get videos() { return videos },
    get ytAuth() { return ytAuth },
    get yt() { return yt },
    get threads() { return threads },
    get assistant() { return assistant },
    get win() { return win },
    restartWatchers, sendCrm, reindexProjects, scanLibrary, sendFeedback, syncFeedback, backupNow, writeBridgeConfig
  }
  registerLibraryIpc(ctx)
  registerPluginsIpc(ctx)
  registerFeedbackIpc(ctx)
  registerContentIpc(ctx)
  registerBusinessIpc(ctx)
  registerAppIpc(ctx)
}

app.whenReady().then(async () => {
  installFileLog(join(app.getPath('userData'), 'logs'))
  protocol.handle('shqa', serveAudio)
  try { if (applyPendingRestore(app.getPath('userData'))) console.log('library restored from backup') } catch (e) { console.error('restore failed', e) }
  const db = openDb(app.getPath('userData'))
  const send = (ch: string, ...a: unknown[]) => win?.webContents.send(ch, ...a)
  store = new Store(db, (ids) => send('beats:changed', ids), (s) => send('scan:status', s))
  watcher = new Watcher(store)
  loopWatcher = new Watcher(store, 'loop')
  crm = new Crm(db, () => store.getSettings().followupDays, () => store.bumpAll())
  leads = new Leads(db, crm, () => [])
  sales = new Sales(db)
  content = new Content(db)
  const midiDir = join(app.getPath('userData'), 'FL project MIDI')
  sounds = new Sounds(db, () => [...store.getSettings().soundFolders, midiDir], () => ({ midiRoot: midiDir, packsMidi: store.getSettings().includeMidiPacks }), (st) => win?.webContents.send('sounds:status', st), () => win?.webContents.send('sounds:changed'))
  projectIndex = new ProjectIndex(db, sounds, () => [...store.getSettings().projectFolders, ...store.getSettings().soundFolders], midiDir, () => win?.webContents.send('sounds:changed'), (files) => {
    // only your own project folders become beats (not templates or projects that ship inside sample packs)
    const own = store.getSettings().projectFolders
    const mine = files.filter((f) => own.some((r) => f.path.startsWith(r + '/')) && !/\/Templates\//i.test(f.path))
    projectsAdded += store.syncProjectBeats(mine, store.getSettings().projectBeatDays)
  })
  feedback = new Feedback(db, () => packs.token_(), () => packs.siteId())
  sessions = new Sessions(db)
  videos = new VideoExporter(db, () => store.getSettings().exportDir)
  packs = new Packs(db, () => store.getSettings().producerName)
  ytAuth = new YtAuth(db, () => store.getSettings().ytClientId)
  yt = new YtPublisher(db, store, content, ytAuth, new YtResearch(db, ytAuth, () => store.getSettings().ytSeedChannels), new ImagePool(db, () => store.getSettings().ytImageFolder))
  catalog = new Catalog(db, () => packs.token_(), () => store.getSettings().storeUrl, () => store.getSettings().ownHandles)
  registerIpc()
  threads = new Threads(db)
  const tools = buildTools({
    store, crm, sales, content, feedback, yt,
    afterWrite: () => { send('beats:changed', [-1]); sendCrm() }
  })
  assistant = new AssistantService({
    threads, tools,
    claudePath: () => store.getSettings().claudePath,
    producerName: () => store.getSettings().producerName,
    userDataDir: app.getPath('userData'),
    push: (p) => win?.webContents.send('assistant:push', p)
  })
  try { await assistant.start() } catch (e) { console.error('assistant failed to start', e) }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [{ label: 'Back Up Database Now', click: () => backupNow() }, { label: 'Restore From Backup…', click: () => { void restoreFromBackup() } }, { role: 'close' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]))
  createWindow()
  writeBridgeConfig()
  startInbox(join(app.getPath('userData'), 'inbox'), (d) => {
    if (d.kind === 'bounce' && d.wav) { wavToMp3(d.wav, join(app.getPath('userData'), 'WAV masters')).then((mp3) => { if (!mp3) console.error('bounce conversion failed', d.wav); else win?.webContents.send('beats:changed', [-1]) }); return }
    if (d.kind === 'loop' && d.wav) {
      const wav = d.wav
      loopQueue = loopQueue.then(async () => {
        const t = store.previewTarget(d.flp)
        if (!t) { try { unlinkSync(wav) } catch { /* gone */ } return }
        const out = join(app.getPath('userData'), 'previews', `${t.id}-${Date.now()}.mp3`)
        if (!(await loopToMp3(wav, out))) return
        store.setPreview(t.id, out)
        if (t.old) { try { unlinkSync(t.old) } catch { /* gone */ } }
        win?.webContents.send('beats:changed', [t.id])
      }).catch((e) => console.error('loop failed', e))
      return
    }
    store.saveFromPlugin(d); win?.webContents.send('beats:changed', [-1])
  })
  watcher.restart()
  loopWatcher.restart()
  setTimeout(() => { scanLibrary().catch((e) => console.error('library scan failed', e)) }, 3000)
  setTimeout(autoBackup, 60000)
  timers.push(setInterval(autoBackup, 6 * 60 * 60 * 1000))
  timers.push(setInterval(() => { reindexProjects().catch((e) => console.error('reindex failed', e)) }, 3 * 60 * 1000))
  setTimeout(() => { if (feedback.hasPublished()) syncFeedback(true) }, 9000)
  timers.push(setInterval(() => { if (feedback.hasPublished()) syncFeedback(true) }, 5 * 60 * 1000))
  timers.push(setInterval(async () => { if (store.getSettings().autoTrackFL && (await sessions.autoTrack())) sendFeedback() }, 20000))
  setTimeout(checkFollowups, 6000)
  timers.push(setInterval(checkFollowups, 30 * 60 * 1000))
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})

app.on('window-all-closed', () => app.quit())
// Fold the write-ahead log into the main file, so studio-hq.db alone is the whole library after quitting.
app.on('will-quit', () => { try { store?.db.pragma('wal_checkpoint(TRUNCATE)') } catch (e) { console.error('checkpoint failed', e) } })
let quitting = false
app.on('before-quit', (e) => {
  timers.forEach(clearInterval)
  void watcher?.close()
  void loopWatcher?.close()
  if (quitting || !assistant) return
  // Let the assistant stop its CLI run and MCP server, then quit again.
  e.preventDefault()
  quitting = true
  const bounded = Promise.race([assistant.shutdown(), new Promise<void>((r) => setTimeout(r, 3000))])
  bounded.catch((err) => console.error('assistant shutdown failed', err)).finally(() => app.quit())
})
