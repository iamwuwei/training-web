import { Fragment, useState } from "react";
import type { Route } from "./+types/_app.plan";
import { ActivityPost, PlanPost, RestPost } from "../components/posts";
import { Bar, TopBar } from "../components/ui";
import { md } from "../lib/date";
import { km, kmPlan } from "../lib/format";
import type { Week } from "../lib/plan";
import { NoPlan, usePlan } from "../lib/use-plan";

export function meta(): Route.MetaDescriptors {
  return [{ title: "課表 · 富士山マラソン 2026" }];
}

function WeekBars({ weeks }: { weeks: Week[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.plan_m));
  const first = weeks[0], last = weeks[weeks.length - 1];
  const phases = [...new Set(weeks.map((w) => w.phase?.split("｜").pop()).filter(Boolean))];
  return (
    <section className="weekbars" style={{ "--n": weeks.length } as React.CSSProperties} aria-label="每週跑量">
      <div className="cols">
        {weeks.map((w) => {
          const isRace = w.days.some((d) => d.session.type === "race");
          const h = `${Math.max(6, (w.plan_m / max) * 100)}%`;
          return (
            <div key={w.week_no} className={`col${w.isComplete ? " done" : ""}${isRace ? " race" : ""}`} title={`第 ${w.week_no} 週 ${km(w.actual_m)} / ${kmPlan(w.plan_m)} km`}>
              <i style={{ height: h }}>
                {!w.isComplete && w.actual_m > 0 ? <b style={{ height: `${Math.min(100, (w.actual_m / w.plan_m) * 100)}%` }} /> : null}
              </i>
            </div>
          );
        })}
      </div>
      <div className="labels">
        {weeks.map((w) => {
          const isRace = w.days.some((d) => d.session.type === "race");
          return <span key={w.week_no} className={isRace ? "race" : w.isCurrent ? "cur" : ""}>{isRace ? "42" : w.week_no}</span>;
        })}
      </div>
      <div className="legend">
        <span>{phases.join(" · ")}</span>
        {first && last ? <span>週跑量 {kmPlan(Math.min(...weeks.map((w) => w.plan_m)))}→{kmPlan(Math.max(...weeks.filter((w) => !w.days.some((d) => d.session.type === "race")).map((w) => w.plan_m)))} km</span> : null}
      </div>
    </section>
  );
}

function WeekSection({ week, expanded, onToggle }: { week: Week; expanded: boolean; onToggle: () => void }) {
  const rows = expanded ? week.days : week.days.filter((d) => d.session.type !== "rest" || d.activity);
  return (
    <Fragment>
      <section className="week-row" style={{ paddingTop: 20 }}>
        <button type="button" className="line" onClick={onToggle} aria-expanded={expanded} style={{ width: "100%", textAlign: "left" }}>
          <span>
            <b>第 {week.week_no} 週</b>{" "}
            {week.isCurrent ? <span className="pill">本週</span> : null}{" "}
            <span className="grey">· {md(week.week_start)}–{md(week.week_end)}{week.focus ? ` · ${week.focus}` : ""}</span>
          </span>
          <span className="num" style={week.isFuture ? { color: "var(--ink-3)", fontWeight: 600 } : undefined}>
            {week.isFuture ? kmPlan(week.plan_m) : <>{km(week.actual_m)} <span className="of">/ {kmPlan(week.plan_m)}</span></>}
          </span>
        </button>
        {!week.isFuture ? <Bar value={week.actual_m} max={week.plan_m} tone={week.isComplete ? "good" : undefined} /> : null}
      </section>
      {rows.map((d) =>
        d.activity ? (
          <ActivityPost key={d.session.id} activity={d.activity} session={d.session} weekNo={false} />
        ) : d.session.type === "rest" ? (
          <RestPost key={d.session.id} session={d.session} />
        ) : (
          <PlanRow key={d.session.id} isToday={d.status === "today"} skipped={d.status === "skipped"} session={d.session} />
        ),
      )}
    </Fragment>
  );
}

function PlanRow({ session, isToday, skipped }: { session: Week["days"][number]["session"]; isToday: boolean; skipped: boolean }) {
  return (
    <div style={skipped ? { opacity: 0.55 } : undefined}>
      <PlanPost session={session} when={isToday ? "今天" : skipped ? "跳過" : undefined} />
    </div>
  );
}

export default function Plan() {
  const view = usePlan();
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  if (!view) return <NoPlan title="課表" />;
  const { weeks, currentWeek } = view;
  const current = currentWeek?.week_no ?? weeks.find((w) => w.isFuture)?.week_no ?? weeks[weeks.length - 1]?.week_no;
  // Current week always shows rest days; others only when tapped open.
  const isOpen = (w: Week) => w.week_no === current || open.has(w.week_no);
  const toggle = (w: Week) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(w.week_no)) n.delete(w.week_no);
      else n.add(w.week_no);
      return n;
    });

  // Order: current week first, then future weeks, then past weeks (newest first).
  const ordered = [
    ...weeks.filter((w) => w.week_no === current),
    ...weeks.filter((w) => w.isFuture && w.week_no !== current),
    ...weeks.filter((w) => w.isPast && w.week_no !== current).reverse(),
  ];

  return (
    <>
      <TopBar title="課表" aside={currentWeek ? `第 ${currentWeek.week_no} 週 / ${weeks.length} 週 · ${currentWeek.phase?.split("｜")[0] ?? ""}` : `${weeks.length} 週`} />
      <main>
        <WeekBars weeks={weeks} />
        {ordered.map((w) => <WeekSection key={w.week_no} week={w} expanded={isOpen(w)} onToggle={() => toggle(w)} />)}
        <p className="note">非本週的休息日已折疊，點週標題展開</p>
      </main>
    </>
  );
}
