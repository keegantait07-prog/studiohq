// One beat, four tracks. Each is worked out from what actually happened (pitches, posts, sales), so a beat can be
// pitched, posted and leased at the same time, and nobody has to keep a status up to date by hand.
import { AWAITING, type Beat, type Pitch, type Post, type Sale, type SplitGroup } from './types'

export const LANES = ['inbox', 'ready', 'out', 'earning'] as const
export type Lane = (typeof LANES)[number]
export const LANE_LABEL: Record<Lane, string> = { inbox: 'Inbox', ready: 'Ready', out: 'Out', earning: 'Earning' }

export type TrackState = 'idle' | 'active' | 'attention' | 'done'
export interface Track { state: TrackState; label: string }
export type NextKind = 'finish' | 'tag' | 'bounce' | 'followup' | 'publish' | 'overdue' | 'splits' | 'post' | 'pitch' | 'none'
export interface NextAction { kind: NextKind; label: string; contactId?: number; url?: string }

export interface BeatCard {
  groupId: number
  /** the version to play and open */
  beat: Beat
  versions: number
  lane: Lane
  tracks: { finish: Track; pitch: Track; post: Track; sell: Track }
  next: NextAction
  urgent: boolean
}

export interface LineInput { beats: Beat[]; pitches: Pitch[]; posts: Post[]; sales: Sale[]; splits: SplitGroup[]; now: number }

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
const hasTags = (b: Beat) => b.tags.vibe.length + b.tags.genre.length + b.tags.artist.length > 0
const isAudio = (b: Beat) => b.ext !== 'flp'

function plural(n: number, one: string): string { return `${n} ${one}${n === 1 ? '' : 's'}` }

export function buildLine({ beats, pitches, posts, sales, splits, now }: LineInput): BeatCard[] {
  const groups = new Map<number, Beat[]>()
  for (const b of beats) (groups.get(b.groupId) ?? groups.set(b.groupId, []).get(b.groupId)!).push(b)
  const groupOf = new Map(beats.map((b) => [b.id, b.groupId]))
  const today = startOfDay(now)

  const cards: BeatCard[] = []
  for (const [groupId, versions] of groups) {
    const audio = versions.filter(isAudio)
    const beat = [...(audio.length ? audio : versions)].sort((a, b) => b.mtime - a.mtime)[0]
    const myPitches = pitches.filter((p) => p.beats.some((x) => x.groupId === groupId))
    const myPosts = posts.filter((p) => groupOf.get(p.beatId) === groupId)
    const mySales = sales.filter((s) => s.groupId === groupId)
    const split = splits.find((s) => s.groupId === groupId)
    const exclusive = mySales.find((s) => s.exclusive)

    // ---- finish
    const worked = myPitches.length > 0 || myPosts.length > 0 || mySales.length > 0
    const unfinished = !audio.length || beat.status === 'idea' || beat.status === 'wip'
    const untagged = !versions.some(hasTags)
    const finish: Track = !audio.length ? { state: 'active', label: 'No bounce yet' }
      : unfinished ? { state: 'active', label: beat.status === 'idea' ? 'Idea' : 'In progress' }
      : untagged && !worked ? { state: 'attention', label: 'Needs tags' }
      : { state: 'done', label: 'Finished' }

    // ---- pitch
    const due = myPitches.find((p) => AWAITING.includes(p.status) && p.nextFollowupAt != null && p.nextFollowupAt <= now)
    const won = myPitches.some((p) => p.status === 'liked' || p.status === 'placed')
    const waiting = myPitches.filter((p) => AWAITING.includes(p.status)).length
    const markedSent = beat.status === 'sent'
    const pitch: Track = due ? { state: 'attention', label: 'Follow-up due' }
      : won ? { state: 'done', label: 'Liked' }
      : waiting ? { state: 'active', label: `${waiting} waiting` }
      : myPitches.length ? { state: 'done', label: plural(myPitches.length, 'pitch').replace('pitchs', 'pitches') }
      : markedSent ? { state: 'done', label: 'Sent' }
      : { state: 'idle', label: 'Not pitched' }

    // ---- post
    const live = myPosts.filter((p) => p.status === 'posted')
    const hidden = myPosts.find((p) => p.status === 'private')
    const overdue = myPosts.find((p) => p.status === 'planned' && startOfDay(p.date) < today)
    const planned = myPosts.find((p) => p.status === 'planned')
    const post: Track = overdue ? { state: 'attention', label: 'Post overdue' }
      : hidden ? { state: 'attention', label: 'Private on YouTube' }
      : live.length ? { state: 'done', label: plural(live.length, 'post') }
      : planned ? { state: 'active', label: 'Planned' }
      : { state: 'idle', label: 'Not posted' }

    // ---- sell
    const splitsOpen = !!split && split.parties > 0 && (Math.abs(split.pubTotal - 100) > 0.01 || Math.abs(split.masterTotal - 100) > 0.01)
    const sell: Track = exclusive ? { state: 'done', label: `Sold to ${exclusive.buyer}` }
      : splitsOpen ? { state: 'attention', label: 'Splits unfinished' }
      : mySales.length ? { state: 'active', label: plural(mySales.length, 'lease') }
      : { state: 'idle', label: 'No sales' }

    // ---- lane
    const lane: Lane = mySales.length ? 'earning'
      : finish.state !== 'done' ? 'inbox'
      : worked || markedSent ? 'out'
      : 'ready'

    // ---- the one next thing, most urgent first
    const next: NextAction = due ? { kind: 'followup', label: 'Follow up', contactId: due.contactId }
      : overdue ? { kind: 'overdue', label: 'Post it' }
      : hidden ? { kind: 'publish', label: 'Publish on YouTube', url: hidden.url }
      : splitsOpen ? { kind: 'splits', label: 'Finish splits' }
      : exclusive ? { kind: 'none', label: 'Sold' }
      : !audio.length ? { kind: 'bounce', label: 'Bounce it' }
      : unfinished ? { kind: 'finish', label: 'Mark finished' }
      : finish.state === 'attention' ? { kind: 'tag', label: 'Add tags' }
      : !live.length && !planned ? { kind: 'post', label: 'Make a video' }
      : !myPitches.length && !markedSent ? { kind: 'pitch', label: 'Pitch it' }
      : { kind: 'none', label: 'Out there' }

    cards.push({ groupId, beat, versions: versions.length, lane, tracks: { finish, pitch, post, sell }, next, urgent: !!due || !!overdue || !!hidden || splitsOpen })
  }
  return cards.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.beat.mtime - a.beat.mtime)
}

export interface SinceSummary { bounces: number; replies: number; sales: number; earned: number; comments: number; due: number; overdue: number }

/** What changed since the app was last open, plus what is waiting right now. */
export function sinceYouLeft(i: LineInput & { since: number; comments: { createdAt: number; seen: boolean }[] }): SinceSummary {
  const today = startOfDay(i.now)
  const fresh = i.sales.filter((s) => s.soldAt > i.since)
  return {
    bounces: new Set(i.beats.filter((b) => isAudio(b) && b.createdAt > i.since).map((b) => b.groupId)).size,
    replies: i.pitches.filter((p) => p.respondedAt != null && p.respondedAt > i.since).length,
    sales: fresh.length,
    earned: fresh.reduce((a, s) => a + s.price - s.fee, 0),
    comments: i.comments.filter((c) => !c.seen).length,
    due: i.pitches.filter((p) => AWAITING.includes(p.status) && p.nextFollowupAt != null && p.nextFollowupAt <= i.now).length,
    overdue: i.posts.filter((p) => p.status === 'planned' && startOfDay(p.date) < today).length
  }
}
