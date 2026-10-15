import type { ApiActivity } from "../types/api";
import { md, timeJst } from "../lib/date";
import { duration, km, pace } from "../lib/format";
import { sportName } from "../lib/labels";
import { activityDate, isRunSport } from "../lib/plan";
import { Avatar } from "./ui";

/** One Strava activity as a radio card in the "which activity was this session?" list. */
export function ActivityPick({ activity, checked, onPick, sessionDate }: {
  activity: ApiActivity; checked: boolean; onPick: () => void; sessionDate: string;
}) {
  const date = activityDate(activity);
  const run = isRunSport(activity.sport_type);
  const bits = [
    date === sessionDate ? timeJst(activity.start_time) : `${md(date)} ${timeJst(activity.start_time)}`,
    run ? `${pace(activity.avg_pace_sec_km)}/km` : null,
    activity.avg_hr != null ? `${activity.avg_hr} bpm` : null,
    duration(activity.moving_time_sec),
  ].filter(Boolean);
  return (
    <button type="button" role="radio" aria-checked={checked} className="pick" onClick={onPick}>
      <Avatar session={null} sport={activity.sport_type} />
      <span className="txt">
        <span className="t">{sportName(activity.sport_type)}{run || activity.distance_m > 0 ? ` ${km(activity.distance_m)} km` : ""}</span>
        <span className="s">{bits.join(" · ")}</span>
      </span>
      <span className="radio" aria-hidden="true" />
    </button>
  );
}

/** Compact row in "今天 · 來自 Strava": what synced, and whether it is already a session. */
export function StravaRow({ activity, sessionName }: { activity: ApiActivity; sessionName: string | null }) {
  const run = isRunSport(activity.sport_type);
  return (
    <div className="strava-row">
      <Avatar session={null} sport={activity.sport_type} />
      <span className="txt">
        <span className="t">{sportName(activity.sport_type)}{activity.distance_m > 0 ? ` ${km(activity.distance_m)} km` : ""}</span>
        <span className="s">
          {[timeJst(activity.start_time), run ? `${pace(activity.avg_pace_sec_km)}/km` : null, activity.avg_hr != null ? `${activity.avg_hr} bpm` : null, duration(activity.moving_time_sec)].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className={`state${sessionName ? " done" : ""}`}>{sessionName ? "已記錄" : "未記錄"}</span>
    </div>
  );
}
