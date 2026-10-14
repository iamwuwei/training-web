import { Link } from "react-router";
import type { ApiActivity, ApiSession } from "../types/api";
import { mdDow } from "../lib/date";
import { duration, km, kmPlan, paceRange, pace } from "../lib/format";
import { activityDate, hrOver, paceFast } from "../lib/plan";
import { Avatar, Reminders, VerdictTag } from "./ui";
import { sportName } from "../lib/labels";

/** A planned session that has not been run yet (today / upcoming). */
export function PlanPost({ session, when, big, weekNo }: { session: ApiSession; when?: string; big?: boolean; weekNo?: boolean }) {
  const dist = session.target_distance_m ? `${kmPlan(session.target_distance_m)} km` : null;
  const target = session.target ?? paceRange(session.target_pace_min_sec_km, session.target_pace_max_sec_km);
  return (
    <article className="post">
      <Avatar session={session} />
      <div className="body">
        <div className="meta">
          <b>{mdDow(session.scheduled_date)}</b>
          <span className="grey">
            {[when, weekNo && session.week_no != null ? `第 ${session.week_no} 週` : null, dist].filter(Boolean).map((x) => `· ${x}`).join(" ")}
          </span>
        </div>
        <p className={`title${big ? " lg" : ""}`}>{session.content ?? session.label ?? ""}</p>
        {target && target !== "–" ? <p className={big ? "text" : "muted"} style={big ? { color: "var(--ink-2)" } : undefined}>{target}</p> : null}
        {session.note ? <p className="muted">{session.note}</p> : null}
        {big && session.phase ? <div className="foot">{session.phase}</div> : null}
      </div>
    </article>
  );
}

/** A rest / strength day row (muted). */
export function RestPost({ session }: { session: ApiSession }) {
  return (
    <article className="post dim">
      <Avatar session={session} />
      <div className="body">
        <div className="meta"><b style={{ color: "var(--ink-2)" }}>{mdDow(session.scheduled_date)}</b><span className="grey">· {session.content ?? session.label ?? "休息"}</span></div>
        {session.note ? <p className="muted" style={{ color: "var(--ink-3)" }}>{session.note}</p> : null}
      </div>
    </article>
  );
}

/** A completed run: memo, verdict, key numbers. Links to the report. */
export function ActivityPost({ activity, session, showReminders, weekNo }: {
  activity: ApiActivity; session: ApiSession | null; showReminders?: boolean; weekNo?: boolean;
}) {
  const r = activity.review;
  const memo = activity.memo ?? activity.description;
  return (
    <Link to={`/activities/${activity.id}`} className="post link">
      <Avatar session={session} sport={activity.sport_type} />
      <div className="body">
        <div className="meta">
          <b>{mdDow(activityDate(activity))}</b>
          <span className="grey">· {session ? (weekNo !== false && session.week_no != null ? `第 ${session.week_no} 週` : "") : "未排課"}</span>
          <VerdictTag verdict={r?.verdict} />
        </div>
        <p className="title">{session?.content ?? `${sportName(activity.sport_type)} ${km(activity.distance_m)} km`}</p>
        {memo ? <p className="text clamp">{activity.rpe ? <b style={{ fontWeight: 600, color: "var(--ink)" }}>RPE {activity.rpe} · </b> : null}{memo}</p> : null}
        {showReminders && r?.reminders.length ? <Reminders items={r.reminders} /> : null}
        <div className="stats">
          <span><b className="num">{km(activity.distance_m)}</b> km</span>
          <span><b className={`num${paceFast(activity, session) ? " over" : ""}`}>{pace(activity.avg_pace_sec_km)}</b> /km</span>
          {activity.avg_hr != null ? <span><b className={`num${hrOver(activity, session) ? " over" : ""}`}>{activity.avg_hr}</b> bpm</span> : null}
          <span><b className="num">{duration(activity.moving_time_sec)}</b></span>
        </div>
      </div>
    </Link>
  );
}
