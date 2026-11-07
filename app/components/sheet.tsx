import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

/**
 * A bottom sheet over the whole screen, tab bar included, drawn under <body> (portal) so the page (.shell) can be made
 * inert while it is open: keyboard focus, screen readers and taps stay inside the sheet. Closes on the backdrop,
 * Escape (not while an input method is composing), or the handle; the page behind stops scrolling; focus goes back to
 * the element that opened it. Several sheets may be open at once (see `stack` above).
 */
export function BottomSheet({ open, onClose, label, className, children }: { open: boolean; onClose: () => void; label: string; className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose without re-running the effect below: it focuses the panel, which must happen once per open, not on every keystroke inside the sheet.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
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
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={root} className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="關閉" onClick={onClose} />
      <div ref={panel} className={className ? `sheet ${className}` : "sheet"} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <button type="button" className="sheet-handle" aria-label="關閉" onClick={onClose}><i /></button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
