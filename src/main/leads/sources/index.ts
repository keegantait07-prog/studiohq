// Registry of lead sources, looked up by id from leads:search. Add a module here to make it searchable.
import type { LeadSource } from '../../../shared/leads'
import { redditSource } from './reddit'
import type { LeadSourceModule } from './types'

export const SOURCES: Partial<Record<LeadSource, LeadSourceModule>> = {
  reddit: redditSource
}

/** For sources that need a service built at startup (YouTube needs the research client). */
export function registerSource(m: LeadSourceModule): void {
  SOURCES[m.id] = m
}
