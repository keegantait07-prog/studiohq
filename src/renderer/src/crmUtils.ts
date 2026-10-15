import { AWAITING, type Contact, type Pitch, type PitchBeat } from '@shared/types'
import { displayKey } from '@shared/key'
import { firstName, type TemplateVars } from '@shared/template'

export const DAY = 86400000
export const isAwaiting = (p: Pitch) => AWAITING.includes(p.status)
export const isDue = (p: Pitch, now = Date.now()) => isAwaiting(p) && p.nextFollowupAt != null && p.nextFollowupAt <= now
export const daysSince = (ms: number, now = Date.now()) => Math.max(0, Math.floor((now - ms) / DAY))
export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function dueLabel(p: Pitch, now = Date.now()): string {
  if (!isAwaiting(p) || p.nextFollowupAt == null) return ''
  const d = Math.round((p.nextFollowupAt - now) / DAY)
  if (d < 0) return `follow-up ${-d}d overdue`
  if (d === 0) return 'follow up today'
  return `follow up in ${d}d`
}

export function beatLine(b: Pick<PitchBeat, 'title' | 'bpm' | 'key'>): string {
  const meta = [b.bpm ? `${Math.round(b.bpm)} BPM` : '', displayKey(b.key)].filter(Boolean).join(', ')
  return `• ${b.title}${meta ? ` (${meta})` : ''}`
}

export function varsFor(
  c: Contact,
  beats: Pick<PitchBeat, 'title' | 'bpm' | 'key'>[],
  o: { myName: string; link: string; sentAt?: number; subject?: string }
): TemplateVars {
  return {
    name: firstName(c.name), full_name: c.name, my_name: o.myName || 'me',
    beats: beats.map(beatLine).join('\n'), beat_titles: beats.map((b) => b.title).join(', '), beat_count: beats.length,
    link: o.link, days: o.sentAt ? daysSince(o.sentAt) : 0, sound: c.sound,
    sent_date: o.sentAt ? fmtDate(o.sentAt) : '', subject: o.subject ?? ''
  }
}

export function parseLinks(text: string): { label: string; url: string }[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [a, b] = l.includes('|') ? l.split('|').map((x) => x.trim()) : [l, l]
    const url = /^https?:\/\//i.test(b) ? b : `https://${b}`
    let label = a
    if (a === b) { try { label = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep raw */ } }
    return { label, url }
  })
}
export const linksToText = (l: { label: string; url: string }[]) => l.map((x) => `${x.label} | ${x.url}`).join('\n')

export async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard blocked */ }
}
export const mailto = (to: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
