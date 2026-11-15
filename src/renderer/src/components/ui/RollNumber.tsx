/** Digits that roll to their new value. Each digit is a 0-9 column slid into place; other characters stay put. */
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

export function RollNumber({ value }: { value: string | number }) {
  const text = String(value)
  return (
    <span className="rn" aria-label={text} role="text">
      {Array.from(text).map((ch, i, all) => {
        const key = all.length - i // keyed from the right so a digit keeps its column when the number grows
        return /\d/.test(ch)
          ? <span key={key} className="rn-d" aria-hidden="true"><span className="rn-col" style={{ ['--d' as string]: ch }}>{DIGITS.map((d) => <span key={d}>{d}</span>)}</span></span>
          : <span key={key} className="rn-s" aria-hidden="true">{ch}</span>
      })}
    </span>
  )
}
