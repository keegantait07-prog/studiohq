import type { Store } from '../store'
import type { Crm } from '../crm'
import type { Sales } from '../sales'
import type { Content } from '../content'
import type { Feedback } from '../feedback'
import type { YtPublisher } from '../ytpublisher'
import { parseQuery } from '../../shared/query'
import { STATUSES, PLATFORMS, SALE_SOURCES, CONTACT_ROLES, TAG_KINDS, type TagKind } from '../../shared/types'

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  kind: 'read' | 'write'
  /** Text for the approval card: names the target and shows the values to be written. Must never throw. */
  describe(args: Record<string, any>): string // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Write tools only: a reason these arguments can never succeed. The server returns it without asking for approval; it can only reject, never skip approval. */
  validate?(args: Record<string, any>): string | null // eslint-disable-line @typescript-eslint/no-explicit-any
  run(args: Record<string, any>): unknown | Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ToolDeps {
  store: Pick<Store, 'listBeats' | 'getBeat' | 'updateBeat' | 'setTags'>
  crm: Pick<Crm, 'all' | 'due' | 'saveContact' | 'deleteContact' | 'logPitch' | 'logFollowup'>
  sales: Pick<Sales, 'all' | 'log'>
  content: Pick<Content, 'all' | 'savePost'>
  feedback: Pick<Feedback, 'all'>
  yt: Pick<YtPublisher, 'status' | 'prepare'>
  afterWrite(): void
}

const MAX_BEATS = 50
const RECENT_SALES = 5
const SHOW_LEN = 80
const MAX_LIMIT = 500
const MAX_REMOVE = 100
const SHOW_REMOVE = 12

const noArgs = { type: 'object' as const, properties: {} }

