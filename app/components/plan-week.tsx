import { Link } from "react-router";
import { mdDow, md } from "../lib/date";
import { duration, km, kmPlan, pace } from "../lib/format";
import { isStrengthDay, rowName, verdictKind } from "../lib/labels";
import { isRunSport, movedCountsIn, type Day, type PlanView, type Week } from "../lib/plan";
import type { ApiRoutine, ApiSession } from "../types/api";
import { Avatar } from "./ui";

// The week bars and the day rows of the plan page. The 群組 plan page (someone else's plan) draws the same two with `readonly`.

/** What of another member's plan the page may draw: his `runs` switch (the actual numbers, the link to the report) and `reviews` (the verdict dot). */
export interface ReadOnly { runs: boolean; reviews: boolean }

export function WeekBars({ weeks, selected, onSelect, changed, readonly }: { weeks: Week[]; selected: number; onSelect: (weekNo: number) => void; changed?: Set<number>; readonly?: ReadOnly }) {
  const max = Math.max(1, ...weeks.map((w) => w.plan_m));
  const isRace = (w: Week) => w.days.some((d) => d.session.type === "race");
  return (
    <section className="weekbars" style={{ "--n": weeks.length } as React.CSSProperties} aria-label="每週跑量，點一週切換下面的課表">
      <div className="cols" role="tablist" aria-label="週">
        {weeks.map((w) => {
          const h = `${Math.max(6, (w.plan_m / max) * 100)}%`;
          const on = w.week_no === selected;
          return (
            <button
              key={w.week_no}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={readonly && !readonly.runs ? `第 ${w.week_no} 週 ${kmPlan(w.plan_m)} km` : `第 ${w.week_no} 週 ${km(w.actual_m)} / ${kmPlan(w.plan_m)} km`}
              className={`col${w.isComplete ? " done" : ""}${isRace(w) ? " race" : ""}${on ? " on" : ""}`}
              onClick={() => onSelect(w.week_no)}
            >
              <i style={{ height: h }}>
                {!w.isComplete && w.actual_m > 0 ? <b style={{ height: `${Math.min(100, (w.actual_m / w.plan_m) * 100)}%` }} /> : null}
              </i>
            </button>
          );
        })}
      </div>
      <div className="labels" aria-hidden="true">
        {weeks.map((w) => (
          <span key={w.week_no} className={[isRace(w) ? "race" : "", w.isCurrent ? "cur" : "", w.week_no === selected ? "on" : "", changed?.has(w.week_no) ? "changed" : ""].join(" ")}>
            {isRace(w) ? "42" : w.week_no}
          </span>
        ))}
      </div>
    </section>
  );
}

/** The first sentence of a note, for the one sub-line a row has room for. */
function firstSentence(t: string | null): string | null {
  if (!t) return null;
  const m = /^[^。！？!?；;]+/.exec(t.trim());
  return m ? m[0] : t;
}

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

export function DayRow({ day, view, weekNo, isToday, onOpen, routine, was, preview, readonly }: { day: Day; view: PlanView; weekNo: number; isToday: boolean; onOpen: (s: ApiSession) => void; routine: ApiRoutine | null; was?: string; preview?: boolean; readonly?: ReadOnly }) {
  const { session: s, activity: a } = day;
  // readonly, his `runs` off: there are no recordings to compare with, so a past session is not "跳過" — every row looks like one not run yet
  const status = readonly && !readonly.runs && day.status === "skipped" ? "upcoming" : day.status;
  const date = new Date(`${s.scheduled_date}T00:00:00Z`);
  const rest = s.type === "rest";
  const strength = rest && isStrengthDay(s);
  let right: React.ReactNode = null;
  let dot: string | null = null;
  if (status === "moved") {
    right = <span className="grey">已改期</span>;
    dot = "moved";
  } else if (a && day.combined) {
    const c = day.combined;
    const run = isRunSport(c.sport_type);
    right = (
      <>
        {run || c.distance_m > 0 ? <><b className="num">{km(c.distance_m)}</b> km</> : <b className="num">{duration(c.moving_time_sec)}</b>}
        {run && c.avg_pace_sec_km ? <> · <b className="num">{pace(c.avg_pace_sec_km)}</b></> : c.avg_hr != null ? <> · <b className="num">{c.avg_hr}</b> bpm</> : null}
      </>
    );
    dot = verdictKind(a.review?.verdict) ?? "none";
  } else if (routine?.completed_at) {
    const n = routine.items.filter((i) => i.done).length;
    right = <><b className="num">{n}/{routine.items.length}</b> 項{routine.rpe ? <> · RPE <b className="num">{routine.rpe}</b></> : null}</>;
    dot = "good";
  } else if (status === "skipped") {
    right = <span className="grey">跳過</span>;
    dot = "skip";
  } else if (!rest && s.target) {
    right = <span className="grey">{s.target.replace(/\s*\/\s*/g, " · ")}</span>;
  }
  // readonly, his `reviews` off: no verdict dot at all (not even the grey one)
  if (readonly && !readonly.reviews && dot !== "moved") dot = null;
  // 補課 rows: the second line is the row's identity ('補 10/27 的課'), kept after the run; 算第 N 週 only when it counts in another week than the one it sits in
  const countsIn = status === "moved" ? movedCountsIn(view, s) : s.counts_in_week_no;
  const other = countsIn != null && countsIn !== weekNo ? ` · 算第 ${countsIn} 週` : "";
  const own = status === "moved" && s.moved_to_date ? `補到 ${mdDow(s.moved_to_date)}${other}`
    : s.moved_from_date ? `補 ${md(s.moved_from_date)} 的課${other}`
    : !a && !rest && status !== "skipped" ? s.brief ?? firstSentence(s.note) : null;
  // several recordings: 「2 筆紀錄」 closes the line (after the 補課 identity when the row has one)
  const sub = day.combined && day.combined.count > 1 ? [own, `${day.combined.count} 筆紀錄`].filter(Boolean).join(" · ") : own;
  const inner = (
    <>
      <div className="d"><span className="dow">{DOW[date.getUTCDay()]}</span><span className="num dom">{date.getUTCDate()}</span></div>
      <Avatar session={s} sport={a?.sport_type} />
      <div className="n"><div className={`t${rest && !strength ? " rest" : ""}`}>{rowName(s)}</div>{!was && sub ? <div className={`sub${s.moved_to_date || s.moved_from_date ? " wrap" : ""}`}>{sub}</div> : null}</div>
      <div className="r">{right}{dot ? <i className={`dot ${dot}`} /> : null}</div>
      {was ? <div className="was">{was}</div> : null}
    </>
  );
  const cls = `dayrow${isToday ? " today" : ""}${status === "skipped" ? " skipped" : ""}${status === "moved" ? " moved" : ""}${was ? " changed" : ""}`;
  if (a && !readonly) return <Link to={`/activities/${a.id}`} className={cls}>{inner}</Link>; // someone else's row never links to a report
  if (preview || (rest && !s.note && !s.brief)) return <div className={cls}>{inner}</div>; // a preview row carries its "原本" line instead of a sheet
  return <button type="button" className={cls} onClick={() => onOpen(s)}>{inner}</button>;
}
