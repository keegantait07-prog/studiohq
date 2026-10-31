// The videos.insert request body. Uploads are always private; a scheduled one also carries publishAt.
export function buildUploadMetadata(p: { title: string; description: string; tags: string[]; hashtags: string[]; publishAt?: Date }): object {
  const description = p.hashtags.length ? `${p.description}\n\n${p.hashtags.join(' ')}` : p.description
  return {
    snippet: { title: p.title, description, tags: p.tags, categoryId: '10' },
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, ...(p.publishAt ? { publishAt: p.publishAt.toISOString() } : {}) }
  }
}
