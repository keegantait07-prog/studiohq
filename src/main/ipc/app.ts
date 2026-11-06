import { ipcMain } from 'electron'
import { app, dialog, shell } from 'electron'
import { writeExports } from '../exporter'
import type { SitePatch } from '../../shared/types'
import type { PackRequest } from '../../shared/types'
import type { IpcCtx } from './context'

export function registerAppIpc(c: IpcCtx): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('packs:build', async (_, req: PackRequest) => c.packs.build(req))
  h('packs:openLocal', (_, id: number) => { const p = c.packs.localIndex(id); if (p) return shell.openPath(p) })
  h('netlify:status', () => c.packs.status())
  // ---- public beat site ----
  const step = (s: string) => c.win?.webContents.send('site:progress', s)
  h('site:status', () => c.catalog.status())
  h('site:add', (_, id: number) => c.catalog.add(id, step))
  h('site:update', (_, id: number, p: SitePatch) => c.catalog.update(id, p))
  h('site:remove', (_, id: number) => c.catalog.remove(id, step))
  h('site:publish', () => c.catalog.publish(step))
  h('netlify:setToken', (_, t: string | null) => c.packs.setToken(t))
  h('app:openExternal', (_, url: string) => { if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url) })
  h('app:backup', c.backupNow)
  h('app:export', async () => {
    const r = await dialog.showOpenDialog(c.win!, { title: 'Export to folder', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Export here' })
    if (r.canceled || !r.filePaths[0]) return null
    const files = writeExports(r.filePaths[0], c.store.listBeats(), c.sales.all().sales)
    shell.showItemInFolder(files[0])
    return r.filePaths[0]
  })
  h('app:dataPath', () => app.getPath('userData'))

  // ---- Assistant ----
  h('assistant:threads', () => c.threads.list())
  h('assistant:thread', (_, id: number) => c.threads.get(id))
  h('assistant:new', () => c.threads.create())
  h('assistant:send', (_, id: number, text: string) => c.assistant.send(id, String(text)))
  h('assistant:stop', (_, id: number) => c.assistant.stop(id))
  h('assistant:approve', (_, approvalId: string, approved: boolean) => c.assistant.approve(String(approvalId), approved === true))
}
