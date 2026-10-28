import { useEffect, useRef, type ReactNode } from "react";

/**
 * A bottom sheet over the whole screen, tab bar included. Closes on the backdrop,
 * Escape, or the handle; the page behind stops scrolling while it is open.
 */
export function BottomSheet({ open, onClose, label, className, children }: { open: boolean; onClose: () => void; label: string; className?: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose without re-running the effect below: it focuses the panel, which must happen once per open, not on every keystroke inside the sheet.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="關閉" onClick={onClose} />
      <div ref={panel} className={className ? `sheet ${className}` : "sheet"} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <button type="button" className="sheet-handle" aria-label="關閉" onClick={onClose}><i /></button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
