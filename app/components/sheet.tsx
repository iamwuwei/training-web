import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A bottom sheet over the whole screen, tab bar included, drawn under <body> (portal) so the page (.shell) can be made
 * inert while it is open: keyboard focus, screen readers and taps stay inside the sheet. Closes on the backdrop,
 * Escape, or the handle; the page behind stops scrolling; focus goes back to the element that opened it.
 * One sheet at a time (nothing nests them): a second one opened over the first would remove `inert` when it closes first.
 */
export function BottomSheet({ open, onClose, label, className, children }: { open: boolean; onClose: () => void; label: string; className?: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose without re-running the effect below: it focuses the panel, which must happen once per open, not on every keystroke inside the sheet.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shell = document.querySelector<HTMLElement>(".shell");
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // a DOM attribute, not a React prop: the shell is drawn by the layout, the sheet by whatever component opened it
    shell?.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      shell?.removeAttribute("inert");
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="關閉" onClick={onClose} />
      <div ref={panel} className={className ? `sheet ${className}` : "sheet"} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <button type="button" className="sheet-handle" aria-label="關閉" onClick={onClose}><i /></button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
