// Ready-made searches for the Leads view. YouTube presets look for small, recently active ARTISTS through the videos they post
// (freestyles, music videos), never for beat channels; Reddit and X presets look for people asking for beats and skip sellers.
import type { LeadSource } from './leads'

export interface LeadPreset {
  id: string
  label: string
  group: string
  source: Extract<LeadSource, 'youtube' | 'reddit' | 'x' | 'soundcloud'>
  query: string
  /** YouTube only: keep channels under this many subscribers (hidden counts are kept). */
  maxSubs?: number
  /** YouTube only: only channels that uploaded a matching video within this many days. */
  days?: number
  note: string
}

const UNDERGROUND = { maxSubs: 10_000, days: 90 } as const
const SELLERS = '-"for sale" -"type beat" -lease'

export const LEAD_PRESETS: LeadPreset[] = [
  // YouTube: hip-hop and trap
  { id: 'yt-underground-freestyle', group: 'YouTube: hip-hop', label: 'Underground rappers posting freestyles', source: 'youtube', query: 'underground rapper freestyle', ...UNDERGROUND,
    note: 'Small rappers who posted a freestyle in the last 90 days. A good first search.' },
  { id: 'yt-unsigned-video', group: 'YouTube: hip-hop', label: 'Unsigned rappers with a new music video', source: 'youtube', query: 'unsigned rapper official music video', ...UNDERGROUND,
    note: 'Artists releasing their own videos, usually self-funded and under 10k subscribers.' },
  { id: 'yt-boom-bap', group: 'YouTube: hip-hop', label: 'Boom bap and lyrical rappers', source: 'youtube', query: 'boom bap lyrical rapper freestyle', ...UNDERGROUND,
    note: 'Lyric-focused rappers. They often buy sample-based and dusty drum beats.' },
  { id: 'yt-trap', group: 'YouTube: hip-hop', label: 'Trap rappers with a new video', source: 'youtube', query: 'trap rapper new music video', ...UNDERGROUND,
    note: 'Trap artists active this quarter. Works for 808-heavy beats.' },
  { id: 'yt-melodic', group: 'YouTube: hip-hop', label: 'Melodic rap and sing-rap', source: 'youtube', query: 'melodic rap new artist official video', ...UNDERGROUND,
    note: 'Melodic and sing-rap newcomers. Good fit for guitar and ambient beats.' },
  { id: 'yt-plugg', group: 'YouTube: hip-hop', label: 'Plugg and pluggnb artists', source: 'youtube', query: 'plugg pluggnb new artist music video', ...UNDERGROUND,
    note: 'Young artists in the plugg and pluggnb scene, which runs almost entirely on small channels.' },
  { id: 'yt-rage', group: 'YouTube: hip-hop', label: 'Rage and hyperpop rap', source: 'youtube', query: 'rage rap new artist music video', ...UNDERGROUND,
    note: 'Rage and hyperpop-leaning rappers. A fast-moving scene that always wants new beats.' },
  // YouTube: drill
  { id: 'yt-uk-drill', group: 'YouTube: drill', label: 'UK drill rappers', source: 'youtube', query: 'uk drill rapper freestyle music video', ...UNDERGROUND,
    note: 'Small UK drill acts posting videos and freestyles.' },
  { id: 'yt-ny-drill', group: 'YouTube: drill', label: 'Brooklyn and NY drill', source: 'youtube', query: 'brooklyn drill rapper new music video', ...UNDERGROUND,
    note: 'New York drill artists who posted a video recently.' },
  { id: 'yt-chicago-drill', group: 'YouTube: drill', label: 'Chicago drill', source: 'youtube', query: 'chicago drill rapper music video', ...UNDERGROUND,
    note: 'Chicago drill artists active in the last 90 days.' },
  // YouTube: regional scenes
  { id: 'yt-atlanta', group: 'YouTube: regional', label: 'Atlanta rappers', source: 'youtube', query: 'atlanta rapper new music video', ...UNDERGROUND,
    note: 'Atlanta artists with a recent video and a small audience.' },
  { id: 'yt-detroit', group: 'YouTube: regional', label: 'Detroit and Flint rappers', source: 'youtube', query: 'detroit rapper freestyle music video', ...UNDERGROUND,
    note: 'Detroit-area rappers, a scene with a lot of independent, active artists.' },
  { id: 'yt-houston', group: 'YouTube: regional', label: 'Houston rappers', source: 'youtube', query: 'houston rapper freestyle music video', ...UNDERGROUND,
    note: 'Houston artists posting freestyles and videos.' },
  { id: 'yt-west-coast', group: 'YouTube: regional', label: 'Bay Area and West Coast rappers', source: 'youtube', query: 'bay area rapper new music video', ...UNDERGROUND,
    note: 'West Coast independents with recent uploads.' },
  // YouTube: singers and other genres
  { id: 'yt-rnb', group: 'YouTube: singers and other genres', label: 'Independent R&B singers', source: 'youtube', query: 'rnb singer new original song official video', ...UNDERGROUND,
    note: 'R&B singers releasing original songs. Singers often need beats too.' },
  { id: 'yt-afrobeats', group: 'YouTube: singers and other genres', label: 'Afrobeats newcomers', source: 'youtube', query: 'afrobeats new artist official music video', ...UNDERGROUND,
    note: 'Small afrobeats artists, mostly from Nigeria, Ghana and the UK.' },
  { id: 'yt-latin-trap', group: 'YouTube: singers and other genres', label: 'Latin trap and reggaeton newcomers', source: 'youtube', query: 'latin trap new artist video oficial', ...UNDERGROUND,
    note: 'Spanish-language trap and reggaeton artists with small channels.' },
  // Reddit: people asking for beats right now
  { id: 'rd-asking', group: 'Reddit: asking for beats', label: 'Artists asking for beats', source: 'reddit', query: '"looking for beats" OR "need beats" OR "need a producer"',
    note: 'Newest posts from artists asking for beats or a producer. The strongest buying signal.' },
  { id: 'rd-project', group: 'Reddit: asking for beats', label: 'Looking for a producer for a project', source: 'reddit', query: '"looking for a producer" EP OR album OR mixtape OR project',
    note: 'Artists with a release in mind, who tend to want several beats.' },
  { id: 'rd-buying', group: 'Reddit: asking for beats', label: 'Rappers who want to buy or lease beats', source: 'reddit', query: '"where to buy beats" OR "where can i buy beats" OR "buy beats" rapper',
    note: 'People asking where to get beats, often with a budget.' },
  { id: 'rd-singers', group: 'Reddit: asking for beats', label: 'Singers needing instrumentals', source: 'reddit', query: '"need instrumentals" OR "looking for instrumentals" OR "need a beat" singer',
    note: 'Vocalists looking for instrumentals to write to.' },
  { id: 'rd-collab', group: 'Reddit: asking for beats', label: 'Collab requests', source: 'reddit', query: '"looking for a producer" OR "producer wanted" collab rapper',
    note: 'Artists open to working with a producer on an ongoing basis.' },
  // X: public requests
  { id: 'x-rappers', group: 'X: public requests', label: 'Rappers asking for beats', source: 'x', query: `rapper ${SELLERS}`,
    note: 'Recent posts from rappers asking for beats. Sellers are filtered out.' },
  { id: 'x-singers', group: 'X: public requests', label: 'Singers asking for beats', source: 'x', query: `(singer OR rnb OR vocalist) ${SELLERS}`,
    note: 'Recent posts from singers and R&B artists asking for beats.' },
  { id: 'x-project', group: 'X: public requests', label: 'Artists with a project coming', source: 'x', query: `(EP OR album OR mixtape OR project) ${SELLERS}`,
    note: 'Artists mentioning a project while asking for beats.' },
  // SoundCloud: artists by profile text
  { id: 'sc-drill', group: 'SoundCloud: artist profiles', label: 'Drill rappers', source: 'soundcloud', query: 'drill rapper',
    note: 'SoundCloud artists with "drill rapper" in their profile. Only accounts under 5,000 followers are kept.' },
  { id: 'sc-trap', group: 'SoundCloud: artist profiles', label: 'Trap and plugg rappers', source: 'soundcloud', query: 'trap plugg rapper',
    note: 'Small trap and plugg artists on SoundCloud.' },
  { id: 'sc-rnb', group: 'SoundCloud: artist profiles', label: 'R&B singers', source: 'soundcloud', query: 'rnb singer songwriter',
    note: 'Independent R&B singers and songwriters on SoundCloud.' }
]

export function presetGroups(): { group: string; presets: LeadPreset[] }[] {
  const out: { group: string; presets: LeadPreset[] }[] = []
  for (const p of LEAD_PRESETS) {
    const g = out.find((x) => x.group === p.group)
    if (g) g.presets.push(p)
    else out.push({ group: p.group, presets: [p] })
  }
  return out
}
