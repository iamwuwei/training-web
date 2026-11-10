import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import type { ApiSession, Verdict } from "../types/api";
import { labelStyle, verdictKind } from "../lib/labels";
import { rootIndex, lensIndex } from "../lib/nav";
import { CalendarIcon, ChatIcon, GroupIcon, HomeIcon } from "./icons";

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
export function CoachAvatar({ size = 36, badge }: { size?: number; badge?: "check" | "warn" | null }) {
  return (
    <div className="avatar woo" style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }} aria-hidden="true">
      W
      {badge === "check" ? <span className="badge check"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 7" /></svg></span> : null}
      {badge === "warn" ? <span className="badge warn">!</span> : null}
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

/**
 * The floating glass bar with four tabs and a lens under the selected one (01b §6.1, 02 §2.2). The lens slides to the tab of the
 * current path; a page outside the tabs (報告, 加入群組) leaves it where it was, 設定 sits under 今天.
 * `coachUnread`: Woo has posted since the thread was last opened; a dot on the 教練 tab until it is. (The coach page is a modal with no tab bar, so the tab is never the active one while the bar is drawn.)
 * `groupsUnread`: some group has 消息中心 events I have not seen (`groups_unread` of GET /plan); the same dot on the 群組 tab.
 */
export function TabBar({ coachUnread = false, groupsUnread = false }: { coachUnread?: boolean; groupsUnread?: boolean }) {
  const { pathname } = useLocation();
  const idx = lensIndex(pathname);
  const cur = rootIndex(pathname);
  const here = (i: number, root: string): "page" | "true" | undefined => (cur === i ? (pathname === root ? "page" : "true") : undefined);
  return (
    <div className="tabbar glass">
      <nav aria-label="主選單">
        <i className="lens" aria-hidden="true" style={{ transform: `translateX(${idx * 100}%)` }} />
        <Link to="/" aria-current={here(0, "/")}><HomeIcon /><span>今天</span></Link>
        <Link to="/plan" aria-current={here(1, "/plan")}><CalendarIcon /><span>課表</span></Link>
        <Link to="/groups" aria-current={here(2, "/groups")}>
          <span className="icon"><GroupIcon />{groupsUnread && cur !== 2 ? <i className="unread" aria-hidden="true" /> : null}</span>
          <span>{groupsUnread && cur !== 2 ? <span className="sr-only">有新動態 · </span> : null}群組</span>
        </Link>
        <Link to="/coach">
          <span className="icon"><ChatIcon />{coachUnread ? <i className="unread" aria-hidden="true" /> : null}</span>
          <span>{coachUnread ? <span className="sr-only">有新訊息 · </span> : null}教練</span>
        </Link>
      </nav>
    </div>
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
