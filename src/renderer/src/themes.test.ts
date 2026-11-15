import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, THEMES } from './themes'

describe('themes', () => {
  it('ships Deck as the only theme and the default', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['deck'])
    expect(DEFAULT_THEME).toBe('deck')
  })
})
