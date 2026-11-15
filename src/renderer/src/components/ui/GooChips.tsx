export type GooChip = { id: string; label: string; on?: boolean; disabled?: boolean; title?: string; onClick: () => void }

/** Chips whose filled shape stretches toward its neighbour when toggled. The shapes sit in a layer under the buttons so the SVG filter never touches the text. */
export function GooChips({ chips }: { chips: GooChip[] }) {
  return (
    <div className="dk-chips">
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
        <filter id="dk-goo" x="-20%" y="-40%" width="140%" height="180%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
        </filter>
      </svg>
      <div className="dk-blobs" aria-hidden="true">
        {chips.map((c) => <i key={c.id} className={`dk-blob ${c.on ? 'on' : ''} ${c.disabled ? 'off' : ''}`}>{c.label}</i>)}
      </div>
      {chips.map((c) => (
        <button key={c.id} className={`dk-chip ${c.on ? 'on' : ''}`} onClick={c.onClick} aria-pressed={c.on === undefined ? undefined : c.on} disabled={c.disabled} title={c.title}>{c.label}</button>
      ))}
    </div>
  )
}
