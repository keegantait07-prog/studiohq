// Turns site data into the public page. No Electron or database here, so it can be tested directly.
import pageTemplate from './catalog-page.html?raw'
import type { License } from '../shared/types'

export interface PageLicense { name: string; exclusive: boolean; price?: number; files: string; perks: string[] }
export interface PageData { store: string; from: number | null; licenses: PageLicense[]; beats: Record<string, unknown>[] }

/** The "from $X" price: the cheapest lease (non-exclusive) tier that has a price. */
export function fromPrice(licenses: Pick<License, 'exclusive' | 'defaultPrice'>[]): number | null {
  const prices = licenses.filter((l) => !l.exclusive && l.defaultPrice != null).map((l) => l.defaultPrice as number)
  return prices.length ? Math.min(...prices) : null
}

export function pageLicenses(licenses: License[]): PageLicense[] {
  return licenses.map((l) => ({ name: l.name, exclusive: l.exclusive, ...(l.defaultPrice != null ? { price: l.defaultPrice } : {}), files: l.files, perks: l.perks }))
}

/** The finished index.html. `<` is escaped so no text in the data can close the data block. */
export function pageHtml(data: PageData): string {
  return pageTemplate.split('__DATA__').join(JSON.stringify(data).replace(/</g, '\\u003c'))
}
