import { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, Notification, nativeImage } from 'electron'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createReadStream, statSync, mkdirSync } from 'fs'
import { Readable } from 'stream'
import { openDb } from './db'
import { Store } from './store'
import { Watcher } from './watcher'
import { Crm } from './crm'
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
import { writeExports } from './exporter'
import { cleanupList, trashProjects } from './cleanup'
import { VideoExporter, coverData, pickCover, vizFeatures } from './video'
import type { Post, VideoOptions } from '../shared/types'
import { splitSheetHtml, writePdf } from './splitsheet'
import type { LogSaleInput, License, Sale, SplitRow } from '../shared/types'
import type { SitePatch } from '../shared/types'
import type { BeatPatch, Settings, TagKind, LogPitchInput, PackRequest, Template, Contact, PitchStatus } from '../shared/types'

app.setName('Studio HQ')
app.setPath('userData', join(app.getPath('appData'), 'Studio HQ'))

protocol.registerSchemesAsPrivileged([
  { scheme: 'shqa', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, standard: true, secure: true, corsEnabled: true } }
])

let win: BrowserWindow | null = null
let store: Store
let watcher: Watcher
let crm: Crm
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

let loopQueue: Promise<unknown> = Promise.resolve() // loops are handled one at a time so a newer one replaces the older cleanly

