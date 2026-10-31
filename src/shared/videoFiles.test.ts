import { describe, expect, it } from 'vitest'
import { fileSafeTitle, youtubeFileTitle } from './videoFiles'

describe('fileSafeTitle', () => {
  it('drops characters a file name cannot hold', () => expect(fileSafeTitle('a/b:c*d?"e<f>g|h')).toBe('abcdefgh'))
  it('trims, and falls back to Beat for an empty name', () => {
    expect(fileSafeTitle('  Night Shift ')).toBe('Night Shift')
    expect(fileSafeTitle('///')).toBe('Beat')
  })
})

describe('youtubeFileTitle', () => {
  it('reads the beat name out of a YouTube export file name', () => {
    expect(youtubeFileTitle('OVERDRIVE - YouTube.mp4')).toBe('OVERDRIVE')
    expect(youtubeFileTitle('Night - Shift - YouTube 2.mp4')).toBe('Night - Shift')
    expect(youtubeFileTitle('Beat - YouTube.MP4')).toBe('Beat')
  })
  it('ignores other files', () => {
    expect(youtubeFileTitle('ERDTREE - vertical.mp4')).toBeNull()
    expect(youtubeFileTitle('notes - YouTube.txt')).toBeNull()
    expect(youtubeFileTitle('YouTube.mp4')).toBeNull()
  })
})
