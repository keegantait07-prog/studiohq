// The FL plugin drops a small JSON file here when you press "Save to Studio HQ". The app picks it up at once
// if it's open, or the next time it starts.
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, watch } from 'fs'
import { join } from 'path'

export interface InboxItem { name: string; bpm: number | null; flp: string; kind?: 'bounce'; wav?: string }

export function startInbox(dir: string, handle: (d: InboxItem) => void): void {
  mkdirSync(dir, { recursive: true })
  let timer: NodeJS.Timeout | null = null
  const drain = () => {
    timer = null
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const p = join(dir, f)
      try {
        const j = JSON.parse(readFileSync(p, 'utf8'))
        handle({ kind: j.kind === 'bounce' ? 'bounce' : undefined, wav: j.wav ? String(j.wav) : undefined, name: String(j.name ?? ''), bpm: Number.isFinite(+j.bpm) && +j.bpm > 20 ? +j.bpm : null, flp: String(j.flp ?? '') })
        unlinkSync(p)
      } catch (e) {
        // half-written file: try again on the next change; anything unreadable is removed so it can't loop forever
        try { if (Date.now() - statSync(p).mtimeMs > 60000) unlinkSync(p) } catch { /* gone */ }
        console.error('inbox item skipped', f, e)
      }
    }
  }
  drain()
  try { watch(dir, () => { if (!timer) timer = setTimeout(drain, 250) }) } catch { /* the folder watch is a convenience; startup drain still works */ }
}
