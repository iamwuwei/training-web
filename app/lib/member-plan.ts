// Another member's plan (GET /groups/{id}/members/{mid}/plan) drawn with the plan page's own code: the api sends a
// read-only subset, this fills in what `buildPlanView` expects and leaves everything the subset does not carry empty.
//
// READ-ONLY PROJECTION: the result is never sent anywhere — it must not be given to any PUT/POST (ids are not real,
// `user_id` and Strava ids are empty on purpose).

import type { ApiActivity, ApiSession, MemberPlanResponse, PlanResponse } from "../types/api";

const NO_DETAILS: ApiActivity["details"] = { gear_name: { source: null, strava: null }, device_name: { source: null, strava: null }, weather: { source: null, strava: null } };

/** One shared activity as an `ApiActivity` (memo, gear, device, weather … are empty: they are never shared). */
export function sharedToActivity(a: MemberPlanResponse["activities"][number]): ApiActivity {
  const r = a.review;
  return {
    id: a.id, user_id: "", strava_activity_id: "", session_id: a.session_id, sport_type: a.sport_type, start_time: a.start_time,
    distance_m: a.distance_m, moving_time_sec: a.moving_time_sec, avg_pace_sec_km: a.avg_pace_sec_km, avg_hr: a.avg_hr, max_hr: a.max_hr,
    avg_watts: null, kcal: null, description: null, memo: null, rpe: null, memo_updated_at: null,
    device_name: null, gear_name: null, weather: null, details: NO_DETAILS, details_updated_at: null,
    splits: a.splits, match_status: "confirmed", elapsed_time_sec: a.elapsed_time_sec, segment: a.segment,
    review: r ? { verdict: r.verdict, comment: r.comment, reminders: r.reminders, source: r.source, model: null, adjust_hint: null, failed: r.failed, error: null, created_at: r.created_at, corrected_at: r.corrected_at } : null,
  };
}

/** `null` when he has no plan to show (his `plan` switch is off, or he has no active plan). */
export function toPlanResponse(m: MemberPlanResponse): PlanResponse | null {
  if (!m.plan) return null;
  const sessions: ApiSession[] = m.sessions.map((s) => ({ ...s, plan_id: "shared", version: 1 }));
  return {
    coach_unread: 0, coach_checkin_open: false, coach_ask_kind: null,
    plan: { id: "shared", user_id: "", race_name: m.plan.race_name, race_date: m.plan.race_date, goal_time_sec: m.plan.goal_time_sec, days_per_week: null, status: "active" },
    weeks: m.weeks, sessions, activities: m.activities.map(sharedToActivity), unassigned: [], routines: [], constraints: [], groups_unread: 0,
  };
}

/** 「課表排到 ○/○」: the plan's own race date, which is not necessarily the group's. */
export function memberPlanRange(m: MemberPlanResponse): string | null {
  return m.plan ? m.plan.race_date : null;
}
