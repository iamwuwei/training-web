// Everything the screens show is derived here from one PlanResponse + "today" (JST).
// "跳過" is not an API state: a past, non-rest session with no matched activity.

import type { ApiActivity, ApiRoutine, ApiSession, ApiWeek, PlanResponse, Verdict } from "../types/api";
import { dayDiff, md, toJstDate } from "./date";
import { isStrengthDay, rowName } from "./labels";

export type DayStatus = "done" | "today" | "upcoming" | "skipped" | "rest" | "moved";

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
  /** The seven calendar days (what the rows show). A make-up shows on the day it is run, whichever week it counts in. */
  days: Day[];
  /** Every row that counts in this week (`counts_in_week_no`): may hold a make-up from another calendar week, and leaves out a replaced 已改期 row. Km, 堂數 and the bar come from these. */
  counted: Day[];
}

export interface PlanView {
  data: PlanResponse;
  today: string;
  days: Day[];
  weeks: Week[];
  byDate: Map<string, Day>;
  activityById: Map<string, ApiActivity>;
  /** Woo's 肌力 checklist per session, where one was asked for. */
  routineBySession: Map<string, ApiRoutine>;
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

/**
 * A row's `counts_in_week_no` when the api did not send it (web deployed before the api, or rows from before): an
 * ordinary row counts in the calendar week it is on, so the numbers do not collapse to zero. A real null
 * (an 已改期 row the make-up replaced) stays null: it has `moved_to_date`.
 */
function withCounts(data: PlanResponse): PlanResponse {
  const weekOn = (date: string) => data.weeks.find((w) => date >= w.week_start && date <= w.week_end)?.week_no ?? null;
  if (!data.sessions.some((s) => s.counts_in_week_no == null && !s.moved_to_date)) return data;
  return { ...data, sessions: data.sessions.map((s) => (s.counts_in_week_no == null && !s.moved_to_date ? { ...s, counts_in_week_no: weekOn(s.scheduled_date) } : s)) };
}

export function buildPlanView(raw: PlanResponse, today: string): PlanView {
  const data = withCounts(raw);
  const bySession = new Map<string, ApiActivity>();
  for (const a of data.activities) if (a.session_id) bySession.set(a.session_id, a);

  const days: Day[] = data.sessions.map((session) => {
    const activity = bySession.get(session.id) ?? null;
    const isRest = session.type === "rest";
    let status: DayStatus;
    if (session.moved_to_date) status = "moved"; // 補課: the day it was moved away from — not skipped, not rest
    else if (activity) status = "done";
    else if (isRest) status = "rest";
    else if (session.scheduled_date === today) status = "today";
    else if (session.scheduled_date < today) status = "skipped";
    else status = "upcoming";
    const verdict: Day["verdict"] = activity ? activity.review?.verdict ?? null : status === "skipped" ? "跳過" : null;
    return { session, activity, status, verdict };
  });

  // 已改期 rows sort last and a Map keeps the last entry per key, so an 已改期 row would win over a live row on the same date. That does not happen: its date is in the past and nothing new lands on a past date.
  const byDate = new Map([...days].sort((a, b) => Number(a.status === "moved") - Number(b.status === "moved")).map((d) => [d.session.scheduled_date, d]));
  const activityById = new Map(data.activities.map((a) => [a.id, a]));

  const weeks: Week[] = data.weeks.map((w) => {
    const wd = days.filter((d) => d.session.scheduled_date >= w.week_start && d.session.scheduled_date <= w.week_end);
    // km, 堂數 and completion follow `counts_in_week_no`; the rows shown follow the calendar
    const counted = days.filter((d) => d.session.counts_in_week_no === w.week_no);
    const plan_m = counted.reduce((s, d) => s + (d.session.target_distance_m ?? 0), 0);
    const actual_m = counted.reduce((s, d) => s + (d.activity?.distance_m ?? 0), 0);
    const long_m = Math.max(0, ...counted.map((d) => d.session.target_distance_m ?? 0));
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
      counted,
    };
  });

  const actual_m = data.activities.reduce((s, a) => s + a.distance_m, 0);
  // a row with no `counts_in_week_no` (an 已改期 row whose make-up took its place) is in no total
  const counting = days.filter((d) => d.session.counts_in_week_no != null);
  const plan_to_date_m = counting
    .filter((d) => d.session.scheduled_date <= today)
    .reduce((s, d) => s + (d.session.target_distance_m ?? 0), 0);
  const plan_total_m = counting.reduce((s, d) => s + (d.session.target_distance_m ?? 0), 0);

  const sortedActs = [...data.activities].sort((a, b) => b.start_time.localeCompare(a.start_time));

