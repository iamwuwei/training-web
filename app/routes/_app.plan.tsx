import { useState } from "react";
import type { Route } from "./+types/_app.plan";
import { Link } from "react-router";
import { SessionSheet } from "../components/session-sheet";
import { Avatar, Bar, TopBar } from "../components/ui";
import { md } from "../lib/date";
import { duration, km, kmPlan, pace } from "../lib/format";
import { isStrengthDay, rowName, verdictKind } from "../lib/labels";
import { isRunSport, type Day, type Week } from "../lib/plan";
import { NoPlan, usePlan } from "../lib/use-plan";
import type { ApiSession } from "../types/api";

export function meta(): Route.MetaDescriptors {
  return [{ title: "課表 · 富士山マラソン 2026" }];
}

function WeekBars({ weeks, selected, onSelect }: { weeks: Week[]; selected: number; onSelect: (weekNo: number) => void }) {
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
              aria-label={`第 ${w.week_no} 週 ${km(w.actual_m)} / ${kmPlan(w.plan_m)} km`}
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
          <span key={w.week_no} className={[isRace(w) ? "race" : "", w.isCurrent ? "cur" : "", w.week_no === selected ? "on" : ""].join(" ")}>
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

function DayRow({ day, isToday, onOpen }: { day: Day; isToday: boolean; onOpen: (s: ApiSession) => void }) {
  const { session: s, activity: a, status } = day;
  const date = new Date(`${s.scheduled_date}T00:00:00Z`);
  const rest = s.type === "rest";
  const strength = rest && isStrengthDay(s);
  let right: React.ReactNode = null;
  let dot: string | null = null;
  if (a) {
    const run = isRunSport(a.sport_type);
    right = (
      <>
        {run || a.distance_m > 0 ? <><b className="num">{km(a.distance_m)}</b> km</> : <b className="num">{duration(a.moving_time_sec)}</b>}
        {run && a.avg_pace_sec_km ? <> · <b className="num">{pace(a.avg_pace_sec_km)}</b></> : a.avg_hr != null ? <> · <b className="num">{a.avg_hr}</b> bpm</> : null}
      </>
    );
    dot = verdictKind(a.review?.verdict) ?? "none";
  } else if (status === "skipped") {
    right = <span className="grey">跳過</span>;
    dot = "skip";
  } else if (!rest && s.target) {
    right = <span className="grey">{s.target.replace(/\s*\/\s*/g, " · ")}</span>;
  }
  const sub = !a && !rest && status !== "skipped" ? firstSentence(s.note) : null;
  const inner = (
    <>
      <div className="d"><span className="dow">{DOW[date.getUTCDay()]}</span><span className="num dom">{date.getUTCDate()}</span></div>
      <Avatar session={s} sport={a?.sport_type} />
      <div className="n"><div className={`t${rest && !strength ? " rest" : ""}`}>{rowName(s)}</div>{sub ? <div className="sub">{sub}</div> : null}</div>
      <div className="r">{right}{dot ? <i className={`dot ${dot}`} /> : null}</div>
    </>
  );
  const cls = `dayrow${isToday ? " today" : ""}${status === "skipped" ? " skipped" : ""}`;
  if (a) return <Link to={`/activities/${a.id}`} className={cls}>{inner}</Link>;
  if (rest && !s.note) return <div className={cls}>{inner}</div>;
  return <button type="button" className={cls} onClick={() => onOpen(s)}>{inner}</button>;
}

/** This week: '這週還剩 輕鬆跑 6 km、長跑 16 km'; a past week: '跑了 3 / 4 堂'. */
function remaining(week: Week): string {
  const planned = week.days.filter((d) => d.session.type !== "rest");
  if (week.isPast) return `跑了 ${planned.filter((d) => d.activity).length} / ${planned.length} 堂`;
  const left = planned.filter((d) => !d.activity && d.status !== "skipped").map((d) => rowName(d.session));
  return left.length ? `這週還剩 ${left.join("、")}` : "這週的課都跑完了";
}

export default function Plan() {
  const view = usePlan();
  const [picked, setPicked] = useState<number | null>(null);
  const [open, setOpen] = useState<ApiSession | null>(null);
  if (!view) return <NoPlan title="課表" />;
  const { weeks, currentWeek, today } = view;
  const current = currentWeek?.week_no ?? weeks.find((w) => w.isFuture)?.week_no ?? weeks[weeks.length - 1]?.week_no;
  const selected = picked ?? current;
  const idx = weeks.findIndex((w) => w.week_no === selected);
  const week = weeks[idx];
  const go = (i: number) => (i >= 0 && i < weeks.length ? () => setPicked(weeks[i].week_no) : undefined);

  return (
    <>
      <TopBar title="課表" aside={currentWeek?.phase ? currentWeek.phase : `${weeks.length} 週`} />
      <main>
        <WeekBars weeks={weeks} selected={selected} onSelect={setPicked} />
        {week ? (
          <>
            <div className="week-head2">
              <button type="button" className="step" onClick={go(idx - 1)} disabled={!go(idx - 1)} aria-label="上一週">‹</button>
              <div className="mid">
                <div className="line">
                  <span className="title">第 {week.week_no} 週 {week.isCurrent ? <span className="pill">本週</span> : current != null && current !== week.week_no ? <button type="button" className="back-today" onClick={() => setPicked(current)}>回本週</button> : null}</span>
                  <span className="kms">
                    {week.isFuture ? <><b className="num plan">{kmPlan(week.plan_m)}</b><span className="of"> km</span></> : <><b className={`num${week.isComplete ? " done" : ""}`}>{km(week.actual_m)}</b><span className="of"> / {kmPlan(week.plan_m)} km</span></>}
                  </span>
                </div>
                <div className="sub">{md(week.week_start)}–{md(week.week_end)} · {week.isFuture ? (week.focus ?? "") : remaining(week)}</div>
              </div>
              <button type="button" className="step" onClick={go(idx + 1)} disabled={!go(idx + 1)} aria-label="下一週">›</button>
            </div>
            {!week.isFuture ? <Bar value={week.actual_m} max={week.plan_m} tone={week.isComplete ? "good" : "ink"} /> : null}
            <div className="dayrows">
              {week.days.map((d) => <DayRow key={d.session.id} day={d} isToday={d.session.scheduled_date === today} onOpen={setOpen} />)}
            </div>
          </>
        ) : null}
      </main>
      <SessionSheet session={open} view={view} onClose={() => setOpen(null)} />
    </>
  );
}
