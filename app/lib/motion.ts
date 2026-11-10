// Motion helpers (01b §7.2, 02 §10). Durations and curves live in app.css (:root: --d-1…--d-4, --d-rm, --spring, --bounce, --ease-exit);
// this file reads them once, so there is one set of numbers. Things that move (a sheet, the coach modal) use the Web Animations API:
// an animation can be read, stopped where it is and handed to a finger, or replaced by another one that starts from the current place.
// Small component animations stay in CSS (transitions).

/** The coach modal slides in from the bottom. `false` makes it fade in and out instead (200 / 150 ms): the one-line way back (01b §5.6). */
export const MODAL_SLIDE = true;

export type Axis = "x" | "y";
export interface Slide {
  /** Resolves when the animation ended (or was stopped). */
  finished: Promise<void>;
  /** Stop where it is: the current transform / opacity is kept as inline style, for the next animation or for a finger. */
  cancelToCurrent(): void;
}

const FALLBACK = { d1: 150, d2: 200, d3: 300, d4: 400, drm: 120, spring: "cubic-bezier(0.32, 0.72, 0, 1)", bounce: "cubic-bezier(0.34, 1.4, 0.64, 1)", exit: "cubic-bezier(0.32, 0, 0.67, 0)" };
let cache: typeof FALLBACK | null = null;
function tok() {
  if (cache) return cache;
  if (typeof document === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  // the build may write 400ms as .4s: read the unit
  const ms = (name: string, fb: number) => {
    const raw = cs.getPropertyValue(name).trim();
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return fb;
    return /[\d.]s$/.test(raw) ? v * 1000 : v;
  };
  const str = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  cache = { d1: ms("--d-1", FALLBACK.d1), d2: ms("--d-2", FALLBACK.d2), d3: ms("--d-3", FALLBACK.d3), d4: ms("--d-4", FALLBACK.d4), drm: ms("--d-rm", FALLBACK.drm), spring: str("--spring", FALLBACK.spring), bounce: str("--bounce", FALLBACK.bounce), exit: str("--ease-exit", FALLBACK.exit) };
  return cache;
}
/** Asked every time, never cached: the person may change the setting while the app is open. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// one running animation per element: a new one starts from where the old one is
const running = new WeakMap<HTMLElement, Animation>();
const settleTimers = new WeakMap<HTMLElement, number>();

function stopAtCurrent(el: HTMLElement) {
  const a = running.get(el);
  if (!a) return;
  try { a.commitStyles(); } catch { /* element not rendered: nothing to keep */ }
  a.cancel();
  running.delete(el);
}

function currentTransform(el: HTMLElement): string {
  const t = getComputedStyle(el).transform;
  return t && t !== "none" ? t : "none";
}

function mark(el: HTMLElement, glass: HTMLElement[] | undefined) {
  el.style.willChange = "transform, opacity";
  for (const g of glass ?? []) { window.clearTimeout(settleTimers.get(g)); g.setAttribute("data-moving", ""); }
}
function unmark(el: HTMLElement, glass: HTMLElement[] | undefined) {
  el.style.willChange = "";
  for (const g of glass ?? []) settleTimers.set(g, window.setTimeout(() => g.removeAttribute("data-moving"), 150)); // glass comes back 150 ms after it stopped (02 §10.4-2)
}

/** `end`: "keep" leaves the final transform / opacity on the element (it left, or faded out); "clear" removes it (it is at rest again). */
function play(el: HTMLElement, keyframes: Keyframe[], duration: number, easing: string, glass: HTMLElement[] | undefined, end: "keep" | "clear"): Slide {
  stopAtCurrent(el);
  mark(el, glass);
  const anim = el.animate(keyframes, { duration, easing, fill: "forwards" });
  running.set(el, anim);
  const finished = anim.finished.then(
    () => {
      if (running.get(el) === anim) {
        if (end === "keep") { try { anim.commitStyles(); } catch { /* ignore */ } }
        anim.cancel();
        running.delete(el);
        if (end === "clear") { el.style.transform = ""; el.style.opacity = ""; }
        unmark(el, glass); // only the animation that is still the element's: one that was replaced must not take the new one's markers (`data-moving`, will-change) away
      }
    },
    () => { /* cancelled: whoever cancelled it owns the element (and its markers) now */ },
  );
  return { finished, cancelToCurrent: () => { if (running.get(el) === anim) stopAtCurrent(el); } };
}