function serveAudio(req: Request): Response {
  const u = new URL(req.url)
  const id = Number(u.pathname.replace('/', ''))
  const path = u.hostname === 'sound' ? sounds.pathOf(id) : store.playPathOf(id)
  if (!path) return new Response('not found', { status: 404 })
  let size: number
  try { size = statSync(path).size } catch { return new Response('missing', { status: 404 }) }
  const ext = path.split('.').pop()!.toLowerCase()
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
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

/** Lets the FL Studio plugin default to the folder this app watches for beats. */
function writeBridgeConfig(): void {
  try {
    const vault = store.getSettings().watchFolders[0]
    writeFileSync(join(app.getPath('userData'), 'bridge.json'), JSON.stringify({ vaultFolder: vault ?? '', projectFolders: store.getSettings().projectFolders, inbox: join(app.getPath('userData'), 'inbox'), updatedAt: Date.now() }, null, 2))
  } catch { /* the plugin falls back to ~/Desktop/! BEATS */ }
}

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
  h('settings:addFolder', async (_, kind: 'watchFolders' | 'projectFolders' | 'soundFolders') => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return
    const s = store.getSettings()
    if (!s[kind].includes(r.filePaths[0])) s[kind].push(r.filePaths[0])
    store.saveSettings(s)
    writeBridgeConfig()
    await watcher.restart()
  })
  h('settings:removeFolder', async (_, kind: 'watchFolders' | 'projectFolders' | 'soundFolders', path: string) => {
    const s = store.getSettings()
    s[kind] = s[kind].filter((f) => f !== path)
    store.saveSettings(s)
    writeBridgeConfig()
    await watcher.restart()
  })
  h('settings:set', async (_, patch: Partial<Settings>) => {
    store.saveSettings({ ...store.getSettings(), ...patch })
    if ('includeIdeas' in patch || 'ownHandles' in patch) await watcher.restart()
    else sendCrm()
  })

  // ---- Sound Library ----
  h('sounds:list', () => sounds.list(projectIndex.list()))
  h('sounds:scan', () => scanLibrary())
  h('projects:reindex', () => reindexProjects())
  h('cleanup:list', () => cleanupList(store.db, store.getSettings().projectFolders))
  h('cleanup:trash', async (_, ids: number[], withBackups: boolean) => {
    const r = await trashProjects(store.db, store.getSettings().projectFolders, (path) => (store.db.prepare('SELECT m.path FROM flp_midis m JOIN flp_projects p ON p.id=m.project_id WHERE p.path=?').all(path) as { path: string }[]).map((m) => m.path), ids.filter((n) => Number.isInteger(n)), !!withBackups)
    store.bumpAll()
    win?.webContents.send('sounds:changed')
    return r
  })
  h('projects:open', (_, id: number) => { const p = (store.db.prepare('SELECT path FROM flp_projects WHERE id=?').get(id) as { path: string } | undefined)?.path; if (p) return shell.openPath(p) })
  h('projects:reveal', (_, id: number) => { const p = (store.db.prepare('SELECT path FROM flp_projects WHERE id=?').get(id) as { path: string } | undefined)?.path; if (p) shell.showItemInFolder(p) })
  h('sounds:tag', (_, ids: number[], add: string[], remove: string[]) => sounds.tag(ids, add, remove))
  h('sounds:fav', (_, ids: number[], fav: boolean) => sounds.fav(ids, fav))
  h('sounds:dupes', () => sounds.duplicates())
  h('sounds:trash', (_, ids: number[]) => sounds.trash(ids))
  h('sounds:reveal', (_, id: number) => { const p = sounds.pathOf(id); if (p) shell.showItemInFolder(p) })
  ipcMain.on('app:startDrag', (e, kind: 'sound' | 'beat', ids: number[]) => {
    const files = ids.slice(0, 60).map((id) => (kind === 'sound' ? sounds.pathOf(id) : store.pathOf(id))).filter((p): p is string => !!p)
    if (!files.length) return
    const px = Buffer.alloc(32 * 32 * 4)
    for (let i = 0; i < 32 * 32; i++) { px[i * 4] = 0x3d; px[i * 4 + 1] = 0x6b; px[i * 4 + 2] = 0xff; px[i * 4 + 3] = 0xff } // BGRA accent square
    e.sender.startDrag({ file: files[0], files, icon: nativeImage.createFromBitmap(px, { width: 32, height: 32 }) })
  })

  // ---- Feedback links ----
  h('feedback:all', () => feedback.all())
  h('feedback:build', async (_, r: { title: string; intro: string; beatIds: number[] }) => { const res = await packs.build({ contactId: null, title: r.title, intro: r.intro, beatIds: r.beatIds, deploy: !!packs.token_() }, { kind: 'feedback' }); sendFeedback(); return res })
  h('feedback:sync', async () => syncFeedback(false))
  h('feedback:update', (_, id: string, p: { seen?: boolean; resolved?: boolean }) => { feedback.update(id, p); sendFeedback() })
  h('feedback:seenAll', () => { feedback.markAllSeen(); sendFeedback() })

  // ---- Studio sessions ----
  h('sessions:all', () => sessions.all())
  h('sessions:start', () => { sessions.start(false); sendFeedback() })
  h('sessions:stop', () => { sessions.stop(); sendFeedback() })

  // ---- Content Machine ----
  h('content:all', () => content.all())
  h('content:savePost', (_, p: Post) => content.savePost(p))
  h('content:deletePost', (_, id: number) => content.deletePost(id))
  h('content:export', (_, o: VideoOptions) => videos.run(o, (p) => win?.webContents.send('video:progress', p)))
  h('content:cancel', () => videos.cancel())
  h('content:saveCover', (_, id: number, png: string) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(png)
    if (!m) return false
    const dir = join(app.getPath('userData'), 'covers')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}-${Date.now()}.png`)
    writeFileSync(file, Buffer.from(m[1], 'base64'))
    store.db.prepare('UPDATE beats SET cover_path=? WHERE id=?').run(file, id)
    store.bumpAll()
    return true
  })
  h('content:coverData', (_, id: number) => coverData(store.db, id))
  h('content:vizFeatures', (_, id: number, start: number, length: number) => vizFeatures(store.db, id, start, length))
  h('content:chooseCover', async (_, id: number) => { const ok = await pickCover(store.db, win!, id); if (ok) store.bumpAll(); return ok })
  h('content:clearCover', (_, id: number) => { store.db.prepare('UPDATE beats SET cover_path=NULL WHERE id=?').run(id); store.bumpAll() })
  h('app:revealPath', (_, p: string) => shell.showItemInFolder(p))
  h('settings:chooseExportDir', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Where should videos be saved?', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return
    store.saveSettings({ ...store.getSettings(), exportDir: r.filePaths[0] })
    sendCrm()
  })

  // ---- Sales & Collabs ----
  const sale = <A extends unknown[], R>(fn: (...a: A) => R) => (_: unknown, ...a: A): R => { const r = fn(...a); store.bumpAll(); sendCrm(); return r }
  h('sales:all', () => sales.all())
  h('sales:log', sale((i: LogSaleInput) => sales.log(i)))
  h('sales:update', sale((id: number, p: Partial<Sale>) => sales.update(id, p)))
  h('sales:delete', sale((id: number) => sales.delete(id)))
  h('sales:saveLicense', (_, l: Partial<License> & { name: string; exclusive: boolean }) => sales.saveLicense(l))
  h('sales:deleteLicense', (_, id: number) => sales.deleteLicense(id))
  h('splits:get', (_, groupId: number) => ({ rows: sales.getSplits(groupId), known: sales.knownCollaborators() }))
  h('splits:save', (_, groupId: number, rows: SplitRow[]) => sales.saveSplits(groupId, rows))
  h('splits:pdf', async (_, groupId: number) => {
    const rows = sales.getSplits(groupId)
    const g = sales.all().groups.find((x) => x.groupId === groupId)
    if (!g) throw new Error('Beat not found.')
    if (rows.length < 2) throw new Error('Add at least two people to create a split sheet.')
    if (Math.abs(rows.reduce((a, r) => a + r.pubPct, 0) - 100) > 0.01 || Math.abs(rows.reduce((a, r) => a + r.masterPct, 0) - 100) > 0.01) throw new Error('Publishing and master splits must each total 100% before you can create the sheet.')
    const beat = store.getBeat(g.beatId)
    const safe = g.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Beat'
    let path = process.env.SHQ_TEST_SAVE_PATH ?? ''
    if (!path) {
      const r = await dialog.showSaveDialog(win!, { title: 'Save split sheet', defaultPath: join(app.getPath('documents'), `Split Sheet - ${safe}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      if (r.canceled || !r.filePath) return null
      path = r.filePath
    }
    await writePdf(splitSheetHtml({ title: g.title, bpm: beat?.bpm ?? null, key: beat?.key ?? null, producer: store.getSettings().producerName, rows, date: new Date() }), path)
    sales.markSheet(groupId)
    sendCrm()
    if (!process.env.SHQ_TEST_SAVE_PATH) shell.showItemInFolder(path)
    return path
  })
  h('sales:csv', async () => {
    let path = process.env.SHQ_TEST_SAVE_PATH ?? ''
    if (!path) {
      const r = await dialog.showSaveDialog(win!, { title: 'Export sales', defaultPath: join(app.getPath('documents'), 'Studio HQ sales.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] })
      if (r.canceled || !r.filePath) return null
      path = r.filePath
    }
    writeFileSync(path, sales.csv())
    return path
  })

  // ---- Pitch CRM ----
  const mut = <A extends unknown[], R>(fn: (...a: A) => R) => (_: unknown, ...a: A): R => { const r = fn(...a); sendCrm(); return r }
  h('crm:all', () => crm.all())
  h('crm:saveContact', mut((c: Partial<Contact> & { name: string }) => crm.saveContact(c)))
  h('crm:deleteContact', mut((id: number) => crm.deleteContact(id)))
  h('crm:logPitch', mut((i: LogPitchInput) => crm.logPitch(i)))
  h('crm:updatePitch', mut((id: number, p: { status?: PitchStatus; responseNote?: string; snoozeDays?: number }) => crm.updatePitch(id, p)))
  h('crm:logFollowup', mut((id: number) => crm.logFollowup(id)))
  h('crm:setBeatResponse', mut((pid: number, bid: number, r: '' | 'liked' | 'passed') => crm.setPitchBeatResponse(pid, bid, r)))
  h('crm:deletePitch', mut((id: number) => crm.deletePitch(id)))
  h('crm:saveTemplate', mut((t: Template) => crm.saveTemplate(t)))
  h('crm:deleteTemplate', mut((id: number) => crm.deleteTemplate(id)))
  h('packs:build', async (_, req: PackRequest) => packs.build(req))
  h('packs:openLocal', (_, id: number) => { const p = packs.localIndex(id); if (p) return shell.openPath(p) })
  h('netlify:status', () => packs.status())
  // ---- public beat site ----
  const step = (s: string) => win?.webContents.send('site:progress', s)
  h('site:status', () => catalog.status())
  h('site:add', (_, id: number) => catalog.add(id, step))
  h('site:update', (_, id: number, p: SitePatch) => catalog.update(id, p))
  h('site:remove', (_, id: number) => catalog.remove(id, step))
  h('site:publish', () => catalog.publish(step))
  h('netlify:setToken', (_, t: string | null) => packs.setToken(t))
  h('app:openExternal', (_, url: string) => { if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url) })
  h('app:backup', backupNow)
  h('app:export', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Export to folder', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Export here' })
    if (r.canceled || !r.filePaths[0]) return null
    const files = writeExports(r.filePaths[0], store.listBeats(), sales.all().sales)
    shell.showItemInFolder(files[0])
    return r.filePaths[0]
  })
  h('app:dataPath', () => app.getPath('userData'))
}

