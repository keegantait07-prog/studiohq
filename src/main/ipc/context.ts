import type { BrowserWindow } from 'electron'
import type { Store } from '../store'
import type { Watcher } from '../watcher'
import type { Crm } from '../crm'
import type { Leads } from '../leads'
import type { Packs } from '../packs'
import type { Catalog } from '../catalog'
import type { Sales } from '../sales'
import type { Content } from '../content'
import type { Sounds } from '../sounds'
import type { ProjectIndex } from '../flpindex'
import type { Feedback } from '../feedback'
import type { Sessions } from '../sessions'
import type { VideoExporter } from '../video'
import type { YtAuth } from '../ytauth'
import type { YtPublisher } from '../ytpublisher'
import type { Threads } from '../assistant/threads'
import type { AssistantService } from '../assistant/service'

export type FolderKind = 'watchFolders' | 'loopFolders' | 'projectFolders' | 'soundFolders'

/**
 * Everything the IPC handlers need from the running app. The services are created during startup, so these are
 * read lazily (getters) — a handler always sees the current instance.
 */
export interface IpcCtx {
  readonly win: BrowserWindow | null
  readonly store: Store
  readonly watcher: Watcher
  readonly loopWatcher: Watcher
  readonly crm: Crm
  readonly leads: Leads
  readonly packs: Packs
  readonly catalog: Catalog
  readonly sales: Sales
  readonly content: Content
  readonly sounds: Sounds
  readonly projectIndex: ProjectIndex
  readonly feedback: Feedback
  readonly sessions: Sessions
  readonly videos: VideoExporter
  readonly ytAuth: YtAuth
  readonly yt: YtPublisher
  readonly threads: Threads
  readonly assistant: AssistantService
  restartWatchers(): Promise<unknown>
  sendCrm(): void
  reindexProjects(): Promise<{ added: number; total: number }>
  scanLibrary(): Promise<void>
  sendFeedback(): void
  syncFeedback(quiet: boolean): Promise<{ added: number; error: string | null }>
  backupNow(): Promise<string>
  writeBridgeConfig(): void
}
