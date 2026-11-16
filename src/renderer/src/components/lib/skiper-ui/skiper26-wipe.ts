/**
 * Skiper 26 Theme_buttons_002, circle variant, without next-themes.
 * The original (skiper26.tsx) builds a view-transition stylesheet with createAnimation("circle", start)
 * and calls document.startViewTransition(setTheme). This keeps that exact mechanism (new root snapshot
 * revealed by a growing clip-path circle, old snapshot held underneath) but takes the origin point and
 * the apply callback from the caller, so any app theme switch can use it.
 *
 * Attribution: Skiper UI (https://skiper-ui.com), author @gurvinder-singh02.
 */
const STYLE_ID = "theme-transition-styles";

const css = (x: number, y: number) => `
  ::view-transition-group(root) {
    animation-duration: 0.7s;
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }
  ::view-transition-new(root) {
    animation-name: skiper-reveal;
  }
  ::view-transition-old(root) {
    animation: none;
    z-index: -1;
  }
  @keyframes skiper-reveal {
    from { clip-path: circle(0px at ${x}px ${y}px); }
    to { clip-path: circle(150vmax at ${x}px ${y}px); }
  }
`;

/** Run `apply` inside a circle wipe that grows from (x, y). Falls back to a plain switch when the browser
 *  has no view transitions or the user asked for reduced motion. */
export function startCircleWipe(apply: () => void, x = window.innerWidth / 2, y = window.innerHeight / 2): void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css(Math.round(x), Math.round(y));
  document.startViewTransition(apply);
}
