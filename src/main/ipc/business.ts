import { ipcMain } from 'electron'
import { app, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { splitSheetHtml, writePdf } from '../splitsheet'
import type { LogSaleInput, License, Sale, SplitRow } from '../../shared/types'
import type { LogPitchInput, Template, Contact, PitchStatus } from '../../shared/types'
import type { Lead, LeadSource, LeadStatus } from '../../shared/leads'
import { lookupContact } from '../leads/contact-lookup'
import { importCandidates } from '../leads/import'
import { assertContactNotSuppressed, assertPitchNotSuppressed } from '../leads'
import type { IpcCtx } from './context'

export function registerBusinessIpc(c: IpcCtx): void {
  const h = ipcMain.handle.bind(ipcMain)
  const sale = <A extends unknown[], R>(fn: (...a: A) => R) => (_: unknown, ...a: A): R => { const r = fn(...a); c.store.bumpAll(); c.sendCrm(); return r }
  h('sales:all', () => c.sales.all())
  h('sales:log', sale((i: LogSaleInput) => c.sales.log(i)))
  h('sales:update', sale((id: number, p: Partial<Sale>) => c.sales.update(id, p)))
  h('sales:delete', sale((id: number) => c.sales.delete(id)))
  h('sales:saveLicense', (_, l: Partial<License> & { name: string; exclusive: boolean }) => c.sales.saveLicense(l))
  h('sales:deleteLicense', (_, id: number) => c.sales.deleteLicense(id))
  h('splits:get', (_, groupId: number) => ({ rows: c.sales.getSplits(groupId), known: c.sales.knownCollaborators() }))
  h('splits:save', (_, groupId: number, rows: SplitRow[]) => c.sales.saveSplits(groupId, rows))
  h('splits:pdf', async (_, groupId: number) => {
    const rows = c.sales.getSplits(groupId)
    const g = c.sales.all().groups.find((x) => x.groupId === groupId)
    if (!g) throw new Error('Beat not found.')
    if (rows.length < 2) throw new Error('Add at least two people to create a split sheet.')
    if (Math.abs(rows.reduce((a, r) => a + r.pubPct, 0) - 100) > 0.01 || Math.abs(rows.reduce((a, r) => a + r.masterPct, 0) - 100) > 0.01) throw new Error('Publishing and master splits must each total 100% before you can create the sheet.')
    const beat = c.store.getBeat(g.beatId)
    const safe = g.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Beat'
    let path = process.env.SHQ_TEST_SAVE_PATH ?? ''
    if (!path) {
      const r = await dialog.showSaveDialog(c.win!, { title: 'Save split sheet', defaultPath: join(app.getPath('documents'), `Split Sheet - ${safe}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      if (r.canceled || !r.filePath) return null
      path = r.filePath
    }
    await writePdf(splitSheetHtml({ title: g.title, bpm: beat?.bpm ?? null, key: beat?.key ?? null, producer: c.store.getSettings().producerName, rows, date: new Date() }), path)
    c.sales.markSheet(groupId)
    c.sendCrm()
    if (!process.env.SHQ_TEST_SAVE_PATH) shell.showItemInFolder(path)
    return path
  })
  h('sales:csv', async () => {
    let path = process.env.SHQ_TEST_SAVE_PATH ?? ''
    if (!path) {
      const r = await dialog.showSaveDialog(c.win!, { title: 'Export sales', defaultPath: join(app.getPath('documents'), 'Studio HQ sales.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] })
      if (r.canceled || !r.filePath) return null
      path = r.filePath
    }
    writeFileSync(path, c.sales.csv())
    return path
  })

  // ---- Pitch CRM ----
  const mut = <A extends unknown[], R>(fn: (...a: A) => R) => (_: unknown, ...a: A): R => { const r = fn(...a); c.sendCrm(); return r }
  h('crm:all', () => c.crm.all())
  h('crm:saveContact', mut((contact: Partial<Contact> & { name: string }) => c.crm.saveContact(contact)))
  h('crm:deleteContact', mut((id: number) => c.crm.deleteContact(id)))
  h('crm:logPitch', mut((i: LogPitchInput) => {
    assertContactNotSuppressed(c.leads, c.crm, i.contactId)
    return c.crm.logPitch(i)
  }))
  h('crm:updatePitch', mut((id: number, p: { status?: PitchStatus; responseNote?: string; snoozeDays?: number }) => c.crm.updatePitch(id, p)))
  h('crm:logFollowup', mut((id: number) => { assertPitchNotSuppressed(c.leads, c.crm, id); c.crm.logFollowup(id) }))
  h('crm:setBeatResponse', mut((pid: number, bid: number, r: '' | 'liked' | 'passed') => c.crm.setPitchBeatResponse(pid, bid, r)))
  h('crm:deletePitch', mut((id: number) => c.crm.deletePitch(id)))
  h('crm:saveTemplate', mut((t: Template) => c.crm.saveTemplate(t)))
  h('crm:deleteTemplate', mut((id: number) => c.crm.deleteTemplate(id)))

  h('leads:list', (_, f?: { source?: LeadSource; minScore?: number; hasEmail?: boolean; status?: LeadStatus }): Lead[] => c.leads.list(f))
  h('leads:import', mut((text: string, kind: 'handles' | 'csv') => c.leads.addCandidates(importCandidates(text, kind))))
  h('leads:promote', mut((id: number) => c.leads.promote(id)))
  h('leads:skip', mut((ids: number[]) => { for (const id of ids) c.leads.setStatus(id, 'skipped') }))
  h('leads:save', mut((ids: number[]) => { for (const id of ids) c.leads.setStatus(id, 'saved') }))
  h('leads:suppress', mut((email: string, reason: string) => c.leads.suppress(email, reason)))
  let lookingUp = false
  h('leads:lookupContact', mut(async (id: number): Promise<{ found: true; email: string; sourceUrl: string } | { found: false; reason: string }> => {
    if (lookingUp) return { found: false, reason: 'Another lookup is running. Try again in a moment.' }
    lookingUp = true
    try {
      const lead = c.leads.get(id)
      if (!lead?.url) return { found: false, reason: 'Add a profile or website link first.' }
      const hit = await lookupContact(lead.url, { fetchFn: fetch })
      if (!hit) return { found: false, reason: 'No public email found.' }
      c.leads.setEmail(id, hit.email, hit.sourceUrl)
      return { found: true, ...hit }
    } finally {
      lookingUp = false
    }
  }))
  h('leads:isSuppressed', (_, email: string): boolean => c.leads.isSuppressed(email))
}
