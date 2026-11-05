import type { ReactNode } from "react";
import { Link } from "react-router";
import { BackIcon } from "./icons";
import { TopBar } from "./ui";

/** 找不到這個群組: unknown, disbanded, or not a member any more — the api answers all three the same, so does the page. */
export function GroupNotFound() {
  return (
    <>
      <TopBar title="群組" />
      <main>
        <div className="group-404">
          <p className="t">找不到這個群組</p>
          <p className="sub">可能已經解散，或你已經不在這個群組裡。</p>
          <Link to="/groups">回群組清單 ›</Link>
        </div>
      </main>
    </>
  );
}

/** Icon-only back link of a 群組 page (the same 44 px target as the report's). */
export function GroupBack({ to, label }: { to: string; label: string }) {
  return <Link to={to} className="back" aria-label={label}><BackIcon /></Link>;
}

/** Title of a 群組 page's TopBar: one line, cut with … when the group's name is long. */
export function TopTitle({ children }: { children: ReactNode }) {
  return <span className="t">{children}</span>;
}

/** A read that failed: the sentence and 再試一次. */
export function LoadFailed({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="group-404">
      <p className="t">{text}</p>
      <button type="button" className="chip" style={{ marginTop: 12 }} onClick={onRetry}>再試一次</button>
    </div>
  );
}

/** Skeleton rows while a page's data is on its way. */
export function RowsSkeleton({ rows = 3, height = 72 }: { rows?: number; height?: number }) {
  return (
    <div aria-busy="true" aria-label="載入中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="group-skeleton-row" style={{ height }}>
          <div className="sk" style={{ width: 36, height: 36, borderRadius: "50%" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <div className="sk" style={{ width: "50%", height: 14 }} />
            <div className="sk" style={{ width: "80%", height: 13 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
