import type { PublishDraft, SavedDraft, YtDraftEdits, YtPublishEdits, YtPublishResult, YtStatus } from './ytTypes'
import type { VizFeatures } from './vizFeatures'
import type { SceneLayout } from './vizScene'
import type { AssistantEvent, ApprovalRequest } from './assistantTypes'
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
  /** FL-project beats only: a loop captured by the plugin so the beat can still be heard */
  hasPreview: boolean
  thumb: number[]
  coverPath: string | null
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

/** The two vaults: finished beats, and the loops you send to other producers. */
export type VaultKind = 'beat' | 'loop'

export interface Settings {
  watchFolders: string[]
  loopFolders: string[]
  projectFolders: string[]
  includeIdeas: boolean
  ownHandles: string[]
  producerName: string
  followupDays: number
  notify: boolean
  storeUrl: string
  contactEmail: string
  hashtags: string
  exportDir: string
  soundFolders: string[]
  goalBeats: number
  goalPitches: number
  goalPosts: number
  autoTrackFL: boolean
  includeMidiPacks: boolean
  /** FL projects saved within this many days appear in the Vault as beats (0 = every project) */
  projectBeatDays: number
  /** YouTube channels to study: a name, @handle, URL or channel ID each */
  ytSeedChannels: string[]
  ytImageFolder: string
  ytClientId: string
  claudePath: string
}

// ---- Sound Library ----
export const SOUND_KINDS = ['kick', 'snare', 'clap', 'hat', 'perc', '808', 'bass', 'loop', 'melody', 'vocal', 'fx', 'midi', 'other'] as const
export type SoundKind = (typeof SOUND_KINDS)[number]
/** compact row: the library holds ~20k of these */
export interface SoundRow { id: number; n: string; d: number; e: string; u: number | null; k: SoundKind; f: boolean; b: number | null; y: string | null; t: string[]; s: number; m: number | null }
/** One FL Studio project's own section: the sounds it uses and the MIDI pulled from its patterns */
export interface ProjectSection {
  id: number
  name: string
  path: string
  mtime: number
  partial: boolean
  error: string | null
  beatTitle: string | null
  samples: number[]
  midis: number[]
  missing: { name: string; channel: string; ref: string }[]
  /** how many of the samples were matched by file name rather than by their original path */
  byName: number
}
// ---- FL project cleanup ----
export interface CleanupItem {
  id: number            // flp_projects id
  name: string
  path: string
  mtime: number
  size: number
  samples: number
  midis: number
  /** audio bounces linked to this project: it has been exported */
  bounces: number
  /** a beat in the vault: lets us show status, key, tempo and tags */
  beatId: number | null
  groupId: number | null
  title: string | null
  status: Status | null
  bpm: number | null
  key: string | null
  thumb: number[]
  hasPreview: boolean
  /** a beat id that has audio to play: an exported bounce, else the captured loop */
  playId: number | null
  backups: number
  backupBytes: number
}
export interface CleanupResult { trashed: number; bytes: number; backups: number; failed: string[] }

// ---- Plugin manager ----
export type PluginFormat = 'vst2' | 'vst3' | 'au' | 'aax'
export type Confidence = 'exact' | 'likely' | 'maybe'
export type HealthKind = 'crash' | 'fl-error' | 'arch' | 'quarantine' | 'signature' | 'broken-bundle' | 'duplicate' | 'stale-fl-db' | 'missing-content'
export type FixKind = 'disable' | 'unquarantine' | 'resign' | 'remove-bundle' | 'clear-fl-entry'
export interface PluginBundle { path: string; format: PluginFormat; size: number; archs: string[]; bundleId: string; version: string }
export interface PluginInfo { id: number; name: string; vendor: string; bundles: PluginBundle[]; totalSize: number; health: 'ok' | 'warn' | 'bad' | 'disabled' }
export interface PluginFile { path: string; size: number; confidence: Confidence; location: string }
/** pluginId is null for problems with no installed plugin behind them (e.g. a stale entry in FL's own plugin list). path is the one file/bundle a fix acts on, when it is not the whole plugin. */
export interface HealthFinding { id: number; pluginId: number | null; name: string; path: string; kind: HealthKind; severity: 'warn' | 'bad'; detail: string; certainty: 'confirmed' | 'likely'; fix: FixKind | null }
export interface RemoveManyResult { plugins: number; removed: number; bytes: number; skipped: string[]; failed: string[]; declined: boolean }
export interface RemoveResult { removed: number; bytes: number; skipped: string[]; failed: string[]; declined?: boolean }
export interface SoundList { dirs: string[]; items: SoundRow[]; projects: ProjectSection[]; roots: string[] }
export interface SoundStatus { phase: 'scanning' | 'reading' | 'hashing' | 'idle'; done: number; total: number }
export interface DupGroup { hash: string; size: number; files: { id: number; path: string; mtime: number; fav: boolean }[] }

