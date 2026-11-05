import { useEffect, useId, useRef, useState } from "react";
import type { ApiGroupMember } from "../types/api";
import { CaretDownIcon, CheckIcon } from "./icons";

/**
 * The member dropdown of 大家的課表: one button (his avatar and name, 「你」 for myself) that opens a floating list of every
 * member of the group. A member who does not share his plan is marked 沒分享課表 but can still be picked (the page then
 * says so). It is a popover, not a sheet: two to five rows, so the page behind stays in view.
 * Keyboard: ↑↓ move, Enter picks, Esc or a click outside closes. The glass look is CSS (`.member-menu`).
 */
export function GroupMemberPicker({ members, selectedId, onSelect }: { members: ApiGroupMember[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const current = members.find((m) => m.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const at = Math.max(0, members.findIndex((m) => m.id === selectedId));
    rows.current[at]?.focus();
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, members, selectedId]);

  const close = (refocus: boolean) => { setOpen(false); if (refocus) button.current?.focus(); };
  const pick = (id: string) => { close(true); if (id !== selectedId) onSelect(id); };

  function onMenuKey(e: React.KeyboardEvent) {
    const i = rows.current.findIndex((r) => r === document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); rows.current[Math.min(members.length - 1, i + 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); rows.current[Math.max(0, i - 1)]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); rows.current[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); rows.current[members.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="member-pick-wrap" ref={wrap}>
      <button
        ref={button} type="button" className="member-pick" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
      >
        {current ? <span className="avatar member" aria-hidden="true">{current.display_name.slice(0, 1)}</span> : null}
        <span className="nm">{current ? (current.is_me ? "你" : current.display_name) : "選成員"}</span>
        <CaretDownIcon aria-hidden="true" />
      </button>
      {open ? (
        <div id={listId} className="member-menu" role="listbox" aria-label="選成員" onKeyDown={onMenuKey}>
          {members.map((m, i) => {
            const on = m.id === selectedId;
            return (
              <button
                key={m.id} ref={(el) => { rows.current[i] = el; }} type="button" role="option" aria-selected={on} tabIndex={-1} className="mm-row"
                onClick={() => pick(m.id)}
              >
                <span className="avatar member" aria-hidden="true">{m.display_name.slice(0, 1)}</span>
                <span className="nm">{m.display_name}</span>
                {m.is_me ? <span className="pill">你</span> : !m.shared.plan ? <span className="hint">沒分享課表</span> : <span />}
                {on ? <CheckIcon className="ck" aria-hidden="true" /> : <span />}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