app.whenReady().then(async () => {
  protocol.handle('shqa', serveAudio)
  const db = openDb(app.getPath('userData'))
  const send = (ch: string, ...a: unknown[]) => win?.webContents.send(ch, ...a)
  store = new Store(db, (ids) => send('beats:changed', ids), (s) => send('scan:status', s))
  watcher = new Watcher(store)
  crm = new Crm(db, () => store.getSettings().followupDays, () => store.bumpAll())
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
  catalog = new Catalog(db, () => packs.token_(), () => store.getSettings().storeUrl, () => store.getSettings().ownHandles)
  registerIpc()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [{ label: 'Back Up Database Now', click: () => backupNow() }, { role: 'close' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]))
  createWindow()
  writeBridgeConfig()
  startInbox(join(app.getPath('userData'), 'inbox'), (d) => {
    if (d.kind === 'bounce' && d.wav) { wavToMp3(d.wav).then((mp3) => { if (!mp3) console.error('bounce conversion failed', d.wav); else win?.webContents.send('beats:changed', [-1]) }); return }
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
  setTimeout(() => { scanLibrary().catch((e) => console.error('library scan failed', e)) }, 3000)
  setInterval(() => { reindexProjects().catch((e) => console.error('reindex failed', e)) }, 3 * 60 * 1000)
  setTimeout(() => { if (feedback.hasPublished()) syncFeedback(true) }, 9000)
  setInterval(() => { if (feedback.hasPublished()) syncFeedback(true) }, 5 * 60 * 1000)
  setInterval(async () => { if (store.getSettings().autoTrackFL && (await sessions.autoTrack())) sendFeedback() }, 20000)
  setTimeout(checkFollowups, 6000)
  setInterval(checkFollowups, 30 * 60 * 1000)
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { void watcher?.close() })
