import { Fragment, useLayoutEffect, useRef, type ReactNode } from "react";
import { PushLink } from "./push-link";
import { mdDow, md } from "../lib/date";
import { duration, km, kmPlan, pace } from "../lib/format";
import { isStrengthDay, rowName, verdictKind } from "../lib/labels";
import { changeIn } from "../lib/motion";
import { isRunSport, movedCountsIn, targetLines, type Day, type PlanView, type Week } from "../lib/plan";
import type { ApiRoutine, ApiSession } from "../types/api";
import { Avatar } from "./ui";

// The week bars and the day rows of the plan page. The 群組 plan page (someone else's plan) draws the same two with `readonly`.

/**
 * What changes with the week (the seven days, the note, the other activities), under the week card that stays: when `weekNo` changes it comes in from the side the week
 * is on (a later week from the right, an earlier from the left; 02 §10.3 M-week). The card's own numbers just change.
 */
export function WeekBody({ weekNo, children }: { weekNo: number; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const prev = useRef(weekNo);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = weekNo;
    if (was !== weekNo && el.current) void changeIn(el.current, weekNo > was ? 1 : -1);
  }, [weekNo]);
  return <div ref={el} className="week-body">{children}</div>;
}

/** What of another member's plan the page may draw: his `runs` switch (the actual numbers, the link to the report) and `reviews` (the verdict dot). */
export interface ReadOnly { runs: boolean; reviews: boolean }

export function WeekBars({ weeks, selected, onSelect, changed, readonly }: { weeks: Week[]; selected: number; onSelect: (weekNo: number) => void; changed?: Set<number>; readonly?: ReadOnly }) {
  const max = Math.max(1, ...weeks.map((w) => w.plan_m));
  const isRace = (w: Week) => w.days.some((d) => d.session.type === "race");
  // the race week is labelled with the race's distance in km (42 for a marathon, 21 for a half …), 42 when the row carries none
  const raceKm = (w: Week) => { const m = w.days.find((d) => d.session.type === "race")?.session.target_distance_m; return m ? String(Math.round(m / 1000)) : "42"; };
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
            {isRace(w) ? raceKm(w) : w.week_no}
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

/** U+00A0: a number and its unit never part at a line end (「輕鬆跑 8 km」 wraps as 「輕鬆跑／8 km」, not 「輕鬆跑 8／km」). */
const NB = "\u00a0";
const glueUnits = (t: string) => t.replace(/(\d)\s+(km|項|堂|週|天|分|秒|bpm)(?![A-Za-z])/g, `$1${NB}$2`);

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

export function DayRow({ day, view, weekNo, isToday, onOpen, routine, was, preview, readonly }: { day: Day; view: PlanView; weekNo: number; isToday: boolean; onOpen: (s: ApiSession) => void; routine: ApiRoutine | null; was?: string; preview?: boolean; readonly?: ReadOnly }) {
  const { session: s, activity: a } = day;
  // readonly, his `runs` off: there are no recordings to compare with, so a past session is not "跳過" — every row looks like one not run yet
  const status = readonly && !readonly.runs && day.status === "skipped" ? "upcoming" : day.status;
  const date = new Date(`${s.scheduled_date}T00:00:00Z`);
  const rest = s.type === "rest";
  const strength = rest && isStrengthDay(s);
  let lines: React.ReactNode[] = [];
  let dot: string | null = null;
  if (status === "moved") { lines = [<span key="m" className="grey">已改期</span>]; dot = "moved"; }
  else if (a && day.combined) {
    const c = day.combined; const run = isRunSport(c.sport_type);
    lines = [
      run || c.distance_m > 0 ? <Fragment key="a"><b className="num">{km(c.distance_m)}</b><span className="u">{NB}km</span></Fragment> : <b key="a" className="num">{duration(c.moving_time_sec)}</b>,
      run && c.avg_pace_sec_km ? <Fragment key="b"><b className="num">{pace(c.avg_pace_sec_km)}</b><span className="u">{NB}/km</span></Fragment> : c.avg_hr != null ? <Fragment key="b"><b className="num">{c.avg_hr}</b><span className="u">{NB}bpm</span></Fragment> : null,
    ];
    dot = verdictKind(a.review?.verdict) ?? "none";
  } else if (routine?.completed_at) {
    const n = routine.items.filter((i) => i.done).length;
    lines = [<Fragment key="a"><b className="num">{n}/{routine.items.length}</b><span className="u">{NB}項</span></Fragment>, routine.rpe ? <Fragment key="b"><span className="u">RPE{NB}</span><b className="num">{routine.rpe}</b></Fragment> : null];
    dot = "good";
  } else if (status === "skipped") { lines = [<span key="s" className="grey">跳過</span>]; dot = "skip"; }
  else if (!rest && s.target) { lines = targetLines(s.target).map((t) => <span key={t} className="grey">{t}</span>); }
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
      <div className="n"><div className={`t${rest && !strength ? " rest" : ""}`}>{glueUnits(rowName(s))}</div>{!was && sub ? <div className={`sub${s.moved_to_date || s.moved_from_date ? " wrap" : ""}`}>{sub}</div> : null}</div>
      <div className="r"><span className="stack">{lines.filter(Boolean).map((l, i) => <span key={i} className="l">{l}</span>)}</span>{dot ? <i className={`dot ${dot}`} /> : null}</div>
      {was ? <div className="was">{was}</div> : null}
    </>
  );
  const cls = `dayrow${isToday ? " today" : ""}${status === "skipped" ? " skipped" : ""}${status === "moved" ? " moved" : ""}${was ? " changed" : ""}`;
  if (a && !readonly) return <PushLink to={`/activities/${a.id}`} className={cls}>{inner}</PushLink>; // someone else's row never links to a report
  if (preview || (rest && !s.note && !s.brief)) return <div className={cls}>{inner}</div>; // a preview row carries its "原本" line instead of a sheet
  return <button type="button" className={cls} onClick={() => onOpen(s)}>{inner}</button>;
}