// ---- Feedback links ----
export interface FeedbackLink { id: number; slug: string; title: string; url: string | null; createdAt: number; deployedAt: number | null; beats: { beatId: number; title: string; duration: number | null }[] }
export interface FeedbackComment { id: string; slug: string; beatId: number | null; beatIndex: number; name: string; time: number; text: string; createdAt: number; seen: boolean; resolved: boolean }
export interface FeedbackData { links: FeedbackLink[]; comments: FeedbackComment[] }
export interface FeedbackRequest { title: string; intro: string; beatIds: number[] }

// ---- Dashboard ----
export interface StudioSession { id: number; startedAt: number; endedAt: number | null; auto: boolean }

// ---- Content Machine ----
export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'shorts' | 'other'
export const PLATFORMS: { id: Platform; label: string; color: string }[] = [
  { id: 'tiktok', label: 'TikTok', color: '#25c7d9' },
  { id: 'instagram', label: 'Instagram Reels', color: '#e87ba4' },
  { id: 'youtube', label: 'YouTube', color: '#e34948' },
  { id: 'shorts', label: 'YouTube Shorts', color: '#eda100' },
  { id: 'other', label: 'Other', color: '#8b8f98' }
]
export interface Post { id: number; beatId: number; platform: Platform; status: 'planned' | 'posted'; date: number; url: string; caption: string }
export type VideoFormat = 'vertical' | 'horizontal'
export type VizStyle = 'lab' | 'tape' | 'riso' | 'cover' | 'vinyl' | 'ridge' | 'phosphor' | 'score' | 'led' | 'ink' | 'typewriter' | 'bauhaus'
/** How the whole frame moves behind the visualizer. */
export type VideoMotion = 'still' | 'drift' | 'breathe' | 'beat'
/** Title layers drawn over the preset: none, an intro slate, or the slate plus an end card. */
export type VideoTitles = 'none' | 'intro' | 'both'
export interface VideoOptions {
  beatId: number
  formats: VideoFormat[]
  viz: VizStyle
  motion?: VideoMotion
  accent: string
  title: string
  tagline: string
  footer: string
  titles?: VideoTitles
  /** the end card's call to action */
  cta?: string
  start: number
  /** seconds, 0 = the whole beat from `start` */
  length: number
}
/** One export's drawing job, handed to the hidden window that renders the frames. */
export interface VizJob { id: number; style: VizStyle; accent: string; motion: VideoMotion; titles: VideoTitles; layout: SceneLayout; features: VizFeatures; meta: { title: string; tagline: string; footer: string; cta: string; bpm: number | null; key: string | null; cover: string | null } }
export interface VideoExport { id: number; beatId: number; format: VideoFormat | 'youtube'; path: string; createdAt: number }
/** A finished video as the Videos tab shows it: the record plus what is on disk now */
export interface VideoFile { id: number; beatId: number; beatTitle: string; format: VideoExport['format']; path: string; createdAt: number; size: number; exists: boolean
  /** YouTube videos only: whether saved details exist and whether the video was uploaded */
  youtube?: { hasDraft: boolean; uploaded: YtPublishResult | null } }
export interface ContentData { posts: Post[]; videos: VideoExport[] }
export interface VideoProgress { label: string; pct: number }

// ---- Sales & Collabs ----
export type SaleSource = 'beatstars' | 'paypal' | 'venmo' | 'cashapp' | 'zelle' | 'other'
export const SALE_SOURCES: SaleSource[] = ['beatstars', 'paypal', 'venmo', 'cashapp', 'zelle', 'other']
export interface License { id: number; name: string; exclusive: boolean; defaultPrice: number | null }
export interface Sale {
  id: number
  beatId: number
  groupId: number
  beatTitle: string
  buyer: string
  buyerEmail: string
  contactId: number | null
  licenseName: string
  exclusive: boolean
  price: number
  fee: number
  source: SaleSource
  soldAt: number
  notes: string
}
export interface LogSaleInput {
  beatId: number
  buyer: string
  buyerEmail: string
  contactId: number | null
  licenseId: number | null
  licenseName: string
  exclusive: boolean
  price: number
  fee: number
  source: SaleSource
  soldAt: number
  notes: string
}
export type SplitRole = 'producer' | 'writer' | 'artist' | 'other'
export const SPLIT_ROLES: SplitRole[] = ['producer', 'writer', 'artist', 'other']
export interface SplitRow { name: string; role: SplitRole; email: string; pro: string; ipi: string; pubPct: number; masterPct: number }
export interface SplitGroup { groupId: number; beatId: number; title: string; count: number; parties: number; pubTotal: number; masterTotal: number; sheetAt: number | null }
export interface SalesData { sales: Sale[]; licenses: License[]; groups: SplitGroup[] }

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
export interface PitchBeat { beatId: number; title: string; bpm: number | null; key: string | null; status: Status; response: '' | 'liked' | 'passed' }
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
export interface SiteEntry { beatId: number; title: string; genre: string; co: string[]; link: string; addedAt: number }
export interface SitePatch { title?: string; genre?: string; link?: string; co?: string[] }
export interface SiteStatus { url: string | null; hasToken: boolean; entries: SiteEntry[]; pending: boolean }