const axisT = (axis: Axis, v: string) => `translate${axis.toUpperCase()}(${v})`;

/** Comes in from the edge (default: all the way out) to rest. From wherever it is now when it was already moving. Reduced motion: a 120 ms fade. */
export function slideIn(el: HTMLElement, axis: Axis, opts: { from?: string; duration?: number; glass?: HTMLElement[] } = {}): Slide {
  const t = tok();
  if (reducedMotion()) { el.style.transform = ""; return fadeTo(el, 1, { duration: t.drm, glass: opts.glass, from: 0, clearAtEnd: true }); }
  const here = currentTransform(el);
  const from = running.has(el) || here !== "none" ? here : opts.from ?? axisT(axis, "100%");
  return play(el, [{ transform: from }, { transform: "none" }], opts.duration ?? t.d4, t.spring, opts.glass, "clear");
}

/** Leaves toward the edge (default: all the way out) in `duration` ms (--d-3), slow start and fast end. Stays at the end until the element is removed. Reduced motion: a 120 ms fade. */
export function slideOut(el: HTMLElement, axis: Axis, duration?: number, opts: { to?: string; glass?: HTMLElement[] } = {}): Slide {
  const t = tok();
  if (reducedMotion()) return fadeTo(el, 0, { duration: t.drm, glass: opts.glass });
  const here = currentTransform(el);
  return play(el, [{ transform: here }, { transform: opts.to ?? axisT(axis, "100%") }], duration ?? t.d3, t.exit, opts.glass, "keep");
}

export interface FadeOpts {
  /** ms; default --d-2 */
  duration?: number;
  /** Pieces of glass that go solid while it runs (`data-moving`). */
  glass?: HTMLElement[];
  /** A start value to force (a fade-in from 0); default: where the opacity is now. */
  from?: number;
  /** Remove the inline opacity at the end (it is at rest again) instead of keeping the end value. */
  clearAtEnd?: boolean;
}

/** Opacity from where it is to `opacity`. */
export function fadeTo(el: HTMLElement, opacity: number, opts: FadeOpts = {}): Slide {
  const t = tok();
  const start = opts.from ?? parseFloat(getComputedStyle(el).opacity);
  return play(el, [{ opacity: Number.isFinite(start) ? start : 1 }, { opacity }], opts.duration ?? t.d2, reducedMotion() ? "linear" : "cubic-bezier(0.25, 0.8, 0.25, 1)", opts.glass, opts.clearAtEnd ? "clear" : "keep");
}

/** Back to rest from a dragged-out place, with a little spring (a sheet that was not pulled far enough). */
export function springBack(el: HTMLElement, glass?: HTMLElement[]): Slide {
  const t = tok();
  if (reducedMotion()) { el.style.transform = ""; return fadeTo(el, 1, { duration: t.drm, glass, from: 1, clearAtEnd: true }); }
  const here = currentTransform(el);
  return play(el, [{ transform: here }, { transform: "none" }], 350, t.spring, glass, "clear");
}

/** Stop whatever is running on `el` where it is (a finger takes over); the current transform stays as inline style. Returns whether something was running. */
export function holdAt(el: HTMLElement): boolean { const was = running.has(el); stopAtCurrent(el); el.style.willChange = ""; return was; }

/** The vertical distance an element is translated by right now (px), from its computed transform. */
export function translateYNow(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  return new DOMMatrixReadOnly(t).m42;
}

/** The coach modal comes in (slides up, or with `MODAL_SLIDE` off fades in 200 ms). `glass`: its bar and composer, solid while it moves. */
export function enterModal(el: HTMLElement, glass?: HTMLElement[]): Slide {
  return MODAL_SLIDE ? slideIn(el, "y", { glass }) : fadeTo(el, 1, { duration: 200, glass, from: 0, clearAtEnd: true });
}
/** …and leaves (300 ms; with `MODAL_SLIDE` off a 150 ms fade). The element stays where it ended until `clearMotion`. */
export function leaveModal(el: HTMLElement, glass?: HTMLElement[]): Slide {
  return MODAL_SLIDE ? slideOut(el, "y", undefined, { glass }) : fadeTo(el, 0, { duration: 150, glass });
}

/** Drop what a finished or stopped animation left on the element (its inline transform and opacity). */
export function clearMotion(el: HTMLElement) {
  stopAtCurrent(el);
  el.style.transform = "";
  el.style.opacity = "";
  el.style.willChange = "";
}
