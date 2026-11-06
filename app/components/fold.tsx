import type { ReactNode } from "react";
import { ChevronIcon } from "./icons";

/**
 * 設定頁的手風琴列: a 56 px button row (title left, a one-line summary right while folded, a chevron that turns when open) and the
 * panel under it. The panel stays mounted and is `hidden` while folded, so whatever is inside keeps its state. No storage: the
 * caller owns `open`. Keyboard: the row is a real button (Enter / Space); a hidden panel is skipped by Tab and by screen readers.
 * `id` is the section id (#share, #strava); `${id}-panel` is the panel's.
 */
export function Fold({ id, title, summary, open, onToggle, children }: {
  id: string;
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`fold${open ? " open" : ""}`} id={id} aria-label={title}>
      <h2 className="fold-h">
        <button type="button" className="fold-head" aria-expanded={open} aria-controls={`${id}-panel`} onClick={onToggle}>
          <span className="t">{title}</span>
          {open ? null : <span className="sum">{summary}</span>}
          <ChevronIcon aria-hidden="true" />
        </button>
      </h2>
      <div id={`${id}-panel`} className="fold-panel" hidden={!open}>{children}</div>
    </section>
  );
}
