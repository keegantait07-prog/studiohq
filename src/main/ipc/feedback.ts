import { ipcMain } from 'electron'
import { Content } from '../content'
import type { IpcCtx } from './context'

export function registerFeedbackIpc(c: IpcCtx): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('feedback:all', () => c.feedback.all())
  h('feedback:build', async (_, r: { title: string; intro: string; beatIds: number[] }) => { const res = await c.packs.build({ contactId: null, title: r.title, intro: r.intro, beatIds: r.beatIds, deploy: !!c.packs.token_() }, { kind: 'feedback' }); c.sendFeedback(); return res })
  h('feedback:sync', async () => c.syncFeedback(false))
  h('feedback:update', (_, id: string, p: { seen?: boolean; resolved?: boolean }) => { c.feedback.update(id, p); c.sendFeedback() })
  h('feedback:seenAll', () => { c.feedback.markAllSeen(); c.sendFeedback() })

  // ---- Studio sessions ----
  h('sessions:all', () => c.sessions.all())
  h('sessions:start', () => { c.sessions.start(false); c.sendFeedback() })
  h('sessions:stop', () => { c.sessions.stop(); c.sendFeedback() })

  // ---- Content Machine ----
}
