import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fadeTo, holdAt, reducedMotion, slideIn, slideOut, springBack, translateYNow } from "../lib/motion";

// Sheets can stack (the invite sheet opens a confirm sheet over itself), so what a sheet does to the page is shared:
// the page (.shell) stays inert and the body stays unscrollable until the LAST open sheet is gone, and only the topmost
// sheet is live (the ones under it are inert too, and only it answers Escape).
const stack: HTMLElement[] = [];
let savedOverflow = "";
function lock(root: HTMLElement) {
  if (stack.length === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
  // a DOM attribute, not a React prop: the shell is drawn by the layout, the sheet by whatever component opened it
  document.querySelector<HTMLElement>(".shell")?.setAttribute("inert", "");
  for (const r of stack) r.setAttribute("inert", "");
  stack.push(root);
}
function unlock(root: HTMLElement | null) {
  const i = root ? stack.indexOf(root) : -1;
  if (i >= 0) stack.splice(i, 1);
  if (stack.length > 0) { stack[stack.length - 1].removeAttribute("inert"); return; }
  document.body.style.overflow = savedOverflow;
  document.querySelector<HTMLElement>(".shell")?.removeAttribute("inert");
}

/** Pulled down more than this, or faster than this (px/ms) when let go: the sheet closes; otherwise it springs back (02 §2.8). */
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 0.6;

interface Drag { id: number; y0: number; base: number; moved: boolean; held: boolean; samples: { t: number; y: number }[] }

/**
 * A bottom sheet over the whole screen, tab bar included, drawn under <body> (portal) so the page (.shell) can be made
 * inert while it is open: keyboard focus, screen readers and taps stay inside the sheet. Closes on the backdrop,
 * Escape (not while an input method is composing), the handle, or by pulling the handle / the title (.st) down; the page behind
 * stops scrolling; focus goes back to the element that opened it. Several sheets may be open at once (see `stack` above).
 *
 * It slides in (400 ms) and out (300 ms); the page behind is live again as soon as it starts to leave. While it is dragged the sheet follows
 * the finger (pulling up gives 1/3 of the distance) and can be caught again mid-animation. With reduced motion it only fades and does not follow a finger.
 */
export function BottomSheet({ open, onClose, label, className, children }: { open: boolean; onClose: () => void; label: string; className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLButtonElement>(null);
  // The latest onClose / open without re-running the effects below: they focus the panel, which must happen once per open, not on every keystroke inside the sheet.
  const closeRef = useRef(onClose);
  const openRef = useRef(open);
  useEffect(() => { closeRef.current = onClose; openRef.current = open; });
  // While it leaves, the panel is drawn from the children it had when it was last open (the page has usually emptied them by then).
  const [shown, setShown] = useState(open);
  const [kept, setKept] = useState<ReactNode>(open ? children : null);
  if (open && !shown) setShown(true);
  if (open && kept !== children) setKept(children);

  useEffect(() => {
    if (!open) return;
    const el = root.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lock(el);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.isComposing && stack[stack.length - 1] === el) closeRef.current(); };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock(el);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  // in: slide up (400 ms --spring) and the scrim fades in; out: slide down (300 ms --ease-exit), scrim out, then it is removed
  const wasUp = useRef(false);
  useLayoutEffect(() => {
    const p = panel.current, r = root.current, b = backdrop.current;
    if (!p || !r || !b) return;
    if (open) {
      p.removeAttribute("inert");
      r.style.pointerEvents = "";
      slideIn(p, "y", { glass: [p] });
      fadeTo(b, 1, { from: wasUp.current ? undefined : 0, clearAtEnd: true });
      wasUp.current = true;
      return;
    }
    // leaving: nothing under it is blocked any more (unlock ran), and the leaving sheet takes no touches
    p.setAttribute("inert", "");
    r.style.pointerEvents = "none";
    const out = slideOut(p, "y", undefined, { glass: [p] });
    const fade = fadeTo(b, 0);
    void Promise.all([out.finished, fade.finished]).then(() => {
      if (openRef.current) return; // opened again while it was leaving
      wasUp.current = false;
      setShown(false);
      setKept(null); // what the sheet showed is not kept past its leaving (it may hold a link that is shown once)
    });
  }, [open]);

  // pulling down by the handle or the title
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!open || reducedMotion()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!(e.target as HTMLElement).closest(".grab, .st")) return;
    const p = panel.current;
    if (!p || stack[stack.length - 1] !== root.current) return; // only the sheet on top
    // catch it where it is (an opening sheet can be caught)
    const held = holdAt(p);
    if (backdrop.current) holdAt(backdrop.current);
    // no pointer capture yet: a tap on the handle must still be a click on the handle (capturing at pointerdown would send the click to the panel)
    drag.current = { id: e.pointerId, y0: e.clientY, base: translateYNow(p), moved: false, held, samples: [{ t: e.timeStamp, y: e.clientY }] };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current, p = panel.current;
    if (!d || !p || e.pointerId !== d.id) return;
    const raw = e.clientY - d.y0;
    if (!d.moved && Math.abs(raw) > 4) { d.moved = true; p.setPointerCapture(e.pointerId); } // from here on the pointer is the sheet's
    if (!d.moved) return;
    const ty = d.base + (raw >= 0 ? raw : raw / 3); // pulling up gives a third of the distance
    p.style.transform = `translateY(${ty}px)`;
    p.setAttribute("data-moving", ""); // solid while it moves (02 §10.4-2)
    if (backdrop.current) backdrop.current.style.opacity = String(Math.max(0, 1 - Math.max(0, ty) / p.offsetHeight));
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
  };
  const settle = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current, p = panel.current, b = backdrop.current;
    if (!d || !p || e.pointerId !== d.id) return;
    drag.current = null;
    if (p.hasPointerCapture(e.pointerId)) p.releasePointerCapture(e.pointerId);
    const back = () => { void springBack(p, [p]); if (b) void fadeTo(b, 1, { clearAtEnd: true }); };
    if (!d.moved) { if (d.held) back(); return; } // a tap: the handle's own click closes; a tap that stopped the opening animation lets it finish
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 60);
    const ty = translateYNow(p);
    // the speed is the speed at the moment of release: the release itself is a sample, so a hand that flicked and then rested before letting go has v ≈ 0
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
    const first = d.samples[0], last = d.samples[d.samples.length - 1];
    const v = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0; // px/ms over the last ~100 ms; down is positive
    if (!cancelled && (ty > CLOSE_DISTANCE || v > CLOSE_VELOCITY)) {
      closeRef.current();
      // a sheet that does not let go (a busy form, a question to answer first) is still open a frame later: it springs back
      requestAnimationFrame(() => requestAnimationFrame(() => { if (openRef.current) back(); }));
    } else back();
  };

  if ((!open && !shown) || typeof document === "undefined") return null;
  return createPortal(
    <div ref={root} className="sheet-root">
      <button ref={backdrop} type="button" className="sheet-backdrop" aria-label="關閉" onClick={onClose} />
      <div
        ref={panel}
        className={className ? `sheet ${className}` : "sheet"}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => settle(e, false)}
        onPointerCancel={(e) => settle(e, true)}
        onClickCapture={(e) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false; } }}
      >
        <button type="button" className="grab" aria-label="關閉" onClick={onClose}><i /></button>
        <div className="sheet-body">{open ? children : kept}</div>
      </div>
    </div>,
    document.body,
  );
}
