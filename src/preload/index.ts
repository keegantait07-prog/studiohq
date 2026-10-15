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
  contentAll: () => ipcRenderer.invoke('content:all'),
  savePost: (p) => ipcRenderer.invoke('content:savePost', p),
  deletePost: (id) => ipcRenderer.invoke('content:deletePost', id),
  exportVideo: (o) => ipcRenderer.invoke('content:export', o),
  previewVideo: (o) => ipcRenderer.invoke('content:preview', o),
  cancelVideo: () => ipcRenderer.invoke('content:cancel'),
  coverData: (id) => ipcRenderer.invoke('content:coverData', id),
  chooseCover: (id) => ipcRenderer.invoke('content:chooseCover', id),
  clearCover: (id) => ipcRenderer.invoke('content:clearCover', id),
  revealPath: (p) => ipcRenderer.invoke('app:revealPath', p),
  chooseExportDir: () => ipcRenderer.invoke('settings:chooseExportDir'),
  onVideoProgress: (cb) => sub('video:progress', cb),
  salesAll: () => ipcRenderer.invoke('sales:all'),
  logSale: (i) => ipcRenderer.invoke('sales:log', i),
  updateSale: (id, p) => ipcRenderer.invoke('sales:update', id, p),
  deleteSale: (id) => ipcRenderer.invoke('sales:delete', id),
  saveLicense: (l) => ipcRenderer.invoke('sales:saveLicense', l),
  deleteLicense: (id) => ipcRenderer.invoke('sales:deleteLicense', id),
  getSplits: async (g) => (await ipcRenderer.invoke('splits:get', g)),
  saveSplits: (g, r) => ipcRenderer.invoke('splits:save', g, r),
  exportSplitSheet: (g) => ipcRenderer.invoke('splits:pdf', g),
  exportSalesCsv: () => ipcRenderer.invoke('sales:csv'),
  crmAll: () => ipcRenderer.invoke('crm:all'),
  saveContact: (c) => ipcRenderer.invoke('crm:saveContact', c),
  deleteContact: (id) => ipcRenderer.invoke('crm:deleteContact', id),
  logPitch: (i) => ipcRenderer.invoke('crm:logPitch', i),
  updatePitch: (id, p) => ipcRenderer.invoke('crm:updatePitch', id, p),
  logFollowup: (id) => ipcRenderer.invoke('crm:logFollowup', id),
  setPitchBeatResponse: (p, b, r) => ipcRenderer.invoke('crm:setBeatResponse', p, b, r),
  deletePitch: (id) => ipcRenderer.invoke('crm:deletePitch', id),
  saveTemplate: (t) => ipcRenderer.invoke('crm:saveTemplate', t),
  deleteTemplate: (id) => ipcRenderer.invoke('crm:deleteTemplate', id),
  buildPack: (r) => ipcRenderer.invoke('packs:build', r),
  openPackLocal: (id) => ipcRenderer.invoke('packs:openLocal', id),
  netlifyStatus: () => ipcRenderer.invoke('netlify:status'),
  setNetlifyToken: (t) => ipcRenderer.invoke('netlify:setToken', t),
  openExternal: (u) => ipcRenderer.invoke('app:openExternal', u),
  onCrmChanged: (cb) => sub('crm:changed', () => cb()),
  onNavigate: (cb) => sub('nav', cb),
  onBeatsChanged: (cb) => sub('beats:changed', cb),
  onScanStatus: (cb) => sub('scan:status', cb)
}
contextBridge.exposeInMainWorld('api', api)
