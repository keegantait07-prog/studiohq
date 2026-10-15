export const STATUSES = ['idea', 'wip', 'finished', 'sent', 'sold'] as const
export type Status = (typeof STATUSES)[number]
export type TagKind = 'vibe' | 'genre' | 'artist'
export const TAG_KINDS: TagKind[] = ['vibe', 'genre', 'artist']

export interface Beat {
  id: number
  path: string
  filename: string
  title: string
  folder: string
  ext: string
  size: number
  mtime: number
  duration: number | null
  bpm: number | null
  bpmSource: 'analysis' | 'filename' | 'user' | null
  bpmConfidence: 'high' | 'low' | null
  key: string | null
  keySource: 'analysis' | 'filename' | 'user' | null
  status: Status
  notes: string
  credits: string
  groupId: number
  versionLabel: string
  projectPath: string | null
  projectConfidence: number | null
  missing: boolean
  analyzed: boolean
  thumb: number[]
  tags: Record<TagKind, string[]>
  createdAt: number
}

export interface BeatDetail extends Beat {
  peaks: number[]
  versions: Beat[]
}

export interface BeatPatch {
  title?: string
  status?: Status
  bpm?: number | null
  key?: string | null
  notes?: string
  versionLabel?: string
  projectPath?: string | null
}

export interface Settings {
  watchFolders: string[]
  projectFolders: string[]
  includeIdeas: boolean
  ownHandles: string[]
  producerName: string
  followupDays: number
  notify: boolean
}

// ---- Pitch CRM ----
export type ContactRole = 'artist' | 'manager' | 'a&r' | 'other'
export const CONTACT_ROLES: ContactRole[] = ['artist', 'manager', 'a&r', 'other']
export interface ContactLink { label: string; url: string }
export interface Contact {
  id: number
  name: string
  role: ContactRole
  email: string
  sound: string
  links: ContactLink[]
  notes: string
  followupDays: number | null
  createdAt: number
}
export type PitchStatus = 'sent' | 'listened' | 'replied' | 'liked' | 'passed' | 'placed'
export const PITCH_STATUSES: PitchStatus[] = ['sent', 'listened', 'replied', 'liked', 'passed', 'placed']
/** statuses where we are still waiting to hear back */
export const AWAITING: PitchStatus[] = ['sent', 'listened']
export interface PitchBeat { beatId: number; title: string; bpm: number | null; key: string | null; response: '' | 'liked' | 'passed' }
export interface Pitch {
  id: number
  contactId: number
  packId: number | null
  subject: string
  channel: 'email' | 'dm' | 'other'
  link: string
  sentAt: number
  status: PitchStatus
  responseNote: string
  respondedAt: number | null
  nextFollowupAt: number | null
  followupCount: number
  lastFollowupAt: number | null
  beats: PitchBeat[]
}
export interface Template { id: number; name: string; kind: 'first_pitch' | 'follow_up' | 'custom'; subject: string; body: string }
export interface CrmData { contacts: Contact[]; pitches: Pitch[]; templates: Template[]; defaultFollowupDays: number }
export interface LogPitchInput { contactId: number; beatIds: number[]; channel: Pitch['channel']; subject: string; link: string; packId: number | null }
export interface PackRequest { contactId: number | null; title: string; intro: string; beatIds: number[]; deploy: boolean }
export interface PackResult { packId: number; slug: string; url: string | null; deployError: string | null }
export interface NetlifyStatus { hasToken: boolean; siteUrl: string | null; encryptionOk: boolean }

export interface ScanStatus {
  pending: number
  done: number
  total: number
}

export interface Api {
  listBeats(): Promise<Beat[]>
  getBeat(id: number): Promise<BeatDetail | null>
  updateBeat(id: number, patch: BeatPatch): Promise<void>
  setTags(id: number, tags: Record<TagKind, string[]>): Promise<void>
  allTags(): Promise<Record<TagKind, string[]>>
  reanalyze(id: number): Promise<void>
  reveal(id: number): Promise<void>
  openProject(id: number): Promise<void>
  linkProject(id: number): Promise<void>
  getSettings(): Promise<Settings>
  addFolder(kind: 'watchFolders' | 'projectFolders'): Promise<void>
  removeFolder(kind: 'watchFolders' | 'projectFolders', path: string): Promise<void>
  setSetting(patch: Partial<Pick<Settings, 'includeIdeas' | 'ownHandles' | 'producerName' | 'followupDays' | 'notify'>>): Promise<void>
  backup(): Promise<string>
  dataPath(): Promise<string>
  crmAll(): Promise<CrmData>
  saveContact(c: Partial<Contact> & { name: string }): Promise<number>
  deleteContact(id: number): Promise<void>
  logPitch(input: LogPitchInput): Promise<number>
  updatePitch(id: number, patch: { status?: PitchStatus; responseNote?: string; snoozeDays?: number }): Promise<void>
  logFollowup(id: number): Promise<void>
  setPitchBeatResponse(pitchId: number, beatId: number, r: '' | 'liked' | 'passed'): Promise<void>
  deletePitch(id: number): Promise<void>
  saveTemplate(t: Partial<Template> & Pick<Template, 'name' | 'kind' | 'subject' | 'body'>): Promise<number>
  deleteTemplate(id: number): Promise<void>
  buildPack(req: PackRequest): Promise<PackResult>
  openPackLocal(packId: number): Promise<void>
  netlifyStatus(): Promise<NetlifyStatus>
  setNetlifyToken(token: string | null): Promise<void>
  openExternal(url: string): Promise<void>
  onCrmChanged(cb: () => void): () => void
  onNavigate(cb: (view: 'vault' | 'crm') => void): () => void
  onBeatsChanged(cb: (ids: number[]) => void): () => void
  onScanStatus(cb: (s: ScanStatus) => void): () => void
}
