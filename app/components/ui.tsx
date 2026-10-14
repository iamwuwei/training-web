import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { ApiSession, Verdict } from "../types/api";
import { labelStyle, verdictKind } from "../lib/labels";
import { BarsIcon, CalendarIcon, HomeIcon, UserIcon } from "./icons";

/** Type avatar: coloured disc with a 1–2 character code; rest/strength is a hollow grey ring. */
export function Avatar({ session, sport }: { session: Pick<ApiSession, "label" | "type"> | null | undefined; sport?: string | null }) {
  const s = labelStyle(session, sport);
  const cjk = s.short.charCodeAt(0) > 127;
  return (
    <div className={`avatar ${s.kind}${cjk ? " cjk" : ""}`} aria-hidden="true">
      {s.short}
    </div>
  );
}

export function VerdictTag({ verdict }: { verdict: Verdict | "跳過" | null | undefined }) {
  const kind = verdictKind(verdict);
  if (!kind) return null;
  return <span className={`verdict ${kind}`}>{verdict}</span>;
}

export function Bar({ value, max, tone }: { value: number; max: number; tone?: "good" | "ink" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`bar${tone ? ` ${tone}` : ""}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Reminders({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="reminders">
      {items.map((r, i) => <li key={i}><span>{r}</span></li>)}
    </ul>
  );
}

export function TabBar() {
  return (
    <div className="tabbar">
      <nav aria-label="主選單">
        <NavLink to="/" end aria-label="今天"><HomeIcon /></NavLink>
        <NavLink to="/plan" aria-label="課表"><CalendarIcon /></NavLink>
        <NavLink to="/history" aria-label="紀錄"><BarsIcon /></NavLink>
        <NavLink to="/settings" aria-label="設定"><UserIcon /></NavLink>
      </nav>
    </div>
  );
}

export function TopBar({ title, aside, back }: { title: ReactNode; aside?: ReactNode; back?: ReactNode }) {
  return (
    <header className="topbar">
      <h1>{back}{title}</h1>
      {aside ? <div className="aside">{aside}</div> : null}
    </header>
  );
}

export function SectionH({ children, action }: { children: ReactNode; action?: ReactNode }) {
  if (!action) return <h2 className="section-h">{children}</h2>;
  return (
    <div className="section-row">
      <h2 className="section-h">{children}</h2>
      {action}
    </div>
  );
}

/** Skeleton rows shown while the plan loads (Aurora cold start can take 10 s+). */
export function FeedSkeleton() {
  return (
    <div aria-busy="true" aria-label="載入中">
      <div className="hero">
        <div className="sk" style={{ width: 140, height: 40 }} />
        <div className="sk" style={{ width: "80%", height: 14 }} />
        <div className="sk" style={{ height: 3 }} />
      </div>
      {[0, 1, 2].map((i) => (
        <div className="post" key={i}>
          <div className="sk" style={{ width: 36, height: 36, borderRadius: "50%" }} />
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="sk" style={{ width: "50%", height: 14 }} />
            <div className="sk" style={{ width: "85%", height: 16 }} />
            <div className="sk" style={{ width: "65%", height: 13 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
