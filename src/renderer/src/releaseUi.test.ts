import { describe, expect, test } from 'vitest'
import type { ReleaseStep, StepId, StepState } from '@shared/types'
import { STEP_LABEL, rowButton } from './releaseUi'

const step = (id: StepId, state: StepState): ReleaseStep => ({ id, state, summary: '' })

describe('rowButton', () => {
  test('a not-applicable row has no button', () => {
    expect(rowButton(step('store', 'na'), 'finished', false)).toBeNull()
    expect(rowButton(step('splits', 'na'), 'finished', false)).toBeNull()
  })
  test('store', () => {
    expect(rowButton(step('store', 'todo'), 'finished', false)).toEqual({ label: 'Put on the store', action: 'store', disabled: false })
    expect(rowButton(step('store', 'done'), 'finished', false)).toEqual({ label: 'Manage', action: 'store', disabled: false })
    expect(rowButton(step('store', 'doing'), 'finished', false)?.label).toBe('Manage')
  })
  test('video and post open Content', () => {
    expect(rowButton(step('video', 'todo'), 'finished', false)).toEqual({ label: 'Make video, titles and tags…', action: 'content', disabled: false })
    expect(rowButton(step('video', 'done'), 'finished', false)).toEqual({ label: 'Open Content…', action: 'content', disabled: false })
    expect(rowButton(step('post', 'doing'), 'finished', false)).toEqual({ label: 'Open Content…', action: 'content', disabled: false })
    expect(rowButton(step('post', 'todo'), 'finished', false)?.label).toBe('Make video, titles and tags…')
  })
  test('pitch is disabled for a sold beat', () => {
    expect(rowButton(step('pitch', 'todo'), 'finished', false)).toEqual({ label: 'Pitch this beat…', action: 'pitch', disabled: false })
    expect(rowButton(step('pitch', 'doing'), 'sold', true)).toEqual({ label: 'Sold. Can’t pitch', action: 'pitch', disabled: true })
  })
  test('feedback', () => {
    expect(rowButton(step('feedback', 'todo'), 'finished', false)).toEqual({ label: 'Get timestamped feedback…', action: 'feedback', disabled: false })
  })
  test('splits', () => {
    expect(rowButton(step('splits', 'todo'), 'finished', false)).toEqual({ label: 'Add splits', action: 'splits', disabled: false })
    expect(rowButton(step('splits', 'doing'), 'finished', false)?.label).toBe('Edit splits')
    expect(rowButton(step('splits', 'done'), 'finished', false)?.label).toBe('Edit splits')
  })
  test('sale is disabled and labelled once sold exclusively', () => {
    expect(rowButton(step('sale', 'todo'), 'finished', false)).toEqual({ label: 'Log a sale…', action: 'sale', disabled: false })
    expect(rowButton(step('sale', 'done'), 'sold', true)).toEqual({ label: 'Sold exclusively', action: 'sale', disabled: true })
  })
})

test('every step has a label', () => {
  expect(Object.keys(STEP_LABEL).sort()).toEqual(['feedback', 'pitch', 'post', 'sale', 'splits', 'store', 'video'])
  expect(STEP_LABEL.pitch).toBe('Pitch')
})
