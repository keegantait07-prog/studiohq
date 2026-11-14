import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'styles.css'), 'utf8')

describe('screen changes', () => {
  it('do not replay an entrance animation on the view (it flashed the backdrop on every switch)', () => {
    expect(css).not.toMatch(/\.app\s*>\s*:is\([^)]*\)\s*\{[^}]*animation\s*:/)
  })
})
