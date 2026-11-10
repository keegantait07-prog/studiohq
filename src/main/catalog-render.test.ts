import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'vitest'
import { fromPrice, pageHtml, pageLicenses } from './catalog-render'

const template = readFileSync(join(__dirname, 'catalog-page.html'), 'utf8')
const count = (s: string, sub: string) => s.split(sub).length - 1
const lic = (name: string, defaultPrice: number | null, exclusive = false, files = '', perks: string[] = []) => ({ id: 1, name, exclusive, defaultPrice, files, perks })

describe('fromPrice', () => {
  test('is the cheapest non-exclusive tier', () => {
    expect(fromPrice([lic('a', 49.99), lic('b', 29.99), lic('x', 5, true)])).toBe(29.99)
  })
  test('is null when no lease tier has a price', () => {
    expect(fromPrice([lic('a', null), lic('x', 5, true)])).toBeNull()
    expect(fromPrice([])).toBeNull()
  })
  test('counts a free tier', () => {
    expect(fromPrice([lic('a', 0), lic('b', 10)])).toBe(0)
  })
})

test('pageLicenses keeps order and leaves out a missing price', () => {
  expect(pageLicenses([lic('A', 10, false, 'MP3', ['p']), lic('B', null, true)])).toEqual([
    { name: 'A', exclusive: false, price: 10, files: 'MP3', perks: ['p'] },
    { name: 'B', exclusive: true, files: '', perks: [] }
  ])
})

describe('pageHtml', () => {
  const html = pageHtml({ store: 'https://s', from: 25, licenses: pageLicenses([lic('MP3 Lease', 25, false, 'MP3', ['x'])]), beats: [] })
  test('fills in the data and carries no fixed price', () => {
    expect(html).not.toContain('__DATA__')
    expect(html).not.toContain('const PRICE')
    expect(html).not.toContain('$15')
    expect(html).toContain('"from":25')
    expect(html).toContain('id="licenses"')
  })
  test('license text with markup cannot break out of the data block', () => {
    const evil = pageHtml({ store: 's', from: null, licenses: pageLicenses([lic('</script><b>"x"&', 1, false, '', ['<img src=x>'])]), beats: [] })
    expect(count(evil, '</script>')).toBe(count(template, '</script>'))
    expect(evil).toContain('\\u003cimg')
  })
  test('the page prints license text as text, not markup', () => {
    const line = (start: string) => template.split('\n').find((l) => l.startsWith(start))!
    const from = template.indexOf('function renderLicenses')
    const fn = template.slice(from, template.indexOf('renderLicenses();', from))
    const els: Record<string, { innerHTML: string; textContent: string; hidden: boolean }> = {}
    const $ = (sel: string) => (els[sel] ??= { innerHTML: '', textContent: '', hidden: true })
    const run = new Function('$', 'LICENSES', 'FROM', `${line('const esc =')}\n${line('const money =')}\n${fn}\nrenderLicenses()`)
    run($, [{ name: '<b>N</b>', exclusive: false, price: 5, files: '<i>F</i>', perks: ['<img src=x>', 'a & "b"'] }], 'from $5')
    const out = els['#licList'].innerHTML
    expect(out).toContain('&lt;b&gt;N&lt;/b&gt;')
    expect(out).toContain('&lt;i&gt;F&lt;/i&gt;')
    expect(out).toContain('&lt;img src=x&gt;')
    expect(out).toContain('a &amp; &quot;b&quot;')
    expect(out).not.toMatch(/<(b|i|img)\b/)
    expect(els['#licenses'].hidden).toBe(false)
    expect(els['#step2'].textContent).toBe('Lease it from $5')
  })
})
