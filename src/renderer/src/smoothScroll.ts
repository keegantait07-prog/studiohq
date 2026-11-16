import Lenis from 'lenis'

// The window never scrolls (html/body/#root are overflow:hidden), so Lenis is attached to the
// panels that do. Panels mount and unmount with the views, so a MutationObserver keeps them in sync.
// Virtualised lists (.svirt, .cv-rows) and the modal are left alone: they size/measure themselves.
const SELECTOR = '.insp, .crm-main, .plist, .vt-rows'

export function installSmoothScroll(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const active = new Map<HTMLElement, Lenis>()

  const attach = (el: HTMLElement): void => {
    if (active.has(el)) return
    active.set(el, new Lenis({ wrapper: el, content: el, lerp: 0.12, smoothWheel: true }))
  }

  const sync = (): void => {
    for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) attach(el)
    for (const [el, lenis] of active) {
      if (!el.isConnected) {
        lenis.destroy()
        active.delete(el)
      }
    }
  }

  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      sync()
    })
  }).observe(document.getElementById('root')!, { childList: true, subtree: true })

  const raf = (time: number): void => {
    for (const lenis of active.values()) lenis.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
  sync()
}
