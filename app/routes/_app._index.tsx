import { Link, useRevalidator } from "react-router";
import type { Route } from "./+types/_app._index";
import { MountainIcon } from "../components/icons";
import { StravaRow } from "../components/pick";
import { ActivityPost, PlanPost, RestPost } from "../components/posts";
import { Bar, SectionH, TopBar } from "../components/ui";
import { md, mdDow, relativeDay } from "../lib/date";
import { km, kmPlan } from "../lib/format";
import { isLoggable, isLoggableNow, sessionOf } from "../lib/plan";
import { NoPlan, usePlan } from "../lib/use-plan";

export function meta(): Route.MetaDescriptors {
  return [{ title: "今天 · 富士山マラソン 2026" }];
}

export default function Today() {
  const view = usePlan();
  const revalidator = useRevalidator();
  if (!view) return <NoPlan title="今天" />;
  const { totals, todayDay, todayActivities, upcoming, latest, currentWeek, daysToRace, data, today } = view;

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

        <SectionH
          action={<button type="button" onClick={() => void revalidator.revalidate()} disabled={revalidator.state === "loading"}>{revalidator.state === "loading" ? "更新中…" : "重新整理"}</button>}
        >
          今天 · {mdDow(today)} · 來自 Strava
        </SectionH>
        {todayActivities.length ? todayActivities.map((a) => (
          <Link key={a.id} to={`/activities/${a.id}`} style={{ display: "block", color: "inherit" }}>
            <StravaRow activity={a} sessionName={a.session_id ? "已記錄" : null} />
          </Link>
        )) : <p className="empty">今天還沒有同步到活動。跑完後按「重新整理」。</p>}

        <SectionH>今天的課表</SectionH>
        {!todayDay ? (
          <p className="empty">{today > data.plan.race_date ? "課表已結束，辛苦了。" : "課表還沒開始。"}</p>
        ) : todayDay.activity ? (
          <>
            <ActivityPost activity={todayDay.activity} session={todayDay.session} showReminders />
            {!todayDay.activity.memo && todayDay.activity.rpe == null ? (
              <Link to={`/sessions/${todayDay.session.id}`} className="cta-row">
                <span>✎</span><span>寫下今天的感受與心得</span><span className="arrow">→</span>
              </Link>
            ) : null}
          </>
        ) : !isLoggable(todayDay.session) ? (
          <>
            <RestPost session={todayDay.session} />
            {todayActivities.some((a) => !a.session_id) ? (
              <p className="note" style={{ textAlign: "left" }}>今天排的是休息。要把上面的活動算進某一堂課，點下面的課表。</p>
            ) : null}
          </>
        ) : (
          <>
            <PlanPost session={todayDay.session} big weekNo />
            <Link to={`/sessions/${todayDay.session.id}`} className="cta-row">
              <span>✎</span>
              <span>{todayActivities.some((a) => !a.session_id) ? "記錄今天的訓練：選活動、寫感受" : "記錄今天的訓練"}</span>
              <span className="arrow">→</span>
            </Link>
          </>
        )}

        <SectionH>下次練習</SectionH>
        {upcoming.length ? upcoming.map((d) => (
          isLoggableNow(d.session, today) ? (
            <Link key={d.session.id} to={`/sessions/${d.session.id}`} style={{ display: "block", color: "inherit" }}>
              <PlanPost session={d.session} when={relativeDay(d.session.scheduled_date, today)} />
            </Link>
          ) : (
            <PlanPost key={d.session.id} session={d.session} when={relativeDay(d.session.scheduled_date, today)} />
          )
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
