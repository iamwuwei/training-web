// Everything the screens show is derived here from one PlanResponse + "today" (JST).
// "跳過" is not an API state: a past, non-rest session with no matched activity.

import type { ApiActivity, ApiSession, ApiWeek, PlanResponse, Verdict } from "../types/api";
import { toJstDate } from "./date";

export type DayStatus = "done" | "today" | "upcoming" | "skipped" | "rest";

export interface Day {
  session: ApiSession;
  activity: ApiActivity | null;
  status: DayStatus;
  /** API verdict, or '跳過' derived, or null. */
  verdict: Verdict | "跳過" | null;
}

export interface Week extends ApiWeek {
  plan_m: number;
  actual_m: number;
  long_m: number;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
  isComplete: boolean;
  days: Day[];
}

export interface PlanView {
  data: PlanResponse;
  today: string;
  days: Day[];
  weeks: Week[];
  byDate: Map<string, Day>;
  activityById: Map<string, ApiActivity>;
  /** Today's row, if the plan covers today. */
  todayDay: Day | null;
  /** Next runs after today, rest days skipped. */
  upcoming: Day[];
  /** Newest completed activity. */
  latest: ApiActivity | null;
  totals: {
    actual_m: number;
    plan_to_date_m: number;
    plan_total_m: number;
    done_count: number;
    /** actual / plan-to-date, 0–100+ */
    pct: number;
  };
  currentWeek: Week | null;
  daysToRace: number;
}

export function sessionOf(view: PlanView, a: ApiActivity): ApiSession | null {
  return view.data.sessions.find((s) => s.id === a.session_id) ?? null;
}

export function buildPlanView(data: PlanResponse, today: string): PlanView {
  const bySession = new Map<string, ApiActivity>();
  for (const a of data.activities) if (a.session_id) bySession.set(a.session_id, a);

  const days: Day[] = data.sessions.map((session) => {
    const activity = bySession.get(session.id) ?? null;
    const isRest = session.type === "rest";
    let status: DayStatus;
    if (activity) status = "done";
    else if (isRest) status = "rest";
    else if (session.scheduled_date === today) status = "today";
    else if (session.scheduled_date < today) status = "skipped";
    else status = "upcoming";
    const verdict: Day["verdict"] = activity ? activity.review?.verdict ?? null : status === "skipped" ? "跳過" : null;
    return { session, activity, status, verdict };
  });

  const byDate = new Map(days.map((d) => [d.session.scheduled_date, d]));
  const activityById = new Map(data.activities.map((a) => [a.id, a]));

  const weeks: Week[] = data.weeks.map((w) => {
    const wd = days.filter((d) => d.session.scheduled_date >= w.week_start && d.session.scheduled_date <= w.week_end);
    const plan_m = wd.reduce((s, d) => s + (d.session.target_distance_m ?? 0), 0);
    const actual_m = wd.reduce((s, d) => s + (d.activity?.distance_m ?? 0), 0);
    const long_m = Math.max(0, ...wd.map((d) => d.session.target_distance_m ?? 0));
    return {
      ...w,
      plan_m,
      actual_m,
      long_m,
      isCurrent: today >= w.week_start && today <= w.week_end,
      isPast: today > w.week_end,
      isFuture: today < w.week_start,
      isComplete: plan_m > 0 && actual_m >= plan_m,
      days: wd,
    };
  });

  const actual_m = data.activities.reduce((s, a) => s + a.distance_m, 0);
  const plan_to_date_m = days
    .filter((d) => d.session.scheduled_date <= today)
    .reduce((s, d) => s + (d.session.target_distance_m ?? 0), 0);
  const plan_total_m = days.reduce((s, d) => s + (d.session.target_distance_m ?? 0), 0);

  const sortedActs = [...data.activities].sort((a, b) => b.start_time.localeCompare(a.start_time));

  return {
    data,
    today,
    days,
    weeks,
    byDate,
    activityById,
    todayDay: byDate.get(today) ?? null,
    upcoming: days.filter((d) => d.session.scheduled_date > today && d.session.type !== "rest").slice(0, 3),
    latest: sortedActs[0] ?? null,
    totals: {
      actual_m,
      plan_to_date_m,
      plan_total_m,
      done_count: data.activities.length,
      pct: plan_to_date_m ? Math.round((actual_m / plan_to_date_m) * 100) : 0,
    },
    currentWeek: weeks.find((w) => w.isCurrent) ?? null,
    daysToRace: Math.round((Date.parse(`${data.plan.race_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
  };
}

/** JST calendar date of an activity. */
export function activityDate(a: ApiActivity): string {
  return toJstDate(a.start_time);
}

/** Is the heart rate over the session's ceiling? Colours the number red. */
export function hrOver(a: ApiActivity, s: ApiSession | null): boolean {
  return a.avg_hr != null && s?.target_hr_max != null && a.avg_hr > s.target_hr_max;
}

/** Is the pace faster than the fastest allowed? */
export function paceFast(a: ApiActivity, s: ApiSession | null): boolean {
  return a.avg_pace_sec_km != null && s?.target_pace_min_sec_km != null && a.avg_pace_sec_km < s.target_pace_min_sec_km;
}
