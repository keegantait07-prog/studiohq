import type { ReleaseStep, Status, StepId } from '@shared/types'

export type StepAction = 'store' | 'content' | 'pitch' | 'feedback' | 'splits' | 'sale'

export const STEP_LABEL: Record<StepId, string> = { store: 'Store', video: 'Video', post: 'Post', pitch: 'Pitch', feedback: 'Feedback', splits: 'Splits', sale: 'Sale' }

/** The one button a checklist row offers, or null for a row that does not apply. Each action opens something the app already has. */
export function rowButton(step: ReleaseStep, beatStatus: Status, soldExclusively: boolean): { label: string; action: StepAction; disabled: boolean } | null {
  if (step.state === 'na') return null
  const todo = step.state === 'todo'
  switch (step.id) {
    case 'store': return { label: todo ? 'Put on the store' : 'Manage', action: 'store', disabled: false }
    case 'video':
    case 'post': return { label: todo ? 'Make video, titles and tags…' : 'Open Content…', action: 'content', disabled: false }
    case 'pitch': return beatStatus === 'sold' ? { label: 'Sold. Can’t pitch', action: 'pitch', disabled: true } : { label: 'Pitch this beat…', action: 'pitch', disabled: false }
    case 'feedback': return { label: 'Get timestamped feedback…', action: 'feedback', disabled: false }
    case 'splits': return { label: todo ? 'Add splits' : 'Edit splits', action: 'splits', disabled: false }
    case 'sale': return soldExclusively ? { label: 'Sold exclusively', action: 'sale', disabled: true } : { label: 'Log a sale…', action: 'sale', disabled: false }
  }
}
