import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/types'

const sub = <T>(ch: string, cb: (v: T) => void) => {
  const fn = (_: unknown, v: T) => cb(v)
  ipcRenderer.on(ch, fn)
  return () => ipcRenderer.removeListener(ch, fn)
}

const api: Api = {
  listBeats: () => ipcRenderer.invoke('beats:list'),
  getBeat: (id) => ipcRenderer.invoke('beats:get', id),
  updateBeat: (id, p) => ipcRenderer.invoke('beats:update', id, p),
  setTags: (id, t) => ipcRenderer.invoke('beats:setTags', id, t),
  allTags: () => ipcRenderer.invoke('beats:allTags'),
  reanalyze: (id) => ipcRenderer.invoke('beats:reanalyze', id),
  reveal: (id) => ipcRenderer.invoke('beats:reveal', id),
  openProject: (id) => ipcRenderer.invoke('beats:openProject', id),
  linkProject: (id) => ipcRenderer.invoke('beats:linkProject', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  addFolder: (k) => ipcRenderer.invoke('settings:addFolder', k),
  removeFolder: (k, p) => ipcRenderer.invoke('settings:removeFolder', k, p),
  setSetting: (p) => ipcRenderer.invoke('settings:set', p),
  backup: () => ipcRenderer.invoke('app:backup'),
  dataPath: () => ipcRenderer.invoke('app:dataPath'),
  onBeatsChanged: (cb) => sub('beats:changed', cb),
  onScanStatus: (cb) => sub('scan:status', cb)
}
contextBridge.exposeInMainWorld('api', api)
