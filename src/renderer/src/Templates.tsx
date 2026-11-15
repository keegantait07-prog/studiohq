import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CrmData, Template } from '@shared/types'
import { PLACEHOLDERS, renderTemplate } from '@shared/template'
import { beatLine } from './crmUtils'
import { Button, Reveal, Seg, Tip } from './crmUi'
import './crm.css'

const SAMPLE = {
  name: 'Alex', full_name: 'Alex Rivera', my_name: 'You', beat_count: 2, link: 'https://…/p/abc123/', days: 7, sound: 'dark melodic trap', sent_date: 'Oct 8', subject: '2 beats for you, Alex',
  beats: [{ title: 'MOON', bpm: 121, key: 'G# minor' }, { title: 'GHOST', bpm: 148, key: 'C# minor' }].map(beatLine).join('\n'), beat_titles: 'MOON, GHOST'
}

const KINDS: { v: Template['kind']; label: string }[] = [{ v: 'first_pitch', label: 'First pitch' }, { v: 'follow_up', label: 'Follow-up' }, { v: 'custom', label: 'Custom' }]

export function Templates({ crm, myName, reload }: { crm: CrmData; myName: string; reload: () => void }) {
  const [id, setId] = useState<number | 'new' | null>(crm.templates[0]?.id ?? null)
  const cur = typeof id === 'number' ? crm.templates.find((t) => t.id === id) : undefined
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Template['kind']>('custom')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sure, setSure] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setSure(false)
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
  const del = async () => {
    if (!cur) return
    if (!sure) { setSure(true); return }
    await window.api.deleteTemplate(cur.id); reload(); setId(null); setSure(false)
  }
  const vars = { ...SAMPLE, my_name: myName || 'You' }

  return (
    <div className="pc-tpl">
      <nav className="pc-tpl-l" aria-label="Templates">
        <div className="pc-eyebrow" style={{ marginBottom: 4 }}>Templates</div>
        {crm.templates.map((t) => (
          <button key={t.id} type="button" className="pc-tpl-it" aria-current={id === t.id || undefined} onClick={() => setId(t.id)}><span>{t.name}</span><small>{t.kind.replace('_', ' ')}</small></button>
        ))}
        {!crm.templates.length && <div className="pc-empty"><b>No templates yet.</b>Write one so every pitch starts from your words.</div>}
        <Button variant="outline" size="sm" onClick={() => setId('new')} style={{ marginTop: 4 }}><Plus />New template</Button>
      </nav>
      {(cur || id === 'new') ? (
        <Reveal key={String(id)} className="pc-tpl-e">
          <div className="pc-col">
            <div className="pc-two">
              <div className="pc-fld"><label htmlFor="tp-name">Name</label><input id="tp-name" className="pc-in" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="pc-fld"><span className="pc-lbl">Used for</span><Seg label="Used for" value={kind} onChange={setKind} options={KINDS} /></div>
            </div>
            <div className="pc-fld"><label htmlFor="tp-subj">Subject</label><input id="tp-subj" className="pc-in" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="pc-fld"><label htmlFor="tp-body">Body</label><textarea id="tp-body" className="pc-in" ref={ta} rows={11} value={body} onChange={(e) => setBody(e.target.value)} /></div>
            <div className="pc-fld">
              <span className="pc-lbl">Insert a placeholder</span>
              <div className="pc-row">{PLACEHOLDERS.map((p) => <Tip key={p.key} label={p.help}><button type="button" className="pc-chip mono" onClick={() => insert(p.key)}>{`{{${p.key}}}`}</button></Tip>)}</div>
            </div>
          </div>
          <div className="pc-col">
            <div className="pc-fld"><span className="pc-lbl">Preview with sample data</span>
              <div className="pc-preview"><b>{renderTemplate(subject, vars)}</b>{renderTemplate(body, vars)}</div>
            </div>
            {sure && cur && <div className="pc-cfm" role="alert"><span>Delete “{cur.name}”?</span><Button variant="outline" size="sm" onClick={() => setSure(false)}>Cancel</Button></div>}
            <div className="pc-acts">
              {cur && <Button variant={sure ? 'destructive' : 'outline'} onClick={del}>{sure ? 'Delete for good' : 'Delete'}</Button>}
              <Button onClick={save} disabled={!name.trim()}>Save template</Button>
            </div>
          </div>
        </Reveal>
      ) : (
        <div className="pc-tpl-e"><div className="pc-empty"><b>Pick a template</b>Or start a new one from the list.</div></div>
      )}
    </div>
  )
}
