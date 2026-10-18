import { Fragment, useState } from "react";
import type { Route } from "./+types/_app.plan";
import { Link, redirect, useRevalidator } from "react-router";
import { CoachProposals } from "../components/proposals";
import { ApiError, getWeekly } from "../lib/api";
import { hasSession } from "../lib/auth";
import { ActivityPost, PlanPost, RestPost } from "../components/posts";
import { Bar, TopBar } from "../components/ui";
import { md } from "../lib/date";
import { km, kmPlan } from "../lib/format";
import { isLoggable, isLoggableNow, type Week } from "../lib/plan";
import { NoPlan, usePlan } from "../lib/use-plan";

// The weekly coach review (summary + proposals) sits above the plan; the plan itself
// comes from the parent route through usePlan().
export async function clientLoader() {
  if (!hasSession()) throw redirect("/login");
  try {
    return await getWeekly();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    // No weekly review yet (or an older API): the plan page still works.
    return { reviews: [] };
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "課表 · 富士山マラソン 2026" }];
}

function WeekBars({ weeks, selected, onSelect }: { weeks: Week[]; selected: number; onSelect: (weekNo: number) => void }) {
  const max = Math.max(1, ...weeks.map((w) => w.plan_m));
  const first = weeks[0], last = weeks[weeks.length - 1];
  const phases = [...new Set(weeks.map((w) => w.phase?.split("｜").pop()).filter(Boolean))];
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
      <div className="legend">
        <span>{phases.join(" · ")}</span>
        {first && last ? <span>週跑量 {kmPlan(Math.min(...weeks.map((w) => w.plan_m)))}→{kmPlan(Math.max(...weeks.filter((w) => !isRace(w)).map((w) => w.plan_m)))} km</span> : null}
      </div>
    </section>
  );
}

function WeekSection({ week, today, onPrev, onNext, onToday }: {
  week: Week; today: string; onPrev?: () => void; onNext?: () => void; onToday?: () => void;
}) {
  return (
    <Fragment>
      <section className="week-row week-head">
        <div className="line">
          <button type="button" className="step" onClick={onPrev} disabled={!onPrev} aria-label="上一週">‹</button>
          <span className="title">
            <b>第 {week.week_no} 週</b>{" "}
            {week.isCurrent ? <span className="pill">本週</span> : onToday ? <button type="button" className="back-today" onClick={onToday}>回本週</button> : null}
            <span className="grey sub">{md(week.week_start)}–{md(week.week_end)}{week.focus ? ` · ${week.focus}` : ""}</span>
          </span>
          <span className="num" style={week.isFuture ? { color: "var(--ink-3)", fontWeight: 600 } : undefined}>
            {week.isFuture ? kmPlan(week.plan_m) : <>{km(week.actual_m)} <span className="of">/ {kmPlan(week.plan_m)}</span></>}
          </span>
          <button type="button" className="step" onClick={onNext} disabled={!onNext} aria-label="下一週">›</button>
        </div>
        {!week.isFuture ? <Bar value={week.actual_m} max={week.plan_m} tone={week.isComplete ? "good" : undefined} /> : null}
      </section>
      {week.days.map((d) =>
        d.activity ? (
          <ActivityPost key={d.session.id} activity={d.activity} session={d.session} weekNo={false} />
        ) : !isLoggable(d.session) ? (
          <RestPost key={d.session.id} session={d.session} />
        ) : (
          <PlanRow key={d.session.id} today={today} isToday={d.status === "today"} skipped={d.status === "skipped"} session={d.session} />
        ),
      )}
    </Fragment>
  );
}

function PlanRow({ session, isToday, skipped, today }: { session: Week["days"][number]["session"]; isToday: boolean; skipped: boolean; today: string }) {
  const post = <PlanPost session={session} when={isToday ? "今天" : skipped ? "跳過" : undefined} />;
  // Today, past and the next two days can be logged (pick the Strava activity + write the feeling).
  const loggable = isLoggableNow(session, today);
  return (
    <div style={skipped ? { opacity: 0.55 } : undefined}>
      {loggable ? <Link to={`/sessions/${session.id}`} style={{ display: "block", color: "inherit" }}>{post}</Link> : post}
    </div>
  );
}

export default function Plan({ loaderData }: Route.ComponentProps) {
  const view = usePlan();
  const revalidator = useRevalidator();
  const [picked, setPicked] = useState<number | null>(null);
  if (!view) return <NoPlan title="課表" />;
  const { weeks, currentWeek } = view;
  const current = currentWeek?.week_no ?? weeks.find((w) => w.isFuture)?.week_no ?? weeks[weeks.length - 1]?.week_no;
  const selected = picked ?? current;
  const idx = weeks.findIndex((w) => w.week_no === selected);
  const week = weeks[idx];
  const go = (i: number) => (i >= 0 && i < weeks.length ? () => setPicked(weeks[i].week_no) : undefined);

  return (
    <>
      <TopBar title="課表" aside={currentWeek ? `第 ${currentWeek.week_no} 週 / ${weeks.length} 週 · ${currentWeek.phase?.split("｜")[0] ?? ""}` : `${weeks.length} 週`} />
      <main>
        <WeekBars weeks={weeks} selected={selected} onSelect={setPicked} />
        {loaderData.reviews[0] ? (
          <CoachProposals review={loaderData.reviews[0]} sessions={view.data.sessions} onChanged={() => void revalidator.revalidate()} />
        ) : null}
        {week ? (
          <WeekSection
            key={week.week_no}
            week={week}
            today={view.today}
            onPrev={go(idx - 1)}
            onNext={go(idx + 1)}
            onToday={current != null && current !== week.week_no ? () => setPicked(current) : undefined}
          />
        ) : null}
        <p className="note">點上面的長條切換週</p>
      </main>
    </>
  );
}
