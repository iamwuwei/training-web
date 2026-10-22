import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { ApiSession, Verdict } from "../types/api";
import { labelStyle, verdictKind } from "../lib/labels";
import { BarsIcon, CalendarIcon, ChatIcon, HomeIcon } from "./icons";

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

/** The coach: an ink disc with a W. The only dark avatar in the app, so it reads as a person, not a session type. */
export function CoachAvatar({ size = 36, badge }: { size?: number; badge?: "check" | "warn" | "typing" | null }) {
  return (
    <div className="avatar coach" style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }} aria-hidden="true">
      W
      {badge === "check" ? <span className="badge check"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 7" /></svg></span> : null}
      {badge === "warn" ? <span className="badge warn">!</span> : null}
      {badge === "typing" ? <span className="badge typing"><i /><i /><i /></span> : null}
    </div>
  );
}

/** Woo's avatar state for a verdict: a check for 達成, an exclamation for 達成但有提醒. */
export function verdictBadge(verdict: Verdict | null | undefined): "check" | "warn" | null {
  return verdict === "達成" ? "check" : verdict === "達成但有提醒" ? "warn" : null;
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

/** `coachUnread`: Woo has posted since the thread was last opened; a dot on the 教練 tab until it is. */
export function TabBar({ coachUnread = false }: { coachUnread?: boolean }) {
  return (
    <div className="tabbar">
      <nav aria-label="主選單">
        <NavLink to="/" end><HomeIcon /><span>今天</span></NavLink>
        <NavLink to="/plan"><CalendarIcon /><span>課表</span></NavLink>
        <NavLink to="/history"><BarsIcon /><span>紀錄</span></NavLink>
        <NavLink to="/coach">
          {({ isActive }) => (
            <>
              <span className="icon"><ChatIcon />{coachUnread && !isActive ? <i className="unread" aria-hidden="true" /> : null}</span>
              <span>{coachUnread && !isActive ? <span className="sr-only">有新訊息 · </span> : null}教練</span>
            </>
          )}
        </NavLink>
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
