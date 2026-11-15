import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, test } from 'vitest'
import { openDb, PITCH_TEMPLATES, PRO_STARTER } from './db'

const tmp = mkdtempSync(join(tmpdir(), 'shq-tpl-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const OLD_FIRST = `Hey {{name}},

I'm {{my_name}}, a producer. I put together a few beats I think would fit what you're doing:

{{beats}}

Listen here: {{link}}

No pressure at all. If anything hits, let me know and I'll send the full files or stems.

{{my_name}}`

describe('pitch templates', () => {
  test('a new database gets the casual wording, no self-introduction, with the Instagram sign-off', () => {
    const db = openDb(join(tmp, 'fresh'))
    const row = db.prepare("SELECT body FROM templates WHERE kind='first_pitch'").get() as { body: string }
    expect(row.body).toBe(PITCH_TEMPLATES.first_pitch.body)
    expect(row.body).toContain('@smalls.mp3')
    expect(row.body).not.toMatch(/I'm \{\{my_name\}\}|a producer/)
    db.close()
  })

  test('an untouched old starter template is upgraded, an edited one is left alone', () => {
    const dir = join(tmp, 'upgrade')
    const db = openDb(dir)
    db.prepare("UPDATE templates SET subject='{{beat_count}} beats for you, {{name}}', body=? WHERE kind='first_pitch'").run(OLD_FIRST)
    db.prepare("UPDATE templates SET body='my own follow-up' WHERE kind='follow_up'").run()
    db.close()

    const again = openDb(dir)
    const first = again.prepare("SELECT subject, body FROM templates WHERE kind='first_pitch'").get() as { subject: string; body: string }
    const follow = again.prepare("SELECT body FROM templates WHERE kind='follow_up'").get() as { body: string }
    expect(first).toEqual(PITCH_TEMPLATES.first_pitch)
    expect(follow.body).toBe('my own follow-up')
    again.close()
  })

  test('the professional wording from before is upgraded too', () => {
    const dir = join(tmp, 'pro')
    const db = openDb(dir)
    db.prepare("UPDATE templates SET subject=?, body=? WHERE kind='first_pitch'").run(PRO_STARTER.first_pitch.subject, PRO_STARTER.first_pitch.body)
    db.close()
    const again = openDb(dir)
    expect(again.prepare("SELECT subject, body FROM templates WHERE kind='first_pitch'").get()).toEqual(PITCH_TEMPLATES.first_pitch)
    again.close()
  })
})
