// Reads the parts of an FL Studio project (.flp) we need: referenced sample files and piano-roll notes.
// The format is a flat stream of events; anything unexpected stops the parse and keeps what was read so far.
export interface FlpNote { pos: number; len: number; key: number; vel: number; rack: number }
export interface FlpPattern { id: number; name: string; notes: FlpNote[] }
export interface FlpSample { ref: string; channel: string }
export interface ParsedFlp { ppq: number; version: string; tempo: number | null; samples: FlpSample[]; channels: Map<number, string>; patterns: FlpPattern[]; partial: boolean }

const NOTE_SIZE = 24

export function parseFlp(b: Buffer): ParsedFlp {
  if (b.length < 22 || b.toString('ascii', 0, 4) !== 'FLhd') throw new Error('Not an FL Studio project')
  const hdr = b.readUInt32LE(4)
  const ppq = b.readUInt16LE(12) || 96
  let pos = 8 + hdr
  if (b.toString('ascii', pos, pos + 4) !== 'FLdt') throw new Error('Project data not found')
  const end = Math.min(b.length, pos + 8 + b.readUInt32LE(pos + 4))
  pos += 8

  let unicode = true
  let version = ''
  let tempo: number | null = null
  let partial = false
  let curChan = -1
  let curPat = 0
  const channels = new Map<number, string>()
  const samples: { ref: string; chan: number }[] = []
  const pats = new Map<number, FlpPattern>()
  const pat = (id: number): FlpPattern => pats.get(id) ?? pats.set(id, { id, name: '', notes: [] }).get(id)!
  const text = (a: number, z: number) => (unicode ? b.toString('utf16le', a, z) : b.toString('latin1', a, z)).split('\0')[0]

  while (pos < end) {
    const id = b[pos++]
    let len: number
    if (id < 64) len = 1
    else if (id < 128) len = 2
    else if (id < 192) len = 4
    else {
      len = 0
      let shift = 0, byte = 0, n = 0
      do { byte = b[pos++]; len += (byte & 0x7f) * 2 ** shift; shift += 7; n++ } while (byte & 0x80 && n < 5)
      if (n > 4 || len < 0 || pos + len > end) { partial = true; break }
    }
    if (pos + len > end) { partial = true; break }
    switch (id) {
      case 199: { version = b.toString('ascii', pos, pos + len).split('\0')[0]; const major = parseInt(version, 10); if (!isNaN(major)) unicode = major >= 12; break }
      case 156: if (len === 4) { const t = b.readUInt32LE(pos) / 1000; if (t >= 30 && t <= 300) tempo = t; break } else break
      case 64: curChan = b.readUInt16LE(pos); break
      case 65: curPat = b.readUInt16LE(pos); break
      case 192: case 203: { const n = text(pos, pos + len); if (curChan >= 0 && n && (id === 203 || !channels.has(curChan))) channels.set(curChan, n); break }
      case 193: if (curPat > 0) pat(curPat).name = text(pos, pos + len); break
      case 196: { const ref = text(pos, pos + len); if (ref) samples.push({ ref, chan: curChan }); break }
      case 224: {
        if (curPat > 0) {
          const p = pat(curPat)
          for (let o = pos; o + NOTE_SIZE <= pos + len; o += NOTE_SIZE) {
            p.notes.push({ pos: b.readUInt32LE(o), rack: b.readUInt16LE(o + 6), len: b.readUInt32LE(o + 8), key: b.readUInt16LE(o + 12), vel: b[o + 21] })
          }
        }
        break
      }
    }
    pos += len
  }

  const seen = new Set<string>()
  const uniq: FlpSample[] = []
  for (const s of samples) {
    if (seen.has(s.ref)) continue
    seen.add(s.ref)
    uniq.push({ ref: s.ref, channel: channels.get(s.chan) ?? '' })
  }
  return { ppq, version, tempo, samples: uniq, channels, patterns: [...pats.values()].filter((p) => p.notes.length).sort((a, c) => a.id - c.id), partial }
}
