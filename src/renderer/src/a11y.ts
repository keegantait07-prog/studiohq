import type { KeyboardEvent, SyntheticEvent } from 'react'

/** Props that make a non-button element (a list row, a tree node) work from the keyboard: Tab to it, Enter or Space to activate. */
export function clickable(onActivate: (e: SyntheticEvent) => void): {
  onClick: (e: SyntheticEvent) => void
  role: 'button'
  tabIndex: 0
  onKeyDown: (e: KeyboardEvent) => void
} {
  return {
    onClick: onActivate,
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return // a key pressed inside a nested input or button is not ours
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(e) }
    }
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function topModal(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('.overlay > .modal')
  return all.length ? all[all.length - 1] : null
}

/**
 * Gives every dialog (".overlay > .modal") the basics screen-reader and keyboard users need, in one place:
 * dialog role, focus moves in when it opens, Tab stays inside it, and focus goes back to where it was when it closes.
 */
export function installDialogA11y(): void {
  const opened = new Map<HTMLElement, Element | null>()

  const sync = (): void => {
    const now = new Set(document.querySelectorAll<HTMLElement>('.overlay > .modal'))
    for (const m of now) {
      if (opened.has(m)) continue
      opened.set(m, document.activeElement)
      m.setAttribute('role', 'dialog')
      m.setAttribute('aria-modal', 'true')
      const label = m.querySelector('h1, h2, h3')
      if (label && !m.hasAttribute('aria-label')) m.setAttribute('aria-label', label.textContent?.trim() ?? '')
      if (!m.contains(document.activeElement)) {
        m.tabIndex = -1
        ;(m.querySelector<HTMLElement>(FOCUSABLE) ?? m).focus({ preventScroll: true })
      }
    }
    for (const [m, from] of opened) {
      if (now.has(m)) continue
      opened.delete(m)
      if (from instanceof HTMLElement && from.isConnected && !topModal()) from.focus({ preventScroll: true })
    }
  }
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return
    const m = topModal()
    if (!m) return
    const items = [...m.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (!items.length) { e.preventDefault(); return }
    const first = items[0], last = items[items.length - 1]
    if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); return }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  })
}
