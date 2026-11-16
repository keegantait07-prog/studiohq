// Glue shared by Leads, Content and Feedback: the Peak Chart card and the dialog shell. Widgets come from the library
// (components/lib) and crmUi; nothing here is drawn by hand except the dialog frame, which has no library part.
import type { ReactNode } from 'react'
import { PeakChart } from './components/ui/peak-chart'
import type { MadePeriod } from './dashUtils'
import './crm.css'
import './reach.css'

export { Avatar, Button, ExtLink, IconBtn, Num, Reveal, Seg, Tip } from './crmUi'

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
export const SPAN: Record<MadePeriod, string> = { Weekly: 'Last 7 days', Monthly: 'Last 30 days', Yearly: 'Last 12 months' }

/** Peak Chart in the sticky side card all three screens share. `seg` is the screen's own metric switch. */
export function ChartCard({ label, seg, data, labels, value, title, caption, updatedText, accent, period, onPeriod, unit }: {
  label: string; seg?: ReactNode; data: number[]; labels: string[]; value: number; title: string; caption: string; updatedText: string
  accent: string; period: MadePeriod; onPeriod: (p: MadePeriod) => void; unit: (n: number) => string
}) {
  return (
    <div className="rx-peak" aria-label={label}>
      {seg}
      <PeakChart width={300} font="var(--font)" accent={cssVar(accent)} data={data} labels={labels} value={value} valueSuffix="" title={title} caption={caption}
        updatedText={updatedText} trend="none" period={period} onPeriodChange={(x) => onPeriod(x as MadePeriod)} formatValue={(v) => unit(Math.round(v))} />
    </div>
  )
}

/** Dialog frame: keeps .overlay > .modal so the app's focus trap finds it. */
export function Dlg({ title, onClose, closeLabel = 'Cancel', size, children, footer, onKeyDown }: { title: string; onClose: () => void; closeLabel?: string; size?: 'sm' | 'md'; children: ReactNode; footer?: ReactNode; onKeyDown?: (e: React.KeyboardEvent) => void }) {
  return (
    <div className="overlay pc-scrim" onMouseDown={onClose}>
      <div className={`modal pc-dlg${size ? ` ${size}` : ''}`} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <header><h2 className="pc-disp">{title}</h2><button type="button" className="rx-x" onClick={onClose}>{closeLabel}</button></header>
        <div className="pc-bd">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}