export interface NetlifyStatus { hasToken: boolean; siteUrl: string | null; encryptionOk: boolean }

export interface ScanStatus {
  pending: number
  done: number
  total: number
}

export interface ThreadSummary { id: number; title: string; updatedAt: number }
export type ThreadMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'tool'; name: string; input: unknown; isError: boolean }
export interface ThreadDetail extends ThreadSummary { messages: ThreadMessage[] }
export type AssistantPush =
  | { threadId: number; event: AssistantEvent }
  | { threadId: number; approval: ApprovalRequest }

export interface Api {
  listBeats(): Promise<Beat[]>
  listLoops(): Promise<Beat[]>
  getBeat(id: number): Promise<BeatDetail | null>
  updateBeat(id: number, patch: BeatPatch): Promise<void>
  setTags(id: number, tags: Record<TagKind, string[]>): Promise<void>
  allTags(kind?: VaultKind): Promise<Record<TagKind, string[]>>
  reanalyze(id: number): Promise<void>
  reveal(id: number): Promise<void>
  openProject(id: number): Promise<void>
  linkProject(id: number): Promise<void>
  getSettings(): Promise<Settings>
  addFolder(kind: 'watchFolders' | 'loopFolders' | 'projectFolders' | 'soundFolders'): Promise<void>
  removeFolder(kind: 'watchFolders' | 'loopFolders' | 'projectFolders' | 'soundFolders', path: string): Promise<void>
  setSetting(patch: Partial<Pick<Settings, 'includeIdeas' | 'ownHandles' | 'producerName' | 'followupDays' | 'notify' | 'storeUrl' | 'contactEmail' | 'hashtags' | 'goalBeats' | 'goalPitches' | 'goalPosts' | 'autoTrackFL' | 'includeMidiPacks' | 'projectBeatDays' | 'ytSeedChannels' | 'ytImageFolder' | 'ytClientId' | 'claudePath'>>): Promise<void>
  backup(): Promise<string>
  exportCsv(): Promise<string | null>
  dataPath(): Promise<string>
  soundsList(): Promise<SoundList>
  soundsScan(): Promise<void>
  soundsTag(ids: number[], add: string[], remove: string[]): Promise<void>
  soundsFav(ids: number[], fav: boolean): Promise<void>
  soundsDuplicates(): Promise<DupGroup[]>
  soundsTrash(ids: number[]): Promise<number>
  soundsReveal(id: number): Promise<void>
  projectOpen(id: number): Promise<void>
  cleanupList(): Promise<CleanupItem[]>
  cleanupTrash(ids: number[], withBackups: boolean): Promise<CleanupResult>
  pluginsList(): Promise<PluginInfo[]>
  pluginsScan(): Promise<PluginInfo[]>
  pluginFiles(id: number): Promise<PluginFile[]>
  pluginsRemove(id: number, paths: string[]): Promise<RemoveResult>
  pluginsHealth(): Promise<HealthFinding[]>
  pluginsFindings(): Promise<HealthFinding[]>
  pluginsFixPreview(findingId: number): Promise<string>
  pluginsFixApply(findingId: number): Promise<{ error?: string }>
  pluginsFixApplyMany(findingIds: number[]): Promise<{ applied: number; failed: string[] }>
  pluginsRemoveMany(items: { id: number; paths: string[] }[]): Promise<RemoveManyResult>
  pluginsDisabled(): Promise<{ actionId: number; name: string; originalPath: string; at: number }[]>
  pluginsRestore(actionIds: number[]): Promise<{ restored: number; failed: string[] }>
  pluginReveal(path: string): Promise<void>
  reindexProjects(): Promise<{ added: number; total: number }>
  projectReveal(id: number): Promise<void>
  startDrag(kind: 'sound' | 'beat', ids: number[]): void
  onSoundsStatus(cb: (s: SoundStatus) => void): () => void
  onSoundsChanged(cb: () => void): () => void
  feedbackAll(): Promise<FeedbackData>
  buildFeedback(req: FeedbackRequest): Promise<PackResult>
  feedbackSync(): Promise<{ added: number; error: string | null }>
  feedbackUpdate(id: string, patch: { seen?: boolean; resolved?: boolean }): Promise<void>
  feedbackMarkAllSeen(): Promise<void>
  onFeedbackChanged(cb: () => void): () => void
  sessionsAll(): Promise<StudioSession[]>
  startSession(): Promise<void>
  stopSession(): Promise<void>
  contentAll(): Promise<ContentData>
  videosList(): Promise<VideoFile[]>
  videoOpen(id: number): Promise<void>
  videoReveal(id: number): Promise<void>
  videoTrash(id: number): Promise<void>
  savePost(p: Partial<Post> & Pick<Post, 'beatId' | 'platform' | 'status' | 'date'>): Promise<number>
  deletePost(id: number): Promise<void>
  exportVideo(o: VideoOptions): Promise<string[]>
  cancelVideo(): Promise<void>
  coverData(beatId: number): Promise<string | null>
  saveCover(beatId: number, pngDataUrl: string): Promise<boolean>
  chooseCover(beatId: number): Promise<boolean>
  clearCover(beatId: number): Promise<void>
  revealPath(path: string): Promise<void>
  chooseExportDir(): Promise<void>
  onVideoProgress(cb: (p: VideoProgress) => void): () => void
  // ---- YouTube publisher ----
  ytStatus(): Promise<YtStatus>
  ytSuggestArtists(beatId: number): Promise<string[]>
  ytPrepare(beatId: number, artists: string[]): Promise<PublishDraft>
  ytPublish(draft: PublishDraft, edits: YtPublishEdits): Promise<YtPublishResult>
  ytLoadDraft(videoId: number): Promise<SavedDraft>
  ytSaveEdits(videoId: number, edits: YtDraftEdits): Promise<void>
  ytSignIn(): Promise<void>
  ytSignOut(): Promise<void>
  ytSetSecret(kind: 'google' | 'anthropic', value: string | null): Promise<void>
  ytChooseImageFolder(): Promise<void>
  ytOpenStudio(url: string): Promise<void>
  onYtProgress(cb: (p: VideoProgress) => void): () => void
  /** The analysed timeline the visualizer scenes draw from, for a clip of a beat. */
  vizFeatures(beatId: number, start: number, length: number): Promise<VizFeatures>
  /** Only used by the hidden export window that draws the frames. */
  vizWorker: {
    onJob(cb: (j: VizJob) => void): () => void
    onRender(cb: (r: { id: number; from: number; to: number }) => void): () => void
    /** `encoder` is true when this window can encode H.264 itself (WebCodecs, via Mediabunny). */
    ready(id: number, error?: string, encoder?: boolean): void
    frame(id: number, i: number, rgba: Uint8Array): void
    /** Encode every frame of the job to MP4 here, streaming the file to main. */
    onEncode(cb: (r: { id: number; frames: number }) => void): () => void
    chunk(id: number, position: number, data: Uint8Array): void
    progress(id: number, done: number): void
    done(id: number, error?: string): void
  }
  salesAll(): Promise<SalesData>
  logSale(input: LogSaleInput): Promise<number>
  updateSale(id: number, patch: Partial<Pick<Sale, 'buyer' | 'buyerEmail' | 'price' | 'fee' | 'source' | 'soldAt' | 'notes'>>): Promise<void>
  deleteSale(id: number): Promise<void>
  saveLicense(l: Partial<License> & { name: string; exclusive: boolean }): Promise<number>
  deleteLicense(id: number): Promise<void>
  getSplits(groupId: number): Promise<{ rows: SplitRow[]; known: SplitRow[] }>
  saveSplits(groupId: number, rows: SplitRow[]): Promise<void>
  exportSplitSheet(groupId: number): Promise<string | null>
  exportSalesCsv(): Promise<string | null>
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
  siteStatus(): Promise<SiteStatus>
  siteAdd(beatId: number): Promise<string>
  siteUpdate(beatId: number, patch: SitePatch): Promise<void>
  siteRemove(beatId: number): Promise<string>
  sitePublish(): Promise<string>
  onSiteProgress(cb: (step: string) => void): () => void
  onCrmChanged(cb: () => void): () => void
  onNavigate(cb: (view: 'dashboard' | 'vault' | 'loops' | 'crm' | 'sales' | 'content' | 'sounds' | 'feedback') => void): () => void
  onBeatsChanged(cb: (ids: number[]) => void): () => void
  onScanStatus(cb: (s: ScanStatus) => void): () => void
  assistantThreads(): Promise<ThreadSummary[]>
  assistantThread(id: number): Promise<ThreadDetail | null>
  assistantNew(): Promise<number>
  assistantSend(threadId: number, text: string): Promise<{ error?: string }>
  assistantStop(threadId: number): Promise<void>
  assistantApprove(approvalId: string, approved: boolean): Promise<void>
  onAssistant(cb: (p: AssistantPush) => void): () => void
}
