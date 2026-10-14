import { Link } from "react-router";
import type { Route } from "./+types/_app._index";
import { MountainIcon } from "../components/icons";
import { ActivityPost, PlanPost, RestPost } from "../components/posts";
import { Bar, SectionH, TopBar } from "../components/ui";
import { md, mdDow, relativeDay } from "../lib/date";
import { km, kmPlan } from "../lib/format";
import { sessionOf } from "../lib/plan";
import { NoPlan, usePlan } from "../lib/use-plan";

export function meta(): Route.MetaDescriptors {
  return [{ title: "今天 · 富士山マラソン 2026" }];
}

export default function Today() {
  const view = usePlan();
  if (!view) return <NoPlan title="今天" />;
  const { totals, todayDay, upcoming, latest, currentWeek, daysToRace, data, today } = view;

  return (
    <>
      <TopBar
        title={<><MountainIcon />富士山マラソン 2026</>}
        aside={daysToRace > 0 ? <>倒數 <span className="num">{daysToRace}</span> 天</> : daysToRace === 0 ? "比賽日" : "已完賽"}
      />
      <main>
        <section className="hero">
          <div className="big"><span className="num">{km(totals.actual_m)}</span><span>km 累積</span></div>
          <div className="sub">
            課表至今 {kmPlan(totals.plan_to_date_m)} km · 達成 {totals.pct}% · {totals.done_count} 次練習 · 全程 {kmPlan(totals.plan_total_m)} km
          </div>
          <Bar value={totals.actual_m} max={totals.plan_to_date_m} tone={totals.pct >= 100 ? "good" : undefined} />
        </section>

        <SectionH>今天 · {mdDow(today)}</SectionH>
        {!todayDay ? (
          <p className="empty">{today > data.plan.race_date ? "課表已結束，辛苦了。" : "課表還沒開始。"}</p>
        ) : todayDay.activity ? (
          <ActivityPost activity={todayDay.activity} session={todayDay.session} showReminders />
        ) : todayDay.session.type === "rest" ? (
          <RestPost session={todayDay.session} />
        ) : (
          <PlanPost session={todayDay.session} big weekNo />
        )}

        <SectionH>下次練習</SectionH>
        {upcoming.length ? upcoming.map((d) => (
          <PlanPost key={d.session.id} session={d.session} when={relativeDay(d.session.scheduled_date, today)} />
        )) : <p className="empty">沒有後續課表</p>}

        <SectionH>最新報告</SectionH>
        {latest ? <ActivityPost activity={latest} session={sessionOf(view, latest)} /> : <p className="empty">還沒有紀錄</p>}

        {currentWeek ? (
          <>
            <SectionH action={<Link to="/plan">完整課表</Link>}>本週</SectionH>
            <section className="week-row">
              <div className="line">
                <span>
                  <b>第 {currentWeek.week_no} 週</b>{" "}
                  <span className="grey">· {md(currentWeek.week_start)}–{md(currentWeek.week_end)}{currentWeek.focus ? ` · ${currentWeek.focus}` : ""}</span>
                </span>
                <span className="num">{km(currentWeek.actual_m)} <span className="of">/ {kmPlan(currentWeek.plan_m)}</span></span>
              </div>
              <Bar value={currentWeek.actual_m} max={currentWeek.plan_m} tone={currentWeek.isComplete ? "good" : undefined} />
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
