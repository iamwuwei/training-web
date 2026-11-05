import { Link } from "react-router";
import { km, kmPlan } from "../lib/format";
import { mdPlain, memberRowKind } from "../lib/groups";
import type { ApiGroup, ApiGroupMember } from "../types/api";
import { ChevronIcon } from "./icons";
import { Bar } from "./ui";

/** The "—" of a missing longest run (full-width dash, not the "–" of `km()`). */
const longest = (m: number | null) => (m == null ? "—" : `${km(m)} km`);

/**
 * One member on the dashboard (01 D3): six kinds of row, one for each thing the page can know about him.
 * The whole row is a link to his plan (大家的課表). No red or amber for "behind": coral only when the week is done.
 */
export function GroupMemberRow({ group, member: m, today }: { group: Pick<ApiGroup, "id" | "race_date">; member: ApiGroupMember; today: string }) {
  const kind = memberRowKind(group, m, today);
  const p = m.progress;
  const week = p?.plan?.week ?? null;
  const total = p?.plan?.total ?? null;
  const done = kind === "week" && !!week && week.plan_m > 0 && week.actual_m >= week.plan_m;
  const planEnds = kind === "week" && p?.plan && p.plan.race_date !== group.race_date ? `課表排到 ${mdPlain(p.plan.race_date)}` : null;
  const note = kind === "range_no_week" ? "本週沒排課" : kind === "ahead" ? "課表還沒排到這場" : kind === "finished" ? "這場已經比完了" : kind === "no_plan" ? "還沒有課表" : planEnds;
  const pctText = total ? ` · 整體 ${total.pct}%` : "";
  return (
    <Link to={`/groups/${group.id}/plans?m=${encodeURIComponent(m.id)}`} className="group-member">
      <div className="avatar member" aria-hidden="true">{m.display_name.slice(0, 1)}</div>
      <div className="body">
        <div className="l1">
          <span className="name">{m.display_name}</span>
          {m.is_me ? <span className="pill">你</span> : null}
          {m.role === "owner" ? <span className="role">擁有者</span> : null}
          {kind === "week" && week ? (
            <span className={`wk${done ? " done" : ""}`}><b className="num">{km(week.actual_m)}</b><span className="of">/ {kmPlan(week.plan_m)} km</span></span>
          ) : p && (kind === "range_no_week" || kind === "ahead" || kind === "finished" || kind === "no_plan") ? (
            p.runs.week_runs > 0 ? <span className="wk"><b className="num">{km(p.runs.week_actual_m)}</b><span className="of">km</span></span> : <span className="wk none">本週還沒跑</span>
          ) : null}
          <ChevronIcon className="go" aria-hidden="true" />
        </div>
        {kind === "week" && week ? <Bar value={week.actual_m} max={week.plan_m} tone={done ? "good" : "ink"} /> : null}
        {kind === "hidden" ? <div className="l3 none">沒有分享進度</div> : null}
        {kind === "week" && week ? <div className="l3">本週 {week.done_count}/{week.plan_count} 堂{pctText} · 最長 {longest(p?.runs.longest_m ?? null)}</div> : null}
        {kind === "range_no_week" && p ? <div className="l3">本週 {p.runs.week_runs} 趟{pctText} · 最長 {longest(p.runs.longest_m)}</div> : null}
        {(kind === "ahead" || kind === "finished" || kind === "no_plan") && p ? <div className="l3">本週 {p.runs.week_runs} 趟 · 最長 {longest(p.runs.longest_m)}</div> : null}
        {note ? <div className="l4">{note}</div> : null}
      </div>
    </Link>
  );
}
