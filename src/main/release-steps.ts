// The release checklist, one function per step. Plain data in, a state and a one-line summary out: no database, no Electron.
import { PLATFORMS, type PitchStatus, type Platform, type Release, type ReleaseStep } from '../shared/types'

export const money = (n: number): string => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const distinct = <T>(xs: T[]): T[] => [...new Set(xs)]
const near100 = (n: number) => Math.abs(n - 100) <= 0.01

export function storeStep(r: { onSite: boolean; dirty: boolean; missing: boolean; soldExclusively: boolean; from: number | null }): ReleaseStep {
  if (r.soldExclusively) return { id: 'store', state: 'na', summary: 'Sold exclusively' }
  if (!r.onSite) return { id: 'store', state: 'todo', summary: 'Not on the store' }
  if (r.missing) return { id: 'store', state: 'doing', summary: 'File missing' }
  if (r.dirty) return { id: 'store', state: 'doing', summary: 'Changes not published' }
  return { id: 'store', state: 'done', summary: r.from == null ? 'Live' : `Live · from ${money(r.from)}` }
}

export function videoStep(formats: string[]): ReleaseStep {
  if (!formats.length) return { id: 'video', state: 'todo', summary: 'No video yet' }
  return { id: 'video', state: 'done', summary: `${plural(formats.length, 'video')} · ${distinct(formats).join(', ')}` }
}

export function postStep(posts: { status: 'planned' | 'private' | 'posted'; platform: Platform }[]): ReleaseStep {
  if (!posts.length) return { id: 'post', state: 'todo', summary: 'Nothing planned' }
  const posted = posts.filter((p) => p.status === 'posted')
  if (!posted.length) return { id: 'post', state: 'doing', summary: `${posts.length} planned` }
  const labels = distinct(posted.map((p) => PLATFORMS.find((x) => x.id === p.platform)?.label ?? p.platform))
  return { id: 'post', state: 'done', summary: `${posted.length} posted · ${labels.join(', ')}` }
}

const RESPONDED: PitchStatus[] = ['replied', 'liked', 'passed', 'placed']
export function pitchStep(pitches: { contactId: number; status: PitchStatus }[]): ReleaseStep {
  if (!pitches.length) return { id: 'pitch', state: 'todo', summary: 'Not pitched yet' }
  const contacts = distinct(pitches.map((p) => p.contactId))
  const replied = distinct(pitches.filter((p) => RESPONDED.includes(p.status)).map((p) => p.contactId))
  return { id: 'pitch', state: replied.length ? 'done' : 'doing', summary: `Pitched to ${contacts.length} · ${replied.length} replied` }
}

export function feedbackStep(r: { links: number; unseen: number }): ReleaseStep {
  if (!r.links) return { id: 'feedback', state: 'todo', summary: 'No feedback link' }
  return { id: 'feedback', state: r.unseen > 0 ? 'doing' : 'done', summary: `${plural(r.links, 'link')} · ${plural(r.unseen, 'new comment')}` }
}

export function splitsStep(r: { hasCredits: boolean; parties: number; pub: number; master: number; sheetAt: number | null }): ReleaseStep {
  if (r.parties === 0) return r.hasCredits ? { id: 'splits', state: 'todo', summary: 'Not recorded' } : { id: 'splits', state: 'na', summary: 'You own 100%' }
  const sheet = r.sheetAt ? ` · sheet ${new Date(r.sheetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''
  return { id: 'splits', state: near100(r.pub) && near100(r.master) ? 'done' : 'doing', summary: `Publishing ${r.pub}% · Master ${r.master}%${sheet}` }
}

export function saleStep(sales: { price: number; exclusive: boolean }[]): ReleaseStep {
  if (!sales.length) return { id: 'sale', state: 'todo', summary: 'No sales yet' }
  const total = sales.reduce((a, s) => a + s.price, 0)
  return { id: 'sale', state: 'done', summary: `${plural(sales.length, 'sale')} · ${money(Math.round(total * 100) / 100)}${sales.some((s) => s.exclusive) ? ' · exclusive' : ''}` }
}

export function buildRelease(beatId: number, groupId: number, steps: ReleaseStep[]): Release {
  return { beatId, groupId, steps, done: steps.filter((s) => s.state === 'done').length, total: steps.filter((s) => s.state !== 'na').length }
}