  return {
    data,
    today,
    days,
    weeks,
    byDate,
    activityById,
    routineBySession: new Map((data.routines ?? []).map((r) => [r.session_id, r])),
    unassigned: data.unassigned ?? [],
    todayActivities: [...data.activities, ...(data.unassigned ?? [])]
      .filter((a) => toJstDate(a.start_time) === today)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
    todayDay: byDate.get(today) ?? null,
    upcoming: days.filter((d) => d.session.scheduled_date > today && d.session.type !== "rest" && d.status !== "moved").slice(0, 3),
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

/** A session the athlete can log: any training day, plus 肌力 days (which the plan types as rest). An 已改期 row is not one. */
export function isLoggable(s: ApiSession): boolean {
  return !s.moved_to_date && (s.type !== "rest" || isStrengthDay(s));
}

/** The week number a 補課 counts in, read off its new row ('算第 N 週'); null when that row is not in the plan. */
export function movedCountsIn(view: Pick<PlanView, "data">, placeholder: ApiSession): number | null {
  const to = placeholder.moved_to_session_id ? view.data.sessions.find((x) => x.id === placeholder.moved_to_session_id) : null;
  return to?.counts_in_week_no ?? null;
}

/**
 * The week sub-line: past '跑了 2 / 3 堂' (+ 補課 suffixes), this week '這週還剩 …', a future week its focus.
 * Rows count by `counts_in_week_no`: a make-up that counts here is in 堂數 wherever its day is; an 已改期 row
 * whose make-up counts in another week stays here as a missed one.
 */
export function weekSubline(week: Week, view: Pick<PlanView, "data">): string {
  const makeups = week.counted.filter((d) => d.session.moved_from_date);
  if (week.isFuture) {
    return [makeups.length ? `含 ${makeups.length} 堂補課` : null, week.focus].filter(Boolean).join(" · ");
  }
  if (week.isPast) {
    const planned = week.counted.filter((d) => d.session.type !== "rest");
    let out = `跑了 ${planned.filter((d) => d.activity).length} / ${planned.length} 堂`;
    const open = makeups.filter((d) => !d.activity);
    const done = makeups.length - open.length;
    if (open.length) out += ` · ${open.length} 堂補課（${open.map((d) => md(d.session.scheduled_date)).join("、")}）`;
    if (done) out += ` · 含 ${done} 堂補課`;
    // the 已改期 rows of this week whose make-up counts in another week
    const elsewhere = week.counted.filter((d) => d.status === "moved");
    if (elsewhere.length) {
      const nos = [...new Set(elsewhere.map((d) => movedCountsIn(view, d.session)).filter((n): n is number => n != null))].sort((a, b) => a - b);
      out += ` · ${elsewhere.length} 堂補課算在第 ${nos.join("、")} 週`;
    }
    return out;
  }
  // this week: what is still to run among the rows that count in this week, in date order. A make-up is marked; one run in
  // another calendar week also says its day. (A make-up that counts in another week is not listed: its km are not in this week's numbers.)
  const left = week.counted
    .filter((d) => d.session.type !== "rest" && !d.activity && d.status !== "skipped" && d.status !== "moved")
    .sort((a, b) => a.session.scheduled_date.localeCompare(b.session.scheduled_date))
    .map((d) => {
      const s = d.session;
      const mark = !s.moved_from_date ? "" : s.scheduled_date < week.week_start || s.scheduled_date > week.week_end ? `（補課 ${md(s.scheduled_date)}）` : "（補課）";
      return rowName(s) + mark;
    });
  return left.length ? `這週還剩 ${left.join("、")}` : "這週的課都跑完了";
}

/**
 * Where an unassigned activity on `date` could be logged: a loggable session within ±2 days
 * that has nothing yet, same day first, then the nearest (later before earlier on ties).
 */
export function sessionForExtra(view: PlanView, a: ApiActivity): ApiSession | null {
  const date = activityDate(a);
  const run = isRunSport(a.sport_type);
  const open = view.days.filter(
    (d) => !d.activity && isLoggable(d.session) && (run ? d.session.type !== "rest" : isStrengthDay(d.session))
      && Math.abs(dayDiff(date, d.session.scheduled_date)) <= 2 && dayDiff(view.today, d.session.scheduled_date) <= 2,
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
  const r = runs[0]?.review?.reminders[0];
  if (!r) return null;
  // A reminder may open with the observation ("第 1 km 6:35 起跑偏快；前 3 分鐘用呼吸不用錶"):
  // before the run only the instruction matters.
  const action = r.split(/[；;]/).map((x) => x.trim()).filter(Boolean).pop() ?? r;
  return `這次記得：${action}`;
}
