import type { Store } from '../store'
import type { Crm } from '../crm'
import type { Sales } from '../sales'
import type { Content } from '../content'
import type { Feedback } from '../feedback'
import type { YtPublisher } from '../ytpublisher'
import { parseQuery } from '../../shared/query'

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  kind: 'read' | 'write'
  describe(args: Record<string, any>): string // eslint-disable-line @typescript-eslint/no-explicit-any
  run(args: Record<string, any>): unknown | Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ToolDeps {
  store: Pick<Store, 'listBeats' | 'getBeat' | 'updateBeat' | 'setTags'>
  crm: Pick<Crm, 'all' | 'due' | 'saveContact' | 'logPitch' | 'logFollowup'>
  sales: Pick<Sales, 'all' | 'log'>
  content: Pick<Content, 'all' | 'savePost'>
  feedback: Pick<Feedback, 'all'>
  yt: Pick<YtPublisher, 'status' | 'prepare'>
  afterWrite(): void
}

const MAX_BEATS = 50
const RECENT_SALES = 5

const noArgs = { type: 'object' as const, properties: {} }

export function buildTools(d: ToolDeps): ToolDef[] {
  const read = (name: string, description: string, inputSchema: ToolDef['inputSchema'], run: ToolDef['run'], describe: ToolDef['describe'] = () => description): ToolDef =>
    ({ name, description, inputSchema, kind: 'read', describe, run })

  const titleOf = (id: number | null) => (id == null ? null : d.store.getBeat(id)?.title ?? null)

  return [
    read('search_beats',
      `Search the beat library with the same syntax as the Vault search box: comma-separated clauses that must all match, e.g. "dark, 140+ bpm, unsold". Returns at most ${MAX_BEATS} beats plus the total match count.`,
      { type: 'object', properties: { query: { type: 'string', description: 'Vault search text; empty matches every beat' } } },
      (a) => {
        const test = parseQuery(String(a.query ?? '')).test
        const hits = d.store.listBeats().filter((b) => !b.missing && test(b))
        return { total: hits.length, beats: hits.slice(0, MAX_BEATS).map((b) => ({ id: b.id, title: b.title, bpm: b.bpm, key: b.key, status: b.status, tags: b.tags })) }
      },
      (a) => `Search beats: ${a.query || 'everything'}`),

    read('get_beat', 'Full details of one beat by id: bpm, key, status, notes, credits, tags and versions.',
      { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      (a) => {
        const b = d.store.getBeat(Number(a.id))
        if (!b) return { error: `No beat with id ${a.id}` }
        return {
          id: b.id, title: b.title, filename: b.filename, bpm: b.bpm, key: b.key, status: b.status, duration: b.duration, notes: b.notes, credits: b.credits,
          versionLabel: b.versionLabel, tags: b.tags, hasProject: !!b.projectPath,
          versions: b.versions.map((v) => ({ id: v.id, title: v.title, versionLabel: v.versionLabel, status: v.status }))
        }
      },
      (a) => `Look up beat ${a.id}`),

    read('list_contacts', 'All contacts in the pitch CRM (artists, managers, A&Rs) with their sound and notes.', noArgs,
      () => d.crm.all().contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, email: c.email, sound: c.sound, notes: c.notes, followupDays: c.followupDays }))),

    read('list_pitches', 'Pitches sent to contacts, newest first, with status, beats and follow-up dates. Optionally filter by contact or status.',
      { type: 'object', properties: { contactId: { type: 'number' }, status: { type: 'string', description: 'sent, listened, replied, liked, passed or placed' } } },
      (a) => {
        const crm = d.crm.all()
        const names = new Map(crm.contacts.map((c) => [c.id, c.name]))
        return crm.pitches
          .filter((p) => (a.contactId == null || p.contactId === Number(a.contactId)) && (!a.status || p.status === a.status))
          .map((p) => ({
            id: p.id, contactId: p.contactId, contact: names.get(p.contactId) ?? null, subject: p.subject, channel: p.channel, sentAt: p.sentAt, status: p.status,
            responseNote: p.responseNote, nextFollowupAt: p.nextFollowupAt, followupCount: p.followupCount,
            beats: p.beats.map((b) => ({ beatId: b.beatId, title: b.title, response: b.response }))
          }))
      }),

    read('pitches_due', 'Pitches still waiting for a reply whose follow-up date has arrived.', noArgs, () => d.crm.due()),

    read('sales_summary', 'Totals across all logged sales: count, gross (sum of prices), net (price minus fee) and the most recent sales.', noArgs,
      () => {
        const sales = d.sales.all().sales
        return {
          count: sales.length,
          gross: sales.reduce((n, s) => n + s.price, 0),
          net: sales.reduce((n, s) => n + (s.price - s.fee), 0),
          recent: sales.slice(0, RECENT_SALES).map((s) => ({ id: s.id, beat: s.beatTitle, buyer: s.buyer, license: s.licenseName, price: s.price, fee: s.fee, soldAt: s.soldAt }))
        }
      }),

    read('list_sales', 'Every logged sale, newest first, with buyer, license, price, fee and date.', noArgs,
      () => d.sales.all().sales.map((s) => ({ id: s.id, beatId: s.beatId, beat: s.beatTitle, buyer: s.buyer, license: s.licenseName, exclusive: s.exclusive, price: s.price, fee: s.fee, source: s.source, soldAt: s.soldAt, notes: s.notes }))),

    read('list_posts', 'Content posts (planned and posted) across TikTok, Instagram and YouTube, newest first.', noArgs,
      () => d.content.all().posts.map((p) => ({ id: p.id, beatId: p.beatId, beat: titleOf(p.beatId), platform: p.platform, status: p.status, date: p.date, url: p.url, caption: p.caption }))),

    read('feedback_inbox', 'Comments left on feedback links, newest first, with whether they are seen or resolved.', noArgs,
      () => {
        const fb = d.feedback.all()
        const titles = new Map(fb.links.map((l) => [l.slug, l.title]))
        return fb.comments.map((c) => ({ id: c.id, link: titles.get(c.slug) ?? c.slug, beat: titleOf(c.beatId), name: c.name, time: c.time, text: c.text, createdAt: c.createdAt, seen: c.seen, resolved: c.resolved }))
      }),

    read('youtube_status', 'Whether YouTube publishing is ready: signed in, API key present, thumbnail images left and quota used today.', noArgs,
      async () => {
        const s = await d.yt.status()
        return { signedIn: s.signedIn, hasClientId: s.hasClientId, hasAnthropicKey: s.hasAnthropicKey, imagesLeft: s.imagesLeft, quotaToday: s.quotaToday }
      }),

    read('list_videos', 'Finished videos exported from Studio HQ, newest first, with the beat and format.', noArgs,
      () => d.content.all().videos.map((v) => ({ id: v.id, beatId: v.beatId, beat: titleOf(v.beatId), format: v.format, createdAt: v.createdAt })))
  ]
}
