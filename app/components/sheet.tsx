import { useEffect, useRef, type ReactNode } from "react";

/**
 * A bottom sheet over the whole screen, tab bar included. Closes on the backdrop,
 * Escape, or the handle; the page behind stops scrolling while it is open.
 */
export function BottomSheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="關閉" onClick={onClose} />
      <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <button type="button" className="sheet-handle" aria-label="關閉" onClick={onClose}><i /></button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
