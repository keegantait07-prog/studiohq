// Picks images that have never been used for a video. "Same picture" is judged by a difference hash, so a re-saved or resized copy still counts.

/** 64-bit difference hash of a 9x8 grayscale picture: one bit per pixel pair, set when the left pixel is brighter. */
export function dHash(gray: Uint8Array): string {
  if (gray.length !== 72) throw new Error('dHash needs a 9x8 grayscale buffer (72 bytes).')
  let hex = ''
  for (let y = 0; y < 8; y++) {
    let byte = 0
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0)
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

export function hamming(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

export function isDuplicate(hash: string, used: string[], maxDistance = 4): boolean {
  return used.some((u) => hamming(hash, u) <= maxDistance)
}

export interface PoolFile { path: string; mtime: number; hash: string }

/** The oldest file that is not a copy of anything already used. */
export function pickNext(files: PoolFile[], used: string[]): { path: string; hash: string } | null {
  const f = [...files].sort((a, b) => a.mtime - b.mtime).find((x) => !isDuplicate(x.hash, used))
  return f ? { path: f.path, hash: f.hash } : null
}

/** How many distinct unused pictures the folder holds; near-identical files count once. */
export function unusedCount(files: PoolFile[], used: string[]): number {
  const seen = [...used]
  let n = 0
  for (const f of [...files].sort((a, b) => a.mtime - b.mtime)) {
    if (isDuplicate(f.hash, seen)) continue
    seen.push(f.hash)
    n++
  }
  return n
}

/** The centred 16:9 region of a picture. */
export function cropTo169(w: number, h: number): { x: number; y: number; width: number; height: number } {
  if (w * 9 === h * 16) return { x: 0, y: 0, width: w, height: h }
  if (w * 9 > h * 16) {
    const width = Math.round((h * 16) / 9)
    return { x: Math.round((w - width) / 2), y: 0, width, height: h }
  }
  const height = Math.round((w * 9) / 16)
  return { x: 0, y: Math.round((h - height) / 2), width: w, height }
}
