import { describe, expect, test } from 'vitest'
import { detectColumns, parseCsv, parseDate, parseMoney, planImport, type BeatRef } from './beatstars-import'
import type { License } from '../shared/types'

describe('parseCsv', () => {
  test('handles quotes, commas and newlines inside quotes', () => {
    expect(parseCsv('a,b\n"x, y","line1\nline2"\n')).toEqual([['a', 'b'], ['x, y', 'line1\nline2']])
  })
  test('reads doubled quotes as one quote', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']])
  })
  test('an Excel re-save reads the same', () => {
    const plain = parseCsv('Order,Title\n1,Alpha\n2,Bravo\n')
    expect(parseCsv('﻿Order;Title\r\n1;Alpha\r\n2;Bravo\r\n\r\n')).toEqual(plain)
    expect(parseCsv('Order\tTitle\n1\tAlpha\n2\tBravo\n\n')).toEqual(plain)
  })
  test('drops fully empty lines', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('detectColumns', () => {
  test('finds columns by known header names and reports missing required ones', () => {
    const r = detectColumns(['Order ID', 'Purchase Date', 'Track Title', 'License Type', 'Buyer Email', 'Amount', 'Service Fee'])
    expect(r.columns).toMatchObject({ orderId: 0, date: 1, title: 2, license: 3, email: 4, gross: 5, fee: 6 })
    expect(r.missing).toEqual([])
    expect(detectColumns(['Foo', 'Bar']).missing).toEqual(['orderId', 'date', 'title', 'gross'])
  })
  test('a saved mapping wins where its index is in range', () => {
    const r = detectColumns(['Order ID', 'Date', 'Title', 'Amount', 'Other'], { gross: 4 })
    expect(r.columns.gross).toBe(4)
    expect(detectColumns(['A', 'B'], { gross: 9 }).columns.gross).toBeUndefined()
  })
})

describe('parseMoney', () => {
  test('reads money as spreadsheets write it', () => {
    expect(parseMoney('$1,299.00')).toBe(1299)
    expect(parseMoney('29.99 USD')).toBe(29.99)
    expect(parseMoney('(15.00)')).toBe(-15)
    expect(parseMoney('-15')).toBe(-15)
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('')).toBeNull()
  })
})

describe('parseDate', () => {
  test('reads ISO and US dates', () => {
    expect(parseDate('10/03/2026 2:05 PM')).toBe(new Date(2026, 9, 3, 14, 5).getTime())
    expect(parseDate('2026-10-03T14:05:00Z')).toBe(Date.UTC(2026, 9, 3, 14, 5))
    expect(parseDate('2026-10-03')).toBe(new Date(2026, 9, 3, 12, 0).getTime())
    expect(parseDate('03.10.26')).toBeNull()
    expect(parseDate('')).toBeNull()
  })
})

describe('planImport', () => {
  const beats: BeatRef[] = [
    { id: 1, groupId: 1, title: 'alpha final mix.wav', siteTitle: 'Alpha', mtime: 1 },
    { id: 2, groupId: 1, title: 'alpha v2.wav', siteTitle: 'Alpha', mtime: 5 },
    { id: 3, groupId: 3, title: 'Bravo', siteTitle: null, mtime: 1 },
    { id: 4, groupId: 4, title: 'Twin', siteTitle: 'Twin', mtime: 1 },
    { id: 5, groupId: 5, title: 'Twin', siteTitle: 'Twin', mtime: 1 }
  ]
  const licenses: License[] = [
    { id: 10, name: 'MP3 Lease', exclusive: false, defaultPrice: 25, files: '', perks: [] },
    { id: 11, name: 'Exclusive', exclusive: true, defaultPrice: 500, files: '', perks: [] }
  ]
  const columns = { orderId: 0, date: 1, title: 2, license: 3, buyer: 4, email: 5, gross: 6, fee: 7, net: 8 }
  const head = ['id', 'date', 'title', 'lic', 'buyer', 'email', 'gross', 'fee', 'net']
  const row = (o: Partial<Record<string, string>> = {}) => [o.id ?? 'A1', o.date ?? '2026-10-03', o.title ?? 'Alpha', o.lic ?? 'MP3 Lease', o.buyer ?? 'Sam', o.email ?? 's@x.co', o.gross ?? '25', o.fee ?? '', o.net ?? '']
  const plan = (rows: string[][], extra: Partial<Parameters<typeof planImport>[0]> = {}) =>
    planImport({ table: [head, ...rows], columns, beats, licenses, existingIds: new Set(), exclusiveLocks: new Map(), ...extra })

  test('a clean row is new, matched to the newest file in its group, with its tier', () => {
    const [r] = plan([row()])
    expect(r).toMatchObject({ status: 'new', beatId: 2, licenseId: 10, exclusive: false, price: 25, fee: 0, buyer: 'Sam', externalId: 'A1', line: 2 })
  })
  test('fee comes from the fee column, else gross minus net, never below zero', () => {
    expect(plan([row({ fee: '2.5' })])[0].fee).toBe(2.5)
    expect(plan([row({ net: '22' })])[0].fee).toBe(3)
    expect(plan([row({ net: '30' })])[0].fee).toBe(0)
  })
  test('a title shared by two groups is unmatched, and the user can pick a beat or skip', () => {
    expect(plan([row({ title: 'Twin' })])[0].status).toBe('unmatched')
    expect(plan([row({ title: 'Twin' })], { choices: { 2: 5 } })[0]).toMatchObject({ status: 'new', beatId: 5 })
    expect(plan([row({ title: 'Twin' })], { choices: { 2: null } })[0]).toMatchObject({ status: 'skipped', reason: 'Skipped by you' })
    expect(plan([row({ title: 'Nope' })])[0].status).toBe('unmatched')
  })
  test('matches by Vault title, ignoring case', () => {
    expect(plan([row({ title: 'BRAVO' })])[0]).toMatchObject({ status: 'new', beatId: 3 })
  })
  test('unreadable date or amount, refunds and zero amounts are skipped with a reason', () => {
    expect(plan([row({ date: 'soon' })])[0]).toMatchObject({ status: 'skipped', reason: "Couldn't read the date" })
    expect(plan([row({ gross: 'free' })])[0]).toMatchObject({ status: 'skipped', reason: "Couldn't read the amount" })
    expect(plan([row({ gross: '(25.00)' })])[0]).toMatchObject({ status: 'skipped', reason: 'Refund or zero amount' })
    expect(plan([row({ gross: '0' })])[0].status).toBe('skipped')
  })
  test('an order already imported is a duplicate', () => {
    expect(plan([row()], { existingIds: new Set(['A1']) })[0].status).toBe('duplicate')
  })
  test('an order id on several rows gets a line number suffix', () => {
    const r = plan([row({ title: 'Alpha' }), row({ title: 'Bravo' })])
    expect(r.map((x) => x.externalId)).toEqual(['A1:1', 'A1:2'])
  })
  test('empty license and buyer get defaults; the exclusive flag follows the tier or the name', () => {
    expect(plan([row({ lic: '', buyer: '' })])[0]).toMatchObject({ license: 'Lease', buyer: 'BeatStars customer', exclusive: false })
    expect(plan([row({ lic: 'exclusive' })])[0]).toMatchObject({ exclusive: true, licenseId: 11 })
    expect(plan([row({ lic: 'Custom Exclusive Deal' })])[0]).toMatchObject({ exclusive: true, licenseId: null })
  })
  test('exclusive rules: locked beats are skipped, and only the first exclusive in a file counts', () => {
    const locks = new Map([[1, new Date(2026, 9, 1, 12).getTime()]])
    expect(plan([row()], { exclusiveLocks: locks })[0]).toMatchObject({ status: 'skipped', reason: 'Already sold exclusively' })
    const r = plan([row({ id: 'B1', lic: 'Exclusive', title: 'Bravo' }), row({ id: 'B2', lic: 'Exclusive', title: 'Bravo' })])
    expect(r.map((x) => x.status)).toEqual(['new', 'skipped'])
  })
})
