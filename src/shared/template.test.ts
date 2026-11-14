import { describe, expect, it } from 'vitest'
import { firstName } from './template'

describe('firstName', () => {
  it('keeps the first word of a real name', () => {
    expect(firstName('Alex Rivera')).toBe('Alex')
    expect(firstName('Drake')).toBe('Drake')
  })
  it('drops the bc crew tag and underscores from handles', () => {
    expect(firstName('bc_shooter')).toBe('Shooter')
    expect(firstName('bc__demon')).toBe('Demon')
    expect(firstName('BC__reno')).toBe('Reno')
    expect(firstName('bcyoungin_')).toBe('Youngin')
    expect(firstName('bc_leelobwo')).toBe('Leelobwo')
  })
  it('cleans other handles and never returns an empty name', () => {
    expect(firstName('yung_kid99')).toBe('Yung')
    expect(firstName('bc_')).toBe('Bc')
    expect(firstName('_')).not.toBe('')
  })
})
