// Frame sizes for each export format. The presets in vizScene.ts paint the whole frame.
import type { VideoFormat } from './types'
import type { SceneLayout } from './vizScene'

export const LAYOUT: Record<VideoFormat, SceneLayout> = {
  vertical: { W: 1080, H: 1920 },
  horizontal: { W: 1920, H: 1080 }
}

export const sceneLayout = (format: VideoFormat): SceneLayout => LAYOUT[format]

/** The 3:2 stage of a style-wall tile. */
export const TILE_LAYOUT: SceneLayout = { W: 1620, H: 1080 }
