// v4 Studio Assistant: a 440px dock on the right under the strip. Blueprint:
// docs/design/mockups/v4/screens-studio-system.html (#assistant). Library parts: ScrollArea (thread),
// AnimatedListItem (row entrance), Skiper41 ProgressiveBlur (top edge), Button, Tooltip, BlurFade (Reveal).
// Thread, approval and streaming logic are unchanged (assistantState.ts).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AssistantPush, ThreadSummary } from '@shared/types'
import { addError, answerApproval, initialState, loadThread, reduce, startRun, toolLabel, type Item, type ViewState } from './assistantState'
import { useReducedMotion } from 'motion/react'
import { Check, ChevronRight, Plus, Send, Square, X } from 'lucide-react'
import { ScrollArea } from '@/components/lib/scroll-area'
import { AnimatedListItem } from '@/components/lib/animated-list'
import { ProgressiveBlur } from '@/components/lib/skiper-ui/skiper41'
import { TooltipProvider } from '@/components/lib/tooltip'
import { Button, IconBtn, Reveal } from './crmUi'
import './system.css'

export type AssistantStatus = 'idle' | 'working' | 'approval'

export function Assistant({ onClose, hidden, onBusy }: { onClose: () => void; hidden?: boolean; onBusy?: (s: AssistantStatus) => void }) {
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
  const status: AssistantStatus = pending ? 'approval' : state.running ? 'working' : 'idle'
  useEffect(() => { onBusy?.(status) }, [status, onBusy])

  // auto-scroll only when the user is already near the bottom
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]')
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
    <TooltipProvider delay={120}>
      <aside className={`asst4 sx${hidden ? ' as-off' : ''}`} aria-label="Studio Assistant" aria-hidden={hidden || undefined}>
        <header className="as4-head">
          <select className="sx-in as4-thread" disabled={busy} value={state.threadId ?? ''} onChange={(e) => open(+e.target.value)} aria-label="Chat">
            {threads.map((t) => <option key={t.id} value={t.id}>{t.title || 'New chat'}</option>)}
            {state.threadId != null && !threads.some((t) => t.id === state.threadId) && <option value={state.threadId}>New chat</option>}
          </select>
          <Button variant="outline" size="sm" disabled={busy} onClick={create}><Plus aria-hidden="true" />New chat</Button>
          <IconBtn label="Close" onClick={onClose}><X /></IconBtn>
        </header>
        <div className="as4-list" ref={listRef} onScrollCapture={(e) => { const el = e.target as HTMLElement; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}>
          <ProgressiveBlur position="top" height="28px" blurAmount="2px" backgroundColor="var(--panel)" className="as4-edge" />
          <ScrollArea className="as4-sa">
            <div className="as4-rows" aria-live="polite">
              {state.items.length === 0 && <Reveal className="as4-empty"><b>Studio Assistant</b><p className="sx-help">Ask about your beats, pitches or sales. Anything that changes data asks you first.</p></Reveal>}
              {state.items.map((it, i) => <Enter key={i}><Row it={it} onAnswer={answer} /></Enter>)}
              {state.running && <div className="as4-working" role="status"><span className="as4-dots" aria-hidden="true"><i /><i /><i /></span>{pending ? 'Waiting for your approval' : 'Assistant working…'}</div>}
            </div>
          </ScrollArea>
        </div>
        <div className="as4-input">
          <textarea
            className="sx-in"
            value={text}
            rows={2}
            placeholder="Ask Studio Assistant…"
            aria-label="Message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
            }}
          />
          <div className="as4-send">
            <span className="sx-help"><kbd className="sx-kbd">Enter</kbd> sends · <kbd className="sx-kbd">Shift</kbd>+<kbd className="sx-kbd">Enter</kbd> new line</span>
            {state.running
              ? <Button variant="outline" onClick={() => state.threadId != null && window.api.assistantStop(state.threadId)}><Square aria-hidden="true" />Stop</Button>
              : <Button disabled={!text.trim() || state.threadId == null} onClick={send}><Send aria-hidden="true" />Send</Button>}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}

/** Library row entrance; a plain row when the user asked for less motion. */
function Enter({ children }: { children: ReactNode }) {
  const still = useReducedMotion()
  return still ? <div>{children}</div> : <AnimatedListItem>{children}</AnimatedListItem>
}

function Row({ it, onAnswer }: { it: Item; onAnswer: (id: string, approved: boolean) => void }) {
  if (it.kind === 'user') return <div className="as4-msg me">{it.text}</div>
  if (it.kind === 'assistant') return <div className="as4-msg bot">{it.text}</div>
  if (it.kind === 'error') return <div className="as4-err" role="alert">{it.message}</div>
  if (it.kind === 'tool') {
    return (
      <details className={`as4-tool${it.isError ? ' err' : ''}`}>
        <summary><ChevronRight aria-hidden="true" />{toolLabel(it.name)}…{it.isError ? ' (failed)' : ''}</summary>
        <pre>{JSON.stringify(it.input, null, 2) ?? ''}</pre>
      </details>
    )
  }
  const done = it.outcome !== 'pending'
  return (
    <div className="as4-approve">
      <div className="as4-sum">{it.summary}</div>
      {done ? <div className={`as4-outcome ${it.outcome}`}>{{ approved: 'Approved', denied: 'Denied', expired: 'Not answered', pending: '' }[it.outcome]}</div> : (
        <div className="as4-btns">
          <Button size="sm" onClick={() => onAnswer(it.id, true)}><Check aria-hidden="true" />Approve</Button>
          <Button variant="outline" size="sm" onClick={() => onAnswer(it.id, false)}>Deny</Button>
        </div>
      )}
    </div>
  )
}
