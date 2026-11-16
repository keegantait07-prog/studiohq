// Glue for the v4 Settings screen (Settings, YouTubeSettings, LeadSourceSettings): one row layout and the
// small controls every section shares. Buttons are the library Button. The switch, text fields and folder rows
// have no usable library part (Skiper3 is a demo with no props, Skiper106 needs the missing `dialkit`
// package, FileTree is a tree, not a removable list), so they are plain semantic elements skinned with tokens.
import { useId, type ReactNode } from 'react'
import { FolderOpen, Plus, X } from 'lucide-react'
import { Button } from './crmUi'

export { Button }

/** One settings row: label and help on the left, the control on the right. */
export function Row({ id, title, help, children }: { id?: string; title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row" id={id ? 'set-' + id : undefined}>
      <div className="set-lbl"><h3>{title}</h3>{help && <p className="sx-help">{help}</p>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

/** A labelled on/off switch (role="switch"). */
export function Switch({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode }) {
  const id = useId()
  return (
    <div className="set-swrow">
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className="sx-switch" onClick={() => onChange(!checked)} />
      <div className="set-swtxt"><span id={id} onClick={() => onChange(!checked)}>{label}</span>{help && <small className="sx-help">{help}</small>}</div>
    </div>
  )
}

/** A path or value row with its actions on the right. */
export function Line({ children, actions, mono }: { children: ReactNode; actions?: ReactNode; mono?: boolean }) {
  return (
    <div className="set-line">
      <span className={mono ? 'set-path' : 'set-val'}>{children}</span>
      {actions && <span className="set-acts">{actions}</span>}
    </div>
  )
}

/** A list of folders with Remove per row and Add folder below. */
export function Folders({ items, onRemove, onAdd }: { items: string[]; onRemove: (f: string) => void; onAdd: () => void }) {
  return (
    <div className="set-folders">
      {items.length === 0 && <p className="set-none">No folders yet</p>}
      {items.map((f) => (
        <Line key={f} mono actions={<Button variant="ghost" size="sm" onClick={() => onRemove(f)}><X aria-hidden="true" />Remove</Button>}>
          <FolderOpen aria-hidden="true" className="set-ico" />{f}
        </Line>
      ))}
      <div><Button variant="outline" size="sm" onClick={onAdd}><Plus aria-hidden="true" />Add folder…</Button></div>
    </div>
  )
}

/** A text field with its label. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="set-fld"><span>{label}</span>{children}</label>
}
