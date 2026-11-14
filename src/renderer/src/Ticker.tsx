/** The slow scrolling strip of numbers at the top of Pitch CRM, Leads and Content. Pure decoration: screen readers get the plain summary. */
export interface TickerItem { n: number | string; label: string }

export function Ticker({ items, inline }: { items: TickerItem[]; inline?: boolean }) {
  if (!items.length) return null
  const run = items.map((t) => (
    <span key={t.label} className="tk-item"><b>{t.n}</b><i>{t.label}</i>{inline && <u aria-hidden>◆</u>}</span>
  ))
  return (
    <div className={`ticker ${inline ? 'inline' : ''}`} role="group" aria-label={items.map((t) => `${t.n} ${t.label}`).join(', ')}>
      <div className="tk-track" aria-hidden>{run}{run}{run}{run}</div>
    </div>
  )
}
