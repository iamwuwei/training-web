import { Link, useRevalidator } from "react-router";
import type { Route } from "./+types/_app._index";
import { MountainIcon } from "../components/icons";
import { PlanPost, RestPost } from "../components/posts";
import { Avatar, Bar, SectionH, TopBar, VerdictTag } from "../components/ui";
import { md, mdDow, relativeDay, timeJst } from "../lib/date";
import { duration, int, km, kmPlan, pace } from "../lib/format";
import { shortName, sportName } from "../lib/labels";
import { activityDate, hrOver, isLoggable, isLoggableNow, isRunSport, paceFast, sessionForExtra, type Day, type PlanView } from "../lib/plan";
import { NoPlan, usePlan } from "../lib/use-plan";
import type { ApiActivity } from "../types/api";

export function meta(): Route.MetaDescriptors {
  return [{ title: "今天 · 富士山マラソン 2026" }];
}

// One post per state for today's session: not run → synced (log it) → coach analysing → verdict.
// Everything else (full comment, memo, splits) lives on the report page.

function Stats({ a, day }: { a: ApiActivity; day: Day }) {
  const run = isRunSport(a.sport_type);
  return (
    <div className="stats">
      {run || a.distance_m > 0 ? <span><b className="num">{km(a.distance_m)}</b> km</span> : <span><b className="num">{duration(a.moving_time_sec)}</b></span>}
      {run ? <span><b className={`num${paceFast(a, day.session) ? " over" : ""}`}>{pace(a.avg_pace_sec_km)}</b> /km</span> : null}
      {a.avg_hr != null ? <span><b className={`num${hrOver(a, day.session) ? " over" : ""}`}>{int(a.avg_hr)}</b> bpm</span> : null}
    </div>
  );
}

function TodayPost({ day, view }: { day: Day; view: PlanView }) {
  const { session, activity } = day;

  if (activity) {
    const r = activity.review;
    return (
      <Link to={`/activities/${activity.id}`} className="post link today-post">
        <Avatar session={session} />
        <div className="body">
          <div className="head">
            <b>{shortName(session)}</b>
            {r?.verdict ? <VerdictTag verdict={r.verdict} /> : <span className="pending">教練分析中…</span>}
          </div>
          <Stats a={activity} day={day} />
          {r?.reminders[0] ? <p className="next">→ {r.reminders[0]}</p> : null}
        </div>
      </Link>
    );
  }

  if (!isLoggable(session)) return <RestPost session={session} />;

  const synced = view.todayActivities.filter((a) => !a.session_id);
  const first = synced.find((a) => isRunSport(a.sport_type)) ?? synced[0];
  return (
    <div className="today-open">
      <PlanPost session={session} big />
      {first ? (
        <>
          <p className="synced">
            <i aria-hidden="true" />Strava：{sportName(first.sport_type)}
            {first.distance_m > 0 ? <> <b className="num">{km(first.distance_m)}</b> km</> : null}
            {isRunSport(first.sport_type) ? <> · <b className="num">{pace(first.avg_pace_sec_km)}</b> /km</> : null}
          </p>
          <Link to={`/sessions/${session.id}`} className="btn primary">記錄這次訓練</Link>
        </>
      ) : (
        <p className="hint">跑完後 Strava 會自動同步到這裡</p>
      )}
    </div>
  );
}

function ExtraRow({ a, view }: { a: ApiActivity; view: PlanView }) {
  const target = sessionForExtra(view, activityDate(a));
  const run = isRunSport(a.sport_type);
  return (
    <div className="extra-row">
      <Link to={`/activities/${a.id}`} className="who">
        <Avatar session={null} sport={a.sport_type} />
        <span className="txt">
          <span className="t">{sportName(a.sport_type)} {a.distance_m > 0 ? `${km(a.distance_m)} km` : duration(a.moving_time_sec)}</span>
          <span className="s">{[timeJst(a.start_time), run ? `${pace(a.avg_pace_sec_km)} /km` : null, a.avg_hr != null ? `${a.avg_hr} bpm` : null].filter(Boolean).join(" · ")}</span>
        </span>
      </Link>
      {target ? <Link to={`/sessions/${target.id}`} className="chip">記錄</Link> : null}
    </div>
  );
}

export default function Today() {
  const view = usePlan();
  const revalidator = useRevalidator();
  if (!view) return <NoPlan title="今天" />;
  const { todayDay, todayActivities, upcoming, currentWeek, daysToRace, data, today } = view;

  // The activity surfaced inside today's post (state "synced") is not repeated below.
  const shownInPost = todayDay && !todayDay.activity && isLoggable(todayDay.session)
    ? (todayActivities.filter((a) => !a.session_id).find((a) => isRunSport(a.sport_type)) ?? todayActivities.find((a) => !a.session_id))?.id
    : undefined;
  const extras = todayActivities.filter((a) => !a.session_id && a.id !== shownInPost);

  return (
    <>
      <TopBar
        title={<><MountainIcon />富士山マラソン 2026</>}
        aside={daysToRace > 0 ? <>倒數 <span className="num">{daysToRace}</span> 天</> : daysToRace === 0 ? "比賽日" : "已完賽"}
      />
      <main>
        {currentWeek ? (
          <Link to="/plan" className="week-row week-line">
            <div className="line">
              <span><b>第 {currentWeek.week_no} 週</b> <span className="grey">· {md(currentWeek.week_start)}–{md(currentWeek.week_end)}</span></span>
              <span className="num">{km(currentWeek.actual_m)} <span className="of">/ {kmPlan(currentWeek.plan_m)} km</span></span>
            </div>
            <Bar value={currentWeek.actual_m} max={currentWeek.plan_m} tone={currentWeek.isComplete ? "good" : undefined} />
          </Link>
        ) : null}

        <SectionH
          action={<button type="button" className="chip" onClick={() => void revalidator.revalidate()} disabled={revalidator.state === "loading"}>{revalidator.state === "loading" ? "更新中…" : "重新整理"}</button>}
        >
          今天 · {mdDow(today)}
        </SectionH>
        {todayDay ? (
          <TodayPost day={todayDay} view={view} />
        ) : (
          <p className="empty">{today > data.plan.race_date ? "課表已結束，辛苦了。" : "課表還沒開始。"}</p>
        )}

        {extras.length ? (
          <>
            <SectionH>今天其他活動</SectionH>
            {extras.map((a) => <ExtraRow key={a.id} a={a} view={view} />)}
          </>
        ) : null}

        <SectionH>下次練習</SectionH>
        {upcoming.length ? upcoming.map((d) => {
          const row = (
            <>
              <Avatar session={d.session} />
              <span className="t">{d.session.content ?? shortName(d.session)}</span>
              <span className="when">{md(d.session.scheduled_date)} · {relativeDay(d.session.scheduled_date, today)}</span>
            </>
          );
          return isLoggableNow(d.session, today)
            ? <Link key={d.session.id} to={`/sessions/${d.session.id}`} className="next-row">{row}</Link>
            : <div key={d.session.id} className="next-row">{row}</div>;
        }) : <p className="empty">沒有後續課表</p>}
      </main>
    </>
  );
}
