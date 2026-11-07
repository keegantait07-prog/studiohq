// Contract every Lead Finder source implements. Sources never throw anything but SourceError for expected failures.
import type { LeadCandidate, LeadSource } from '../../../shared/leads'

export interface SourceCtx {
  fetchFn: typeof fetch
  getKey(name: string): string | null
  now: number
  /** Optional per-search limits from a preset (YouTube uses both). */
  opts?: { maxSubs?: number; days?: number }
}

export interface LeadSourceModule {
  id: LeadSource
  search(query: string, ctx: SourceCtx): Promise<LeadCandidate[]>
}

/** An expected failure whose message is shown to the user verbatim. */
export class SourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceError'
  }
}
