// Minimal Standard MIDI File (format 1) writer: one tempo track plus one track per instrument.
import type { FlpNote } from './flp'

const vlq = (n: number): number[] => {
  const out = [n & 0x7f]
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80)
  return out
}
const u16 = (n: number) => [(n >> 8) & 255, n & 255]
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

function chunk(id: string, data: number[]): number[] {
  return [...Buffer.from(id, 'ascii'), ...u32(data.length), ...data]
}
const meta = (delta: number, type: number, data: number[]) => [...vlq(delta), 0xff, type, ...vlq(data.length), ...data]

export function writeMidi(ppq: number, bpm: number, tracks: { name: string; notes: FlpNote[] }[]): Buffer {
  const tempo = meta(0, 0x51, u32(Math.round(60_000_000 / bpm)).slice(1))
  const conductor = [...meta(0, 0x03, [...Buffer.from('Studio HQ')]), ...tempo, ...meta(0, 0x58, [4, 2, 24, 8]), ...meta(0, 0x2f, [])]
  const body: number[][] = [chunk('MTrk', conductor)]
  for (const t of tracks) {
    type Ev = { tick: number; on: boolean; key: number; vel: number }
    const evs: Ev[] = []
    for (const n of t.notes) {
      const key = Math.max(0, Math.min(127, n.key))
      const vel = n.vel > 0 && n.vel <= 127 ? n.vel : 100 // FL stores 128 for "default"
      evs.push({ tick: n.pos, on: true, key, vel }, { tick: n.pos + Math.max(1, n.len), on: false, key, vel: 0 })
    }
    evs.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on)) // note-offs first at the same tick
    const data: number[] = [...meta(0, 0x03, [...Buffer.from(t.name.slice(0, 100) || 'Track', 'utf8')])]
    let last = 0
    for (const e of evs) { data.push(...vlq(e.tick - last), e.on ? 0x90 : 0x80, e.key, e.vel); last = e.tick }
    data.push(...meta(0, 0x2f, []))
    body.push(chunk('MTrk', data))
  }
  return Buffer.from([...chunk('MThd', [...u16(1), ...u16(body.length), ...u16(ppq)]), ...body.flat()])
}
