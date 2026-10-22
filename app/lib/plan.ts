// Everything the screens show is derived here from one PlanResponse + "today" (JST).
// "跳過" is not an API state: a past, non-rest session with no matched activity.

import type { ApiActivity, ApiSession, ApiWeek, PlanResponse, Verdict } from "../types/api";
import { dayDiff, toJstDate } from "./date";

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
  /** Strava activities (any sport) not yet assigned to a session, newest first. */
  unassigned: ApiActivity[];
  /** Everything Strava synced for today (assigned or not), oldest first. */
  todayActivities: ApiActivity[];
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
    unassigned: data.unassigned ?? [],
    todayActivities: [...data.activities, ...(data.unassigned ?? [])]
      .filter((a) => toJstDate(a.start_time) === today)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
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

const RUN_SPORTS = new Set(["Run", "TrailRun", "VirtualRun"]);
export const isRunSport = (sport: string | null | undefined) => !!sport && RUN_SPORTS.has(sport);

/** A session the athlete can log: any training day, plus 肌力 days (which the plan types as rest). */
export function isLoggable(s: ApiSession): boolean {
  return s.type !== "rest" || s.label === "肌力";
}

/** Can this session be logged today? Today, past ones, and the next two days (ran a day early). */
export function isLoggableNow(s: ApiSession, today: string): boolean {
  return isLoggable(s) && dayDiff(today, s.scheduled_date) <= 2;
}

/**
 * Activities the athlete can pick for a session: the unassigned ones within ±2 days
 * (same day first, then closest to the target distance), plus whatever already holds it.
 */
export function candidatesFor(view: PlanView, session: ApiSession): ApiActivity[] {
  const holder = view.byDate.get(session.scheduled_date)?.activity ?? null;
  const near = view.unassigned.filter((a) => Math.abs(dayDiff(session.scheduled_date, activityDate(a))) <= 2);
  const target = session.target_distance_m ?? 0;
  const rank = (a: ApiActivity) => [
    a.id === holder?.id ? 0 : 1,
    activityDate(a) === session.scheduled_date ? 0 : 1,
    target > 0 ? Math.abs(a.distance_m - target) : 0,
  ];
  return [...(holder ? [holder] : []), ...near].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a.start_time.localeCompare(b.start_time);
  });
}

/** Pre-selected pick: the current holder, else the same-day run closest to the target distance. */
export function defaultPick(session: ApiSession, candidates: ApiActivity[]): ApiActivity | null {
  const held = candidates.find((a) => a.session_id === session.id);
  if (held) return held;
  if (session.type === "rest") return null;
  return candidates.find((a) => isRunSport(a.sport_type) && activityDate(a) === session.scheduled_date) ?? null;
}

/**
 * Where an unassigned activity on `date` could be logged: a loggable session within ±2 days
 * that has nothing yet, same day first, then the nearest (later before earlier on ties).
 */
export function sessionForExtra(view: PlanView, date: string): ApiSession | null {
  const open = view.days.filter(
    (d) => !d.activity && isLoggable(d.session) && Math.abs(dayDiff(date, d.session.scheduled_date)) <= 2 && dayDiff(view.today, d.session.scheduled_date) <= 2,
  );
  open.sort((a, b) => {
    const da = dayDiff(date, a.session.scheduled_date), db = dayDiff(date, b.session.scheduled_date);
    return Math.abs(da) - Math.abs(db) || db - da;
  });
  return open[0]?.session ?? null;
}

/**
 * Woo's line before a session: the first reminder from the last reviewed run of
 * the same type (label), e.g. "第 1 km 前 3 分鐘用呼吸不用錶" before the next Easy.
 */
export function lastReminderFor(view: PlanView, session: ApiSession): string | null {
  const label = session.label;
  if (!label) return null;
  const byId = new Map(view.data.sessions.map((s) => [s.id, s]));
  const runs = view.data.activities
    .filter((a) => a.review?.reminders?.length && a.session_id && byId.get(a.session_id)?.label === label && a.session_id !== session.id)
    .sort((a, b) => b.start_time.localeCompare(a.start_time));
  return runs[0]?.review?.reminders[0] ?? null;
}
