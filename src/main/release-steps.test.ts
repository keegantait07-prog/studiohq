import { describe, expect, test } from 'vitest'
import { buildRelease, feedbackStep, money, pitchStep, postStep, saleStep, splitsStep, storeStep, videoStep } from './release-steps'

describe('storeStep', () => {
  const base = { onSite: true, dirty: false, missing: false, soldExclusively: false, from: 25 as number | null }
  test('live shows the from price', () => {
    expect(storeStep(base)).toEqual({ id: 'store', state: 'done', summary: 'Live · from $25' })
    expect(storeStep({ ...base, from: null }).summary).toBe('Live')
  })
  test('not on the store is to do', () => {
    expect(storeStep({ ...base, onSite: false })).toEqual({ id: 'store', state: 'todo', summary: 'Not on the store' })
  })
  test('unpublished changes and a missing file are in progress', () => {
    expect(storeStep({ ...base, dirty: true })).toMatchObject({ state: 'doing', summary: 'Changes not published' })
    expect(storeStep({ ...base, missing: true })).toMatchObject({ state: 'doing', summary: 'File missing' })
  })
  test('sold exclusively is not applicable, even if it was on the site', () => {
    expect(storeStep({ ...base, soldExclusively: true })).toEqual({ id: 'store', state: 'na', summary: 'Sold exclusively' })
  })
})

describe('videoStep', () => {
  test('none yet', () => expect(videoStep([])).toEqual({ id: 'video', state: 'todo', summary: 'No video yet' }))
  test('counts videos and lists distinct formats in first-seen order', () => {
    expect(videoStep(['vertical', 'vertical', 'youtube'])).toEqual({ id: 'video', state: 'done', summary: '3 videos · vertical, youtube' })
    expect(videoStep(['horizontal']).summary).toBe('1 video · horizontal')
  })
})

describe('postStep', () => {
  test('nothing planned', () => expect(postStep([])).toEqual({ id: 'post', state: 'todo', summary: 'Nothing planned' }))
  test('only planned or private is in progress', () => {
    expect(postStep([{ status: 'planned', platform: 'tiktok' }])).toEqual({ id: 'post', state: 'doing', summary: '1 planned' })
    expect(postStep([{ status: 'private', platform: 'youtube' }, { status: 'planned', platform: 'tiktok' }]).summary).toBe('2 planned')
  })
  test('one posted makes it done and lists platform labels', () => {
    expect(postStep([{ status: 'posted', platform: 'tiktok' }, { status: 'posted', platform: 'instagram' }, { status: 'planned', platform: 'tiktok' }]))
      .toEqual({ id: 'post', state: 'done', summary: '2 posted · TikTok, Instagram Reels' })
  })
})

describe('pitchStep', () => {
  test('never pitched', () => expect(pitchStep([])).toEqual({ id: 'pitch', state: 'todo', summary: 'Not pitched yet' }))
  test('waiting on a reply is in progress', () => {
    expect(pitchStep([{ contactId: 1, status: 'sent' }, { contactId: 2, status: 'listened' }])).toEqual({ id: 'pitch', state: 'doing', summary: 'Pitched to 2 · 0 replied' })
  })
  test('any response is done; contacts are counted once', () => {
    expect(pitchStep([{ contactId: 1, status: 'sent' }, { contactId: 1, status: 'listened' }, { contactId: 2, status: 'passed' }])).toEqual({ id: 'pitch', state: 'done', summary: 'Pitched to 2 · 1 replied' })
    expect(pitchStep([{ contactId: 3, status: 'placed' }]).state).toBe('done')
  })
})

describe('feedbackStep', () => {
  test('no link', () => expect(feedbackStep({ links: 0, unseen: 0 })).toEqual({ id: 'feedback', state: 'todo', summary: 'No feedback link' }))
  test('new comments need a look; all seen is done', () => {
    expect(feedbackStep({ links: 1, unseen: 1 })).toEqual({ id: 'feedback', state: 'doing', summary: '1 link · 1 new comment' })
    expect(feedbackStep({ links: 2, unseen: 3 }).summary).toBe('2 links · 3 new comments')
    expect(feedbackStep({ links: 1, unseen: 0 })).toEqual({ id: 'feedback', state: 'done', summary: '1 link · 0 new comments' })
  })
})

describe('splitsStep', () => {
  const none = { hasCredits: false, parties: 0, pub: 0, master: 0, sheetAt: null as number | null }
  test('no collaborators and no credits means you own it', () => expect(splitsStep(none)).toEqual({ id: 'splits', state: 'na', summary: 'You own 100%' }))
  test('credits but no splits is to do', () => expect(splitsStep({ ...none, hasCredits: true })).toEqual({ id: 'splits', state: 'todo', summary: 'Not recorded' }))
  test('totals not at 100 are in progress', () => {
    expect(splitsStep({ ...none, hasCredits: true, parties: 2, pub: 60, master: 100 })).toEqual({ id: 'splits', state: 'doing', summary: 'Publishing 60% · Master 100%' })
  })
  test('100 and 100 is done, with the sheet date when made', () => {
    expect(splitsStep({ ...none, parties: 2, pub: 100, master: 100 })).toEqual({ id: 'splits', state: 'done', summary: 'Publishing 100% · Master 100%' })
    const at = new Date(2026, 9, 3, 12).getTime()
    expect(splitsStep({ ...none, parties: 2, pub: 100, master: 100, sheetAt: at }).summary).toBe('Publishing 100% · Master 100% · sheet Oct 3')
  })
})

describe('saleStep', () => {
  test('no sales', () => expect(saleStep([])).toEqual({ id: 'sale', state: 'todo', summary: 'No sales yet' }))
  test('sums sales and flags an exclusive', () => {
    expect(saleStep([{ price: 25, exclusive: false }, { price: 29.99, exclusive: false }])).toEqual({ id: 'sale', state: 'done', summary: '2 sales · $54.99' })
    expect(saleStep([{ price: 1250, exclusive: true }]).summary).toBe('1 sale · $1,250 · exclusive')
  })
})

test('money drops cents only when whole', () => {
  expect(money(25)).toBe('$25')
  expect(money(29.99)).toBe('$29.99')
  expect(money(1250)).toBe('$1,250')
})

test('buildRelease does not count not-applicable steps in the total', () => {
  const steps = [storeStep({ onSite: false, dirty: false, missing: false, soldExclusively: true, from: null }), saleStep([{ price: 5, exclusive: true }]), videoStep([])]
  expect(buildRelease(7, 3, steps)).toEqual({ beatId: 7, groupId: 3, steps, done: 1, total: 2 })
})
