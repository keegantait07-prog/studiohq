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
}

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
  setSetting(patch: Partial<Pick<Settings, 'includeIdeas' | 'ownHandles'>>): Promise<void>
  backup(): Promise<string>
  dataPath(): Promise<string>
  onBeatsChanged(cb: (ids: number[]) => void): () => void
  onScanStatus(cb: (s: ScanStatus) => void): () => void
}
