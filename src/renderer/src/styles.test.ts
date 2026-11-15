import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'styles.css'), 'utf8')

describe('screen changes', () => {
  it('do not replay an entrance animation on the view (it flashed the backdrop on every switch)', () => {
    expect(css).not.toMatch(/\.app\s*>\s*:is\([^)]*\)\s*\{[^}]*animation\s*:/)
  })
})

describe('Deck theme', () => {
  it('has no rules scoped to a removed theme id', () => {
    expect(css).not.toMatch(/data-theme\s*=\s*['"]?(defied|pearl|signal|faceplate|tape|brass|ballpoint|concrete)/)
  })
  it('defines the approved Deck tokens in the base block', () => {
    for (const t of ['--bg: #0b0b0a', '--panel: #121210', '--accent: #ff5533', '--accent-text: #ff6a4d', '--r-btn: 8px', '--r-field: 4px', '--r-card: 10px', '--display-weight: 800']) expect(css).toContain(t)
  })
})
