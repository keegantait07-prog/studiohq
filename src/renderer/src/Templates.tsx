import { useEffect, useRef, useState } from 'react'
import type { CrmData, Template } from '@shared/types'
import { PLACEHOLDERS, renderTemplate } from '@shared/template'
import { beatLine } from './crmUtils'

const SAMPLE = {
  name: 'Alex', full_name: 'Alex Rivera', my_name: 'You', beat_count: 2, link: 'https://…/p/abc123/', days: 7, sound: 'dark melodic trap', sent_date: 'Oct 8', subject: '2 beats for you, Alex',
  beats: [{ title: 'MOON', bpm: 121, key: 'G# minor' }, { title: 'GHOST', bpm: 148, key: 'C# minor' }].map(beatLine).join('\n'), beat_titles: 'MOON, GHOST'
}

export function Templates({ crm, myName, reload }: { crm: CrmData; myName: string; reload: () => void }) {
  const [id, setId] = useState<number | 'new' | null>(crm.templates[0]?.id ?? null)
  const cur = typeof id === 'number' ? crm.templates.find((t) => t.id === id) : undefined
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Template['kind']>('custom')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (id === 'new') { setName('New template'); setKind('custom'); setSubject(''); setBody('Hey {{name}},\n\n') }
    else if (cur) { setName(cur.name); setKind(cur.kind); setSubject(cur.subject); setBody(cur.body) }
  }, [id, cur?.id])

  const insert = (key: string) => {
    const el = ta.current
    const tok = `{{${key}}}`
    if (!el) return setBody((b) => b + tok)
    const { selectionStart: s, selectionEnd: e } = el
    setBody(body.slice(0, s) + tok + body.slice(e))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + tok.length, s + tok.length) })
  }
  const save = async () => {
    const nid = await window.api.saveTemplate({ id: cur?.id, name, kind, subject, body })
    reload(); setId(nid)
  }
  const vars = { ...SAMPLE, my_name: myName || 'You' }

  return (
    <div className="tpl">
      <div className="tpl-list">
        {crm.templates.map((t) => (
          <div key={t.id} className={`ver ${id === t.id ? 'cur' : ''}`} style={{ gridTemplateColumns: '1fr auto' }} onClick={() => setId(t.id)}><span>{t.name}</span><span className="dim">{t.kind.replace('_', ' ')}</span></div>
        ))}
        <button onClick={() => setId('new')}>+ New template</button>
      </div>
      {(cur || id === 'new') && (
        <div className="tpl-edit">
          <div className="two">
            <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label>Used for</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as Template['kind'])}><option value="first_pitch">First pitch</option><option value="follow_up">Follow-up</option><option value="custom">Custom</option></select>
            </div>
          </div>
          <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field"><label>Body</label><textarea ref={ta} rows={11} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="chips ph">{PLACEHOLDERS.map((p) => <span key={p.key} className="chip" title={p.help} onClick={() => insert(p.key)} style={{ cursor: 'pointer' }}>{`{{${p.key}}}`}</span>)}</div>
          <div className="field"><label>Preview with sample data</label>
            <div className="preview"><b>{renderTemplate(subject, vars)}</b>{'\n\n'}{renderTemplate(body, vars)}</div>
          </div>
          <div className="actions">
            {cur && <button onClick={async () => { if (confirm(`Delete “${cur.name}”?`)) { await window.api.deleteTemplate(cur.id); reload(); setId(null) } }}>Delete</button>}
            <button className="primary" onClick={save} disabled={!name.trim()}>Save template</button>
          </div>
        </div>
      )}
    </div>
  )
}
