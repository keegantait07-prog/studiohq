// The decisions behind BPM and key detection, kept apart from the worker so they can be tested.

const fold = (b: number) => {
  while (b < 75) b *= 2
  while (b >= 180) b /= 2
  return b
}
const tidy = (b: number) => (Math.abs(b - Math.round(b)) < 0.15 ? Math.round(b) : Math.round(b * 10) / 10)
const near = (x: number, y: number) => Math.abs(x - y) / y < 0.03

/**
 * Two tempo estimators vote. When one reads exactly half of the other it is a half-time error, not a real
 * disagreement, so the faster reading wins, flagged low so the ×2 and ÷2 buttons stay in view.
 */
export function reconcileBpm(percival: number, rhythm: number): { bpm: number; confidence: 'high' | 'low' } {
  const a = fold(percival), b = fold(rhythm)
  if (near(a, b)) return { bpm: tidy(b), confidence: 'high' }
  if (near(a * 2, b)) return { bpm: tidy(b), confidence: 'low' }
  if (near(b * 2, a)) return { bpm: tidy(a), confidence: 'low' }
  return { bpm: tidy(a), confidence: 'low' }
}

/** Measured on 62 beats with the key in their filename: 88% right at or above this strength, 68% below it. */
const KEY_STRENGTH_HIGH = 0.8
export const keyConfidence = (strength: number): 'high' | 'low' => (strength >= KEY_STRENGTH_HIGH ? 'high' : 'low')
