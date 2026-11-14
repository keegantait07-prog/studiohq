export interface TemplateVars {
  name: string
  full_name: string
  my_name: string
  beats: string
  beat_titles: string
  beat_count: number
  link: string
  days: number
  sound: string
  sent_date: string
  subject: string
}

export const PLACEHOLDERS: { key: keyof TemplateVars; help: string }[] = [
  { key: 'name', help: 'Their first name' },
  { key: 'full_name', help: 'Their full name' },
  { key: 'my_name', help: 'Your producer name (Settings)' },
  { key: 'beats', help: 'Bulleted list of beats with BPM and key' },
  { key: 'beat_titles', help: 'Beat titles in one line' },
  { key: 'beat_count', help: 'How many beats' },
  { key: 'link', help: 'Private listening page link' },
  { key: 'days', help: 'Days since you sent the pitch' },
  { key: 'sound', help: 'Their sound, from the contact' },
  { key: 'sent_date', help: 'Date of the original pitch' },
  { key: 'subject', help: 'Original pitch subject' }
]

/** Fills {{placeholders}}. Lines that mention {{link}} are dropped when there is no link. */
export function renderTemplate(text: string, v: Partial<TemplateVars>): string {
  const lines = text.split('\n').filter((l) => v.link || !l.includes('{{link}}'))
  return lines
    .join('\n')
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => {
      const val = (v as Record<string, unknown>)[k]
      return val === undefined || val === null ? m : String(val)
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * What to call someone in an email. Real names give the first word. An Instagram-style handle such as
 * "bc_shooter" or "BC__reno" loses the crew tag, underscores and stray digits and becomes "Shooter" / "Reno".
 */
export function firstName(full: string): string {
  const first = full.trim().split(/\s+/)[0] || full
  if (!/[_\d.]/.test(first)) return first
  const stripped = (first.includes('_') ? first.replace(/^bc/i, '') : first).replace(/[_.]+/g, ' ').replace(/^\d+|\d+$/g, '').trim().split(/\s+/)[0]
  const word = stripped && stripped.length >= 2 ? stripped : first.replace(/[_.]+/g, ' ').trim().split(/\s+/)[0] || first
  return word.charAt(0).toUpperCase() + word.slice(1)
}
