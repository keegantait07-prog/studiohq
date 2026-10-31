// Shared shapes for the YouTube type-beat publisher: research, packaging and the publish draft.
export const LINK_PLACEHOLDER = '{{BEATSTARS_LINK}}'

export interface YtVideo { id: string; channelId: string; channelTitle: string; title: string; description: string; tags: string[]; publishedAt: string; views: number }

export interface StyleProfile {
  /** 'global' or an artist name, lower-case */
  scope: string
  sample: number
  title: { medianLength: number; bracketRate: Record<string, number>; yearRate: number; quotedNameRate: number; pairRate: number; separators: Record<string, number>; casing: 'title' | 'lower' | 'upper' | 'mixed'; emojiRate: number }
  description: { medianLines: number; linkLine: number; hashtagBlockRate: number; medianHashtags: number }
  tags: { medianCount: number; medianChars: number; top: string[] }
  hashtags: { medianCount: number; top: string[] }
  examples: { title: string; description: string }[]
}

export interface BeatProfile { title: string; bpm: number | null; key: string | null; genre: string[]; vibe: string[]; artist: string[]; energy: 'low' | 'medium' | 'high' | null }

export interface PackageDraft { titles: string[]; description: string; tags: string[]; hashtags: string[]; source: 'claude' | 'template' }

export interface YtStatus { signedIn: boolean; hasClientId: boolean; hasAnthropicKey: boolean; encryptionOk: boolean; imagesLeft: number | null; quotaToday: number }

export interface PublishDraft { beatId: number; imageHash: string; imagePath: string; videoPath: string; thumbPath: string; artists: string[]; package: PackageDraft; styleFindings: string[] }

/** What the producer settled on in the review screen */
export interface YtPublishEdits { title: string; description: string; tags: string[]; hashtags: string[]; link: string; publishAt?: number }
export interface YtPublishResult { videoId: string; studioUrl: string; thumbnailError?: string }
