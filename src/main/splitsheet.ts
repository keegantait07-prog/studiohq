import { BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import type { SplitRow } from '../shared/types'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export const p2 = (n: number) => n.toFixed(2).replace(/\.?0+$/, '') + '%'

export interface SheetData {
  title: string
  bpm: number | null
  key: string | null
  producer: string
  rows: SplitRow[]
  date: Date
}

export function splitSheetHtml(d: SheetData): string {
  const date = d.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const pub = Math.round(d.rows.reduce((a, r) => a + r.pubPct, 0) * 100) / 100
  const master = Math.round(d.rows.reduce((a, r) => a + r.masterPct, 0) * 100) / 100
  const meta = [d.bpm ? `${Math.round(d.bpm)} BPM` : '', d.key ?? ''].filter(Boolean).join(' · ')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:Letter}
*{box-sizing:border-box}body{font:11pt/1.45 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#111;margin:0}
h1{font-size:24pt;letter-spacing:.06em;margin:0 0 2pt}.sub{color:#555;margin-bottom:18pt}
.box{border:1px solid #bbb;border-radius:6px;padding:10pt 12pt;margin-bottom:16pt;display:grid;grid-template-columns:130pt 1fr;row-gap:4pt}
.box b{color:#555;font-weight:600}
table{width:100%;border-collapse:collapse;margin-bottom:14pt}th,td{border-bottom:1px solid #ddd;padding:6pt 5pt;text-align:left;vertical-align:top;font-size:10pt}
th{font-size:8.5pt;text-transform:uppercase;letter-spacing:.05em;color:#555;border-bottom:2px solid #111}td.n,th.n{text-align:right;white-space:nowrap}
tfoot td{font-weight:700;border-top:2px solid #111;border-bottom:0}.small{color:#666;font-size:9pt}
p{margin:0 0 9pt}.sigs{margin-top:22pt;display:grid;grid-template-columns:1fr 1fr;gap:26pt 30pt;page-break-inside:avoid}
.sig{page-break-inside:avoid}.pair{display:flex;gap:14pt;padding-top:30pt}.ln{flex:1;border-top:1px solid #111;padding-top:3pt;font-size:8.5pt;color:#666}.ln.d{flex:0 0 28%}.who{font-size:10pt;margin-top:2pt}
.foot{margin-top:24pt;color:#888;font-size:8.5pt;border-top:1px solid #ddd;padding-top:6pt}
</style></head><body>
<h1>SPLIT SHEET</h1><div class="sub">Ownership agreement for a musical work</div>
<div class="box"><b>Work title</b><span>${esc(d.title)}</span>
${meta ? `<b>Details</b><span>${esc(meta)}</span>` : ''}<b>Date</b><span>${esc(date)}</span>${d.producer ? `<b>Prepared by</b><span>${esc(d.producer)}</span>` : ''}</div>
<table><thead><tr><th>Name</th><th>Role</th><th>Contact</th><th>PRO / IPI</th><th class="n">Publishing</th><th class="n">Master</th></tr></thead><tbody>
${d.rows.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.role)}</td><td>${esc(r.email) || '&mdash;'}</td><td>${esc([r.pro, r.ipi].filter(Boolean).join(' / ')) || '&mdash;'}</td><td class="n">${p2(r.pubPct)}</td><td class="n">${p2(r.masterPct)}</td></tr>`).join('\n')}
</tbody><tfoot><tr><td colspan="4">Total</td><td class="n">${p2(pub)}</td><td class="n">${p2(master)}</td></tr></tfoot></table>
<p>The undersigned agree that ownership of the musical composition ("Publishing") and of the sound recording ("Master") of the work named above is divided among them in the percentages shown. Each person's share applies to income from the work in every territory and medium unless they agree otherwise in writing.</p>
<p>Each signatory confirms that their contribution is original or properly licensed, and agrees to be credited as listed. Any change to these splits must be agreed in writing by every person listed.</p>
<div class="sigs">${d.rows.map((r) => `<div class="sig"><div class="pair"><div class="ln">Signature</div><div class="ln d">Date</div></div><div class="who"><b>${esc(r.name)}</b> (${esc(r.role)})</div></div>`).join('\n')}</div>
<div class="foot">This sheet records the parties' agreement. It is not legal advice; consult an entertainment attorney for contract questions. Created with Studio HQ.</div>
</body></html>`
}

export async function writePdf(html: string, path: string): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, margins: { top: 0.7, bottom: 0.7, left: 0.8, right: 0.8 } })
    writeFileSync(path, pdf)
  } finally {
    win.destroy()
  }
}
