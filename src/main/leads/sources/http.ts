// Shared by the keyed sources (SoundCloud, Audiomack, X): one authenticated GET with every failure mapped to a SourceError.
import { SourceError, type SourceCtx } from './types'

export const MAX_RESULTS = 50

export async function keyedGet(label: string, url: string, authHeader: (key: string) => string, keyName: string, ctx: SourceCtx): Promise<unknown> {
  const key = ctx.getKey(keyName)
  if (!key) throw new SourceError(`Connect ${label} in Settings to search it.`)
  let res: Response
  try {
    res = await ctx.fetchFn(url, { headers: { Authorization: authHeader(key), Accept: 'application/json', 'User-Agent': 'StudioHQ/1.0 (lead finder)' } })
  } catch {
    throw new SourceError(`Could not reach ${label}. Check your connection and try again.`)
  }
  if (res.status === 401 || res.status === 403) throw new SourceError(`Check your ${label} key in Settings.`)
  if (res.status === 429) throw new SourceError(`${label} is limiting requests right now. Retry later.`)
  if (!res.ok) throw new SourceError(`${label} returned an error (${res.status}). Retry later.`)
  try {
    return await res.json()
  } catch {
    throw new SourceError(`${label} sent a reply Studio HQ could not read. Retry later.`)
  }
}

export const asRecords = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
