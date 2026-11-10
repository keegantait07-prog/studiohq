// Works out a beat's release checklist from what the app already stores. Per song: every version in the beat's group counts.
import type Database from 'better-sqlite3'
import { fromPrice } from './catalog-render'
import { buildRelease, feedbackStep, pitchStep, postStep, saleStep, splitsStep, storeStep, videoStep } from './release-steps'
import type { PitchStatus, Platform, Release } from '../shared/types'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function releaseFor(db: Database.Database, beatId: number): Release {
  const beat = db.prepare('SELECT id, group_id FROM beats WHERE id=?').get(beatId) as Row | undefined
  if (!beat) throw new Error('That beat no longer exists.')
  const g = beat.group_id as number
  const inGroup = new Set((db.prepare('SELECT id FROM beats WHERE group_id=?').all(g) as Row[]).map((r) => r.id as number))
  const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as Row[]

  // Store. site_beats belongs to Catalog and may not exist yet.
  const hasSite = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_beats'").get()
  const hasDirty = hasSite && (db.pragma('table_info(site_beats)') as { name: string }[]).some((c) => c.name === 'dirty')
  const onSite = hasSite ? all(`SELECT ${hasDirty ? 's.dirty' : '0 AS dirty'}, b.missing FROM site_beats s JOIN beats b ON b.id=s.beat_id WHERE b.group_id=?`, g) : []
  const soldExclusively = !!db.prepare('SELECT 1 FROM sales WHERE group_id=? AND exclusive=1').get(g)
  const licenses = all('SELECT exclusive, default_price FROM license_types').map((r) => ({ exclusive: !!r.exclusive, defaultPrice: r.default_price as number | null }))
  const store = storeStep({ onSite: onSite.length > 0, dirty: onSite.some((r) => r.dirty), missing: onSite.some((r) => r.missing), soldExclusively, from: fromPrice(licenses) })

  const video = videoStep(all('SELECT v.format FROM videos v JOIN beats b ON b.id=v.beat_id WHERE b.group_id=? ORDER BY v.created_at, v.id', g).map((r) => r.format as string))
  const post = postStep(all('SELECT p.status, p.platform FROM posts p JOIN beats b ON b.id=p.beat_id WHERE b.group_id=?', g).map((r) => ({ status: r.status, platform: r.platform as Platform })))
  const pitch = pitchStep(all('SELECT p.contact_id, p.status FROM pitch_beats pb JOIN pitches p ON p.id=pb.pitch_id JOIN beats b ON b.id=pb.beat_id WHERE b.group_id=?', g).map((r) => ({ contactId: r.contact_id as number, status: r.status as PitchStatus })))

  // Feedback: a link is a pack with kind 'feedback'. A comment belongs to the beat at its beat_index in the link's beats ordered by position.
  const links = all("SELECT DISTINCT p.id, p.slug FROM packs p JOIN pack_beats pb ON pb.pack_id=p.id JOIN beats b ON b.id=pb.beat_id WHERE p.kind='feedback' AND b.group_id=?", g)
  let unseen = 0
  for (const l of links) {
    const order = all('SELECT beat_id FROM pack_beats WHERE pack_id=? ORDER BY position', l.id).map((r) => r.beat_id as number)
    for (const c of all('SELECT beat_index FROM feedback_comments WHERE slug=? AND seen=0', l.slug)) if (inGroup.has(order[c.beat_index])) unseen++
  }
  const feedback = feedbackStep({ links: links.length, unseen })

  const sp = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(pub_pct),0) pub, COALESCE(SUM(master_pct),0) master FROM beat_splits WHERE group_id=?').get(g) as Row
  const sheetAt = (db.prepare('SELECT split_sheet_at FROM groups WHERE id=?').get(g) as Row | undefined)?.split_sheet_at ?? null
  const hasCredits = !!db.prepare("SELECT 1 FROM beats WHERE group_id=? AND trim(credits)<>''").get(g)
  const round = (n: number) => Math.round(n * 100) / 100
  const splits = splitsStep({ hasCredits, parties: sp.c, pub: round(sp.pub), master: round(sp.master), sheetAt })

  const sale = saleStep(all('SELECT price, exclusive FROM sales WHERE group_id=?', g).map((r) => ({ price: r.price as number, exclusive: !!r.exclusive })))

  return buildRelease(beatId, g, [store, video, post, pitch, feedback, splits, sale])
}