export function buildTools(d: ToolDeps): ToolDef[] {
  const read = (name: string, description: string, inputSchema: ToolDef['inputSchema'], run: ToolDef['run'], describe: ToolDef['describe'] = () => description): ToolDef =>
    ({ name, description, inputSchema, kind: 'read', describe, run })

  /** A write tool: bad arguments and refusals from the stores come back as { error }; afterWrite runs only after a real write. */
  const write = (name: string, description: string, inputSchema: ToolDef['inputSchema'], describe: ToolDef['describe'], run: (a: Record<string, any>) => Promise<unknown> | unknown, validate?: ToolDef['validate']): ToolDef => // eslint-disable-line @typescript-eslint/no-explicit-any
    ({
      name, description, inputSchema, kind: 'write',
      describe: (a) => { try { return describe(a) } catch { return `Run ${name}` } },
      validate: validate ? (a) => { try { return validate(a) } catch (e) { return e instanceof Error ? e.message : String(e) } } : undefined,
      run: async (a) => {
        try {
          const r = await run(a)
          if (r && typeof r === 'object' && 'error' in r) return r
          d.afterWrite()
          return r
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      }
    })
  const beatName = (id: unknown) => titleOf(Number(id)) ?? `beat ${id}`
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const platformIds = PLATFORMS.map((p) => p.id) as string[]
  const sourceList = SALE_SOURCES as string[]

  const titleOf = (id: number | null) => (id == null ? null : d.store.getBeat(id)?.title ?? null)

  /** A value for an approval card: quoted, with long text cut to ~80 characters. */
  const show = (v: unknown): string => {
    const chars = Array.from(typeof v === 'string' ? v : String(v))
    return `"${chars.length > SHOW_LEN ? chars.slice(0, SHOW_LEN).join('') + '…' : chars.join('')}"`
  }
  const limitOf = (a: Record<string, any>): number => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const n = Math.floor(Number(a.limit))
    return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : MAX_BEATS
  }
  const capped = <T>(key: string, a: Record<string, any>, items: T[]) => ({ total: items.length, [key]: items.slice(0, limitOf(a)) }) // eslint-disable-line @typescript-eslint/no-explicit-any
  const limitProp = { limit: { type: 'number', description: `Most rows to return (default ${MAX_BEATS}); the total is always reported` } }

  type A = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  type Fail = { error: string }

  const beatPatch = (a: A): Fail | { patch: Parameters<ToolDeps['store']['updateBeat']>[1] } => {
    if (!d.store.getBeat(Number(a.id))) return { error: `No beat with id ${a.id}` }
    const patch: Parameters<ToolDeps['store']['updateBeat']>[1] = {}
    if (a.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(a.status)) return { error: `Status must be one of: ${STATUSES.join(', ')}` }
      patch.status = a.status
    }
    if (a.title !== undefined) {
      if (!str(a.title).trim()) return { error: 'Title cannot be empty' }
      patch.title = str(a.title).trim()
    }
    if (a.bpm !== undefined) {
      if (a.bpm !== null && !(Number.isFinite(Number(a.bpm)) && Number(a.bpm) > 0)) return { error: 'bpm must be a positive number' }
      patch.bpm = a.bpm === null ? null : Number(a.bpm)
    }
    if (a.key !== undefined) patch.key = a.key === null ? null : str(a.key)
    if (a.notes !== undefined) patch.notes = str(a.notes)
    if (a.versionLabel !== undefined) patch.versionLabel = str(a.versionLabel)
    if (!Object.keys(patch).length) return { error: 'Nothing to change' }
    return { patch }
  }

  const mergeTags = (a: A): Fail | { tags: Record<TagKind, string[]> } => {
    const b = d.store.getBeat(Number(a.id))
    if (!b) return { error: `No beat with id ${a.id}` }
    const given = a.tags
    if (!given || typeof given !== 'object' || Array.isArray(given)) return { error: 'tags must be an object like { "vibe": ["dark"] }' }
    const bad = Object.keys(given).filter((k) => !(TAG_KINDS as string[]).includes(k))
    if (bad.length) return { error: `Unknown tag kind: ${bad.join(', ')}. Use ${TAG_KINDS.join(', ')}` }
    const merged = { vibe: [...b.tags.vibe], genre: [...b.tags.genre], artist: [...b.tags.artist] } as Record<TagKind, string[]>
    for (const k of TAG_KINDS) {
      const list = (given as Record<string, unknown>)[k]
      if (list === undefined) continue
      if (!Array.isArray(list)) return { error: `${k} must be a list of words` }
      for (const w of list.map((x) => String(x).trim()).filter(Boolean)) if (!merged[k].includes(w)) merged[k].push(w)
    }
    return { tags: merged }
  }

  /** The contacts a remove_contacts call would hide: a clean, de-duplicated id list that must all exist (all or nothing). */
  const removeInput = (a: Record<string, any>): { ids: number[]; names: string[] } | { error: string } => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!Array.isArray(a.ids) || !a.ids.length) return { error: 'ids must be a non-empty list of contact ids' }
    const ids = [...new Set(a.ids.map(Number))]
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return { error: 'ids must be whole contact ids' }
    if (ids.length > MAX_REMOVE) return { error: `Remove at most ${MAX_REMOVE} contacts at a time` }
    const byId = new Map(d.crm.all().contacts.map((c) => [c.id, c]))
    const missing = ids.find((n) => !byId.has(n))
    if (missing !== undefined) return { error: `No contact with id ${missing}` }
    return { ids, names: ids.map((n) => byId.get(n)!.name) }
  }
  const contactInput = (a: A): Fail | { input: Parameters<ToolDeps['crm']['saveContact']>[0] } => {
    if (!str(a.name).trim()) return { error: 'Name is required' }
    if (a.role !== undefined && !(CONTACT_ROLES as string[]).includes(a.role)) return { error: `Role must be one of: ${CONTACT_ROLES.join(', ')}` }
    if (a.followupDays != null && !(Number.isFinite(Number(a.followupDays)) && Number(a.followupDays) > 0)) return { error: 'followupDays must be a positive number' }
    if (a.links !== undefined && !(Array.isArray(a.links) && a.links.every((l: any) => l && typeof l.label === 'string' && typeof l.url === 'string'))) return { error: 'links must be a list of { label, url }' } // eslint-disable-line @typescript-eslint/no-explicit-any
    const old = a.id ? d.crm.all().contacts.find((c) => c.id === Number(a.id)) : undefined
    if (a.id && !old) return { error: `No contact with id ${a.id}` }
    return {
      input: {
        ...(old ? { id: old.id } : {}),
        name: str(a.name).trim(),
        role: a.role ?? old?.role,
        email: a.email !== undefined ? str(a.email) : old?.email,
        sound: a.sound !== undefined ? str(a.sound) : old?.sound,
        notes: a.notes !== undefined ? str(a.notes) : old?.notes,
        followupDays: a.followupDays !== undefined ? (a.followupDays === null ? null : Number(a.followupDays)) : old?.followupDays ?? null,
        links: a.links !== undefined ? a.links.map((l: { label: string; url: string }) => ({ label: l.label, url: l.url })) : old?.links
      }
    }
  }

  const pitchInput = (a: A): Fail | { followUp: number } | { input: Parameters<ToolDeps['crm']['logPitch']>[0] } => {
    const crm = d.crm.all()
    if (a.followUpPitchId != null) {
      const pid = Number(a.followUpPitchId)
      if (!crm.pitches.some((p) => p.id === pid)) return { error: `No pitch with id ${a.followUpPitchId}` }
      return { followUp: pid }
    }
    const contactId = Number(a.contactId)
    if (!crm.contacts.some((c) => c.id === contactId)) return { error: `No contact with id ${a.contactId}` }
    const channel = a.channel ?? 'email'
    if (!['email', 'dm', 'other'].includes(channel)) return { error: 'channel must be email, dm or other' }
    const beatIds: number[] = Array.isArray(a.beatIds) ? a.beatIds.map(Number) : []
    const missing = beatIds.find((id) => !d.store.getBeat(id))
    if (missing !== undefined) return { error: `No beat with id ${missing}` }
    return { input: { contactId, beatIds, channel, subject: str(a.subject), link: str(a.link), packId: null } }
  }

  /** Create needs beatId, platform and status; an update starts from the stored post and applies only what was given. */
  const mergePost = (a: A): Fail | { post: Parameters<ToolDeps['content']['savePost']>[0] } => {
    const old = a.id ? d.content.all().posts.find((p) => p.id === Number(a.id)) : undefined
    if (a.id && !old) return { error: `No post with id ${a.id}` }
    const beatId = a.beatId !== undefined ? Number(a.beatId) : old?.beatId
    const platform = a.platform !== undefined ? a.platform : old?.platform
    const status = a.status !== undefined ? a.status : old?.status
    if (beatId === undefined || platform === undefined || status === undefined) return { error: 'beatId, platform and status are required to create a post' }
    if (!platformIds.includes(platform)) return { error: `Platform must be one of: ${platformIds.join(', ')}` }
    if (status !== 'planned' && status !== 'posted') return { error: 'Status must be planned or posted' }
    if (!d.store.getBeat(beatId)) return { error: `No beat with id ${beatId}` }
    return {
      post: {
        ...(old ? { id: old.id } : {}),
        beatId, platform, status,
        date: a.date != null ? Number(a.date) : old ? old.date : Date.now(),
        url: a.url !== undefined ? str(a.url) : old?.url ?? '',
        caption: a.caption !== undefined ? str(a.caption) : old?.caption ?? ''
      }
    }
  }

  /** The artists a draft will use: the ones given, else the beat's existing artist tags. null when the beat is unknown. */
  const draftArtists = (a: A): string[] | null => {
    const b = d.store.getBeat(Number(a.beatId))
    if (!b) return null
    return Array.isArray(a.artists) ? a.artists.map(String) : [...b.tags.artist]
  }

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

    read('list_contacts', `Contacts in the pitch CRM (artists, managers, A&Rs) with their sound and notes. Returns at most ${MAX_BEATS} by default plus the total.`, { type: 'object', properties: { ...limitProp } },
      (a) => capped('contacts', a, d.crm.all().contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, email: c.email, sound: c.sound, notes: c.notes, followupDays: c.followupDays })))),

    read('list_pitches', 'Pitches sent to contacts, newest first, with status, beats and follow-up dates. Optionally filter by contact or status. Returns at most ' + MAX_BEATS + ' by default plus the total.',
      { type: 'object', properties: { contactId: { type: 'number' }, status: { type: 'string', description: 'sent, listened, replied, liked, passed or placed' }, ...limitProp } },
      (a) => {
        const crm = d.crm.all()
        const names = new Map(crm.contacts.map((c) => [c.id, c.name]))
        return capped('pitches', a, crm.pitches
          .filter((p) => (a.contactId == null || p.contactId === Number(a.contactId)) && (!a.status || p.status === a.status))
          .map((p) => ({
            id: p.id, contactId: p.contactId, contact: names.get(p.contactId) ?? null, subject: p.subject, channel: p.channel, sentAt: p.sentAt, status: p.status,
            responseNote: p.responseNote, nextFollowupAt: p.nextFollowupAt, followupCount: p.followupCount,
            beats: p.beats.map((b) => ({ beatId: b.beatId, title: b.title, response: b.response }))
          })))
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

    read('list_sales', `Logged sales, newest first, with buyer, license, price, fee and date. Returns at most ${MAX_BEATS} by default plus the total.`, { type: 'object', properties: { ...limitProp } },
      (a) => capped('sales', a, d.sales.all().sales.map((s) => ({ id: s.id, beatId: s.beatId, beat: s.beatTitle, buyer: s.buyer, license: s.licenseName, exclusive: s.exclusive, price: s.price, fee: s.fee, source: s.source, soldAt: s.soldAt, notes: s.notes })))),

    read('list_posts', `Content posts (planned and posted) across TikTok, Instagram and YouTube, newest first. Returns at most ${MAX_BEATS} by default plus the total.`, { type: 'object', properties: { ...limitProp } },
      (a) => capped('posts', a, d.content.all().posts.map((p) => ({ id: p.id, beatId: p.beatId, beat: titleOf(p.beatId), platform: p.platform, status: p.status, date: p.date, url: p.url, caption: p.caption })))),

    read('feedback_inbox', `Comments left on feedback links, newest first, with whether they are seen or resolved. Returns at most ${MAX_BEATS} by default plus the total.`, { type: 'object', properties: { ...limitProp } },
      (a) => {
        const fb = d.feedback.all()
        const titles = new Map(fb.links.map((l) => [l.slug, l.title]))
        return capped('comments', a, fb.comments.map((c) => ({ id: c.id, link: titles.get(c.slug) ?? c.slug, beat: titleOf(c.beatId), name: c.name, time: c.time, text: c.text, createdAt: c.createdAt, seen: c.seen, resolved: c.resolved })))
      }),

    read('youtube_status', 'Whether YouTube publishing is ready: signed in, API key present, thumbnail images left and quota used today.', noArgs,
      async () => {
        const s = await d.yt.status()
        return { signedIn: s.signedIn, hasClientId: s.hasClientId, hasAnthropicKey: s.hasAnthropicKey, imagesLeft: s.imagesLeft, quotaToday: s.quotaToday }
      }),

    read('list_videos', 'Finished videos exported from Studio HQ, newest first, with the beat and format.', noArgs,
      () => d.content.all().videos.map((v) => ({ id: v.id, beatId: v.beatId, beat: titleOf(v.beatId), format: v.format, createdAt: v.createdAt }))),

    write('update_beat', 'Change a beat\'s title, status, bpm, key, notes or version label. Status is one of: ' + STATUSES.join(', ') + '.',
      { type: 'object', properties: { id: { type: 'number' }, title: { type: 'string' }, status: { type: 'string', enum: [...STATUSES] }, bpm: { type: ['number', 'null'] }, key: { type: ['string', 'null'] }, notes: { type: 'string' }, versionLabel: { type: 'string' } }, required: ['id'] },
      (a) => {
        const parts: string[] = []
        if (a.status !== undefined) parts.push(`status to ${show(a.status)}`)
        if (a.title !== undefined) parts.push(`title to ${show(a.title)}`)
        if (a.bpm !== undefined) parts.push(`bpm to ${a.bpm === null ? 'none' : show(a.bpm)}`)
        if (a.key !== undefined) parts.push(`key to ${a.key === null ? 'none' : show(a.key)}`)
        if (a.notes !== undefined) parts.push(`notes (REPLACES the existing notes) with ${show(a.notes)}`)
        if (a.versionLabel !== undefined) parts.push(`version label to ${show(a.versionLabel)}`)
        return `Update "${beatName(a.id)}": set ${parts.join('; ') || 'nothing'}`
      },
      (a) => {
        const patch = beatPatch(a)
        if ('error' in patch) return { error: patch.error }
        d.store.updateBeat(Number(a.id), patch.patch)
        return { ok: true }
      },
      (a) => { const p = beatPatch(a); return 'error' in p ? p.error : null }),

    write('set_tags', 'Add tags to a beat. Tags are merged into the beat\'s existing ones; give any of vibe, genre, artist as lists of words.',
      { type: 'object', properties: { id: { type: 'number' }, tags: { type: 'object', properties: { vibe: { type: 'array', items: { type: 'string' } }, genre: { type: 'array', items: { type: 'string' } }, artist: { type: 'array', items: { type: 'string' } } } } }, required: ['id', 'tags'] },
      (a) => {
        const t = (a.tags ?? {}) as Record<string, unknown>
        const parts = TAG_KINDS.flatMap((k) => (Array.isArray(t[k]) && (t[k] as unknown[]).length ? [`${k}: ${(t[k] as unknown[]).map((w) => show(w)).join(', ')}`] : []))
        return `Add tags to "${beatName(a.id)}" (existing tags are kept): ${parts.join('; ') || 'nothing'}`
      },
      (a) => {
        const m = mergeTags(a)
        if ('error' in m) return { error: m.error }
        d.store.setTags(Number(a.id), m.tags)
        return { ok: true }
      },
      (a) => { const m = mergeTags(a); return 'error' in m ? m.error : null }),

    write('save_contact', 'Add a contact to the pitch CRM, or update one when id is given (fields you leave out are kept). Role is one of: ' + CONTACT_ROLES.join(', ') + '.',
      { type: 'object', properties: { id: { type: 'number', description: 'Only to update an existing contact; omitted fields keep their current values' }, name: { type: 'string' }, role: { type: 'string', enum: [...CONTACT_ROLES] }, email: { type: 'string' }, sound: { type: 'string' }, notes: { type: 'string' }, followupDays: { type: ['number', 'null'] }, links: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] } } }, required: ['name'] },
      (a) => {
        const name = str(a.name).trim() || '(unnamed)'
        const old = a.id ? d.crm.all().contacts.find((c) => c.id === Number(a.id)) : undefined
        const sets: string[] = []
        if (a.role !== undefined) sets.push(`role ${show(a.role)}`)
        if (a.email !== undefined) sets.push(`email ${show(a.email)}`)
        if (a.sound !== undefined) sets.push(`sound ${show(a.sound)}`)
        if (a.notes !== undefined) sets.push(`notes ${show(a.notes)}`)
        if (a.followupDays !== undefined) sets.push(`follow-up after ${a.followupDays === null ? 'none' : show(a.followupDays)} days`)
        if (Array.isArray(a.links)) sets.push(`${a.links.length} link${a.links.length === 1 ? '' : 's'}`)
        const tail = sets.length ? `: set ${sets.join('; ')}` : ''
        if (a.id) {
          const who = old ? `contact "${old.name}"` : `contact ${show(a.id)}`
          return `Update ${who}${old && old.name !== name ? ` (rename to ${show(name)})` : ''}${tail}`
        }
        return `Create contact ${show(name)}${tail}`
      },
      (a) => {
        const r = contactInput(a)
        if ('error' in r) return { error: r.error }
        return { ok: true, id: d.crm.saveContact(r.input) }
      },
      (a) => { const r = contactInput(a); return 'error' in r ? r.error : null }),

    write('remove_contacts', 'Remove contacts from the pitch CRM. They are hidden, their follow-ups stop, and the record of what was pitched to them is kept. Only use this for contacts the user asked to remove, and tell the user which contacts and why before you call it. Pass every contact to remove in one call.',
      { type: 'object', properties: { ids: { type: 'array', items: { type: 'number' }, description: `Ids of the contacts to remove (at most ${MAX_REMOVE})` } }, required: ['ids'] },
      (a) => {
        const ids = Array.isArray(a.ids) ? [...new Set(a.ids.map(Number))] : []
        const byId = new Map(d.crm.all().contacts.map((c) => [c.id, c]))
        const shown = ids.slice(0, SHOW_REMOVE).map((id) => {
          const c = byId.get(id)
          return c ? `${show(c.name)}${c.email ? ` (${c.email})` : ''}` : `contact ${id}`
        })
        const more = ids.length > SHOW_REMOVE ? `, and ${ids.length - SHOW_REMOVE} more` : ''
        return `Remove ${ids.length} contact${ids.length === 1 ? '' : 's'} from the pitch CRM: ${shown.join(', ')}${more}. Their follow-ups stop and past pitches stay on record.`
      },
      (a) => {
        const r = removeInput(a)
        if ('error' in r) return { error: r.error }
        for (const id of r.ids) d.crm.deleteContact(id)
        return { ok: true, removed: r.ids.length, names: r.names }
      },
      (a) => { const r = removeInput(a); return 'error' in r ? r.error : null }),

    write('log_pitch', 'Record that beats were pitched to a contact, or (with followUpPitchId) that you followed up on an existing pitch. Beats still at idea, wip or finished move to sent.',
      { type: 'object', properties: { contactId: { type: 'number' }, beatIds: { type: 'array', items: { type: 'number' } }, subject: { type: 'string' }, channel: { type: 'string', enum: ['email', 'dm', 'other'] }, link: { type: 'string' }, followUpPitchId: { type: 'number', description: 'Log a follow-up on this pitch instead of a new pitch' } } },
      (a) => {
        const crm = d.crm.all()
        if (a.followUpPitchId != null) {
          const p = crm.pitches.find((x) => x.id === Number(a.followUpPitchId))
          const who = p ? crm.contacts.find((c) => c.id === p.contactId)?.name : undefined
          return `Log a follow-up to ${who ? `"${who}"` : 'a contact'} on pitch ${p ? show(p.subject || '(no subject)') : show(a.followUpPitchId)}`
        }
        const who = crm.contacts.find((c) => c.id === Number(a.contactId))?.name
        const titles = Array.isArray(a.beatIds) ? a.beatIds.map((id: unknown) => `"${beatName(id)}"`).join(', ') : ''
        const extra = [a.subject ? `subject ${show(a.subject)}` : '', a.link ? `link ${show(a.link)}` : ''].filter(Boolean).join('; ')
        return `Log a pitch to ${who ? `"${who}"` : `contact ${show(a.contactId)}`} of ${titles || 'no beats'}${extra ? ` (${extra})` : ''}. Beats still at idea, wip or finished move to "sent".`
      },
      (a) => {
        const r = pitchInput(a)
        if ('error' in r) return { error: r.error }
        if ('followUp' in r) { d.crm.logFollowup(r.followUp); return { ok: true, pitchId: r.followUp } }
        return { ok: true, pitchId: d.crm.logPitch(r.input) }
      },
      (a) => { const r = pitchInput(a); return 'error' in r ? r.error : null }),

    write('log_sale', 'Log a beat sale. Source is one of: ' + SALE_SOURCES.join(', ') + '. Fee defaults to 0, date to now, source to other.',
      { type: 'object', properties: { beatId: { type: 'number' }, buyer: { type: 'string' }, price: { type: 'number' }, fee: { type: 'number' }, licenseName: { type: 'string' }, exclusive: { type: 'boolean' }, source: { type: 'string', enum: [...SALE_SOURCES] }, soldAt: { type: 'number', description: 'Unix milliseconds; defaults to now' }, buyerEmail: { type: 'string' }, notes: { type: 'string' } }, required: ['beatId', 'buyer', 'price'] },
      (a) => {
        const bits = [`price ${show(a.price)}`, `fee ${a.fee == null ? '0' : show(a.fee)}`, a.licenseName ? `license ${show(a.licenseName)}` : '', a.exclusive ? 'exclusive' : 'non-exclusive', `source ${show(a.source ?? 'other')}`]
        if (a.soldAt != null) bits.push(`sold ${show(new Date(Number(a.soldAt)).toISOString().slice(0, 10))}`)
        return `Log a sale of "${beatName(a.beatId)}" to ${show(str(a.buyer).trim() || '(no buyer)')}: ${bits.filter(Boolean).join(', ')}`
      },
      (a) => {
        const source = a.source ?? 'other'
        if (!sourceList.includes(source)) return { error: `Source must be one of: ${SALE_SOURCES.join(', ')}` }
        const id = d.sales.log({
          beatId: Number(a.beatId), buyer: str(a.buyer), buyerEmail: str(a.buyerEmail), contactId: null, licenseId: null, licenseName: str(a.licenseName),
          exclusive: a.exclusive === true, price: Number(a.price), fee: a.fee == null ? 0 : Number(a.fee), source, soldAt: a.soldAt == null ? Date.now() : Number(a.soldAt), notes: str(a.notes)
        })
        return { ok: true, saleId: id }
      },
      (a) => (sourceList.includes(a.source ?? 'other') ? null : `Source must be one of: ${SALE_SOURCES.join(', ')}`)),

    write('save_post', 'Plan or record a content post for a beat, or update one when id is given (fields you leave out are kept; beatId, platform and status are required when creating). Platform is one of: ' + platformIds.join(', ') + '. Status is planned or posted.',
      { type: 'object', properties: { id: { type: 'number', description: 'Only to update an existing post; omitted fields keep their current values' }, beatId: { type: 'number' }, platform: { type: 'string', enum: platformIds }, status: { type: 'string', enum: ['planned', 'posted'] }, date: { type: 'number', description: 'Unix milliseconds; defaults to now when creating' }, url: { type: 'string' }, caption: { type: 'string' } } },
      (a) => {
        const m = mergePost(a)
        const p = 'post' in m ? m.post : null
        const beatId = p ? p.beatId : a.beatId
        const platform = p ? p.platform : a.platform
        const status = p ? p.status : a.status
        const head = a.id ? `Update post ${show(a.id)}` : `${status === 'posted' ? 'Record a' : 'Plan a'} post`
        const bits = [`${platform ?? '?'} for "${beatName(beatId)}"`, `status ${status ?? '?'}`]
        if (p) bits.push(`date ${new Date(p.date).toISOString().slice(0, 10)}`, `url ${p.url ? show(p.url) : '(none)'}`, `caption ${p.caption ? show(p.caption) : '(none)'}`)
        return `${head}: ${bits.join(', ')}`
      },
      (a) => {
        const m = mergePost(a)
        if ('error' in m) return { error: m.error }
        return { ok: true, postId: d.content.savePost(m.post) }
      },
      (a) => { const m = mergePost(a); return 'error' in m ? m.error : null }),

    write('prepare_youtube_draft', 'Make the YouTube video and package (title, description, tags, thumbnail) for a beat and save it as a draft to review in the YouTube tab. It never uploads or publishes anything. If artists is left out the beat\'s existing artist tags are used; the beat\'s artist tags are set to the artists used.',
      { type: 'object', properties: { beatId: { type: 'number' }, artists: { type: 'array', items: { type: 'string' }, description: 'Artists to tag the video against; defaults to the beat\'s existing artist tags' } }, required: ['beatId'] },
      (a) => {
        const used = draftArtists(a)
        return `Prepare a YouTube draft for "${beatName(a.beatId)}" using artists ${used ? (used.length ? used.map((x) => show(x)).join(', ') : '(none)') : '(unknown)'}. The beat's artist tags will be set to these. Uses your Anthropic key and YouTube quota; nothing is uploaded or published.`
      },
      async (a) => {
        const artists = draftArtists(a)
        if (!artists) return { error: `No beat with id ${a.beatId}` }
        const draft = await d.yt.prepare(Number(a.beatId), artists, () => {})
        return { ok: true, videoId: draft.videoId, beatId: draft.beatId, artists: draft.artists, note: 'Draft saved. Review and publish it from the YouTube tab.' }
      },
      (a) => (draftArtists(a) ? null : `No beat with id ${a.beatId}`))
  ]
}
