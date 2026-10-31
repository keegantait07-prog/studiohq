import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantPush, ThreadSummary } from '@shared/types'
import { addError, answerApproval, initialState, loadThread, reduce, startRun, toolLabel, type Item, type ViewState } from './assistantState'

export function Assistant({ onClose, hidden, onBusy }: { onClose: () => void; hidden?: boolean; onBusy?: (busy: boolean) => void }) {
  const [state, setState] = useState<ViewState>(initialState)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [text, setText] = useState('')
  const threadRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const refreshThreads = useCallback(() => window.api.assistantThreads().then(setThreads), [])

  // Pushes for the thread being loaded are queued and replayed after the load.
  // Risk: an event persisted before the fetch AND pushed after it could show text twice (tiny window).
  const loading = useRef<AssistantPush[]>([])
  const loadingId = useRef<number | null>(null)
  const open = useCallback(async (id: number) => {
    threadRef.current = id
    loading.current = []
    loadingId.current = id
    setState({ ...initialState(), threadId: id })
    const d = await window.api.assistantThread(id)
    if (threadRef.current !== id) return
    loadingId.current = null
    const queued = loading.current
    loading.current = []
    stick.current = true
    setState(queued.reduce(reduce, d ? loadThread(d) : { ...initialState(), threadId: id }))
  }, [])

  const create = useCallback(async () => {
    const id = await window.api.assistantNew()
    await open(id)
    refreshThreads()
  }, [open, refreshThreads])

  // first open: latest thread, or a fresh one
  useEffect(() => {
    let live = true
    window.api.assistantThreads().then(async (t) => {
      if (!live) return
      setThreads(t)
      if (t.length) await open(t[0].id)
      else await create()
    })
    return () => { live = false }
  }, [open, create])

  useEffect(() => window.api.onAssistant((p) => {
    if ('event' in p && (p.event.type === 'done' || p.event.type === 'error')) refreshThreads()
    if (loadingId.current === p.threadId) loading.current.push(p)
    setState((s) => reduce(s, p))
  }), [refreshThreads])

  const pending = state.items.some((i) => i.kind === 'approval' && i.outcome === 'pending')
  const busy = state.running || pending
  useEffect(() => { onBusy?.(busy) }, [busy, onBusy])

  // auto-scroll only when the user is already near the bottom
  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [state.items, hidden])

  const send = async () => {
    const t = text.trim()
    const id = state.threadId
    if (!t || id == null || state.running) return
    setText('')
    stick.current = true
    setState((s) => startRun(s, t))
    const r = await window.api.assistantSend(id, t)
    if (r.error && threadRef.current === id) setState((s) => addError(s, r.error!))
    refreshThreads()
  }

  const answer = (id: string, approved: boolean) => {
    setState((s) => answerApproval(s, id, approved))
    window.api.assistantApprove(id, approved).catch(() => {})
  }

  return (
    <aside className={`assistant${hidden ? ' as-hidden' : ''}`} aria-label="Studio Assistant">
      <header>
        <select disabled={busy} value={state.threadId ?? ''} onChange={(e) => open(+e.target.value)} aria-label="Chat">
          {threads.map((t) => <option key={t.id} value={t.id}>{t.title || 'New chat'}</option>)}
          {state.threadId != null && !threads.some((t) => t.id === state.threadId) && <option value={state.threadId}>New chat</option>}
        </select>
        <button disabled={busy} onClick={create}>New chat</button>
        <button className="ghost" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="as-list" ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}>
        {state.items.length === 0 && <p className="help">Ask about your beats, pitches or sales. Anything that changes data asks you first.</p>}
        {state.items.map((it, i) => <Row key={i} it={it} onAnswer={answer} />)}
        {state.running && <div className="as-working">Working…</div>}
      </div>
      <div className="as-input">
        <textarea
          value={text}
          rows={2}
          placeholder="Ask Studio Assistant…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
          }}
        />
        {state.running
          ? <button onClick={() => state.threadId != null && window.api.assistantStop(state.threadId)}>Stop</button>
          : <button className="primary" disabled={!text.trim() || state.threadId == null} onClick={send}>Send</button>}
      </div>
    </aside>
  )
}

function Row({ it, onAnswer }: { it: Item; onAnswer: (id: string, approved: boolean) => void }) {
  if (it.kind === 'user') return <div className="as-msg user">{it.text}</div>
  if (it.kind === 'assistant') return <div className="as-msg bot">{it.text}</div>
  if (it.kind === 'error') return <div className="as-note">{it.message}</div>
  if (it.kind === 'tool') {
    return (
      <details className={`as-tool${it.isError ? ' err' : ''}`}>
        <summary>{toolLabel(it.name)}…{it.isError ? ' (failed)' : ''}</summary>
        <pre>{JSON.stringify(it.input, null, 2) ?? ''}</pre>
      </details>
    )
  }
  const done = it.outcome !== 'pending'
  return (
    <div className="as-approve">
      <div className="as-sum">{it.summary}</div>
      {done ? <div className="as-outcome">{{ approved: 'Approved', denied: 'Denied', expired: 'Not answered', pending: '' }[it.outcome]}</div> : (
        <div className="as-btns">
          <button className="primary" onClick={() => onAnswer(it.id, true)}>Approve</button>
          <button onClick={() => onAnswer(it.id, false)}>Deny</button>
        </div>
      )}
    </div>
  )
}
