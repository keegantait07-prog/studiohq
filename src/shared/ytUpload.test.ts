import { describe, expect, it } from 'vitest'
import { buildUploadMetadata } from './ytUpload'

const base = { title: 'Future Type Beat 2026', description: 'Buy: https://www.beatstars.com/b', tags: ['future type beat', 'trap'], hashtags: ['#typebeat', '#future'] }
type Meta = { snippet: { title: string; description: string; tags: string[]; categoryId: string }; status: { privacyStatus: string; selfDeclaredMadeForKids: boolean; publishAt?: string } }

describe('buildUploadMetadata', () => {
  const m = buildUploadMetadata(base) as Meta
  it('is always private, never public', () => {
    expect(m.status.privacyStatus).toBe('private')
    expect((buildUploadMetadata({ ...base, publishAt: new Date('2026-11-05T17:00:00Z') }) as Meta).status.privacyStatus).toBe('private')
  })
  it('sets publishAt as an ISO string only when a time is given', () => {
    expect(m.status.publishAt).toBeUndefined()
    expect((buildUploadMetadata({ ...base, publishAt: new Date('2026-11-05T17:00:00Z') }) as Meta).status.publishAt).toBe('2026-11-05T17:00:00.000Z')
  })
  it('puts the hashtags on one final line of the description', () => expect(m.snippet.description).toBe('Buy: https://www.beatstars.com/b\n\n#typebeat #future'))
  it('adds no hashtag line when there are none', () => expect((buildUploadMetadata({ ...base, hashtags: [] }) as Meta).snippet.description).toBe(base.description))
  it('is not made for kids, is in the Music category, and passes the tags through', () => {
    expect(m.status.selfDeclaredMadeForKids).toBe(false)
    expect(m.snippet.categoryId).toBe('10')
    expect(m.snippet.tags).toEqual(base.tags)
    expect(m.snippet.title).toBe(base.title)
  })
})
