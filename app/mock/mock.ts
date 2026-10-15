// Turns training-api's seed/plans.json into the shapes the API returns, so the
// UI runs with no backend. Mirrors seed/seed.ts: one session per date, hand-typed
// results become an activity + manual review on the same local date.

import plans from "./plans.json";
import type { ActivitiesResponse, ApiActivity, ApiSession, ApiWeek, MatchStatus, MeResponse, PlanResponse, PutMemoRequest, PutMemoResponse, PutSessionRequest, PutSessionResponse, Verdict } from "../types/api";
import { todayJst } from "../lib/date";
const MOCK_USER_ID = "7d1c3a0e-4f7b-4d2e-9c1a-5b8e2f6a1c01"; // ww in training-api seed

interface SeedSession {
  date: string; week_no: number; phase: string; label: string; type: ApiSession["type"];
  distance_m: number; content: string | null; note: string | null; target: string | null;
  pace_min_sec_km: number | null; pace_max_sec_km: number | null; hr_min: number | null; hr_max: number | null;
  pace_sec_km: number | null;
}
interface SeedWeek { week_no: number; start: string; end: string; phase: string | null; focus: string | null }
interface SeedResult {
  date: string; distance_m: number; memo: string | null; moving_time_sec: number; pace_sec_km: number | null;
  avg_hr: number | null; max_hr: number | null; avg_watts: number | null; kcal: number | null;
  weather: string | null; shoes: string | null; device: string | null; verdict: Verdict | null; reminders: string[];
}
interface SeedPlan {
  user: string; race_name: string; race_date: string; goal_time_sec?: number | null; days_per_week?: number | null;
  weeks?: SeedWeek[]; sessions: SeedSession[]; results?: SeedResult[];
}

const seed = (plans as SeedPlan[])[0];
const PLAN_ID = "mock-plan";

function build(): PlanResponse {
  const sessions: ApiSession[] = seed.sessions.map((s) => ({
    id: `s-${s.date}`,
    plan_id: PLAN_ID,
    scheduled_date: s.date,
    week_no: s.week_no,
    phase: s.phase,
    label: s.label,
    type: s.type,
    content: s.content,
    note: s.note,
    target: s.target,
    target_distance_m: s.distance_m,
    target_pace_sec_km: s.pace_sec_km,
    target_pace_min_sec_km: s.pace_min_sec_km,
    target_pace_max_sec_km: s.pace_max_sec_km,
    target_hr_min: s.hr_min,
    target_hr_max: s.hr_max,
    version: 1,
    superseded: false,
  }));

  const weeks: ApiWeek[] = (seed.weeks ?? []).map((w) => ({
    week_no: w.week_no, week_start: w.start, week_end: w.end, phase: w.phase, focus: w.focus,
  }));

  const byDate = new Map(sessions.map((s) => [s.scheduled_date, s]));
  const activities: ApiActivity[] = (seed.results ?? []).map((r) => {
    const session = byDate.get(r.date) ?? null;
    return {
      id: `a-${r.date}`,
      user_id: MOCK_USER_ID,
      strava_activity_id: r.date.replace(/-/g, ""),
      session_id: session?.id ?? null,
      sport_type: "Run",
      // 07:00 JST on that day
      start_time: new Date(`${r.date}T07:00:00+09:00`).toISOString(),
      distance_m: r.distance_m,
      moving_time_sec: r.moving_time_sec,
      avg_pace_sec_km: r.pace_sec_km,
      avg_hr: r.avg_hr,
      max_hr: r.max_hr,
      avg_watts: r.avg_watts,
      kcal: r.kcal,
      description: null,
      memo: r.memo,
      rpe: null,
      memo_updated_at: r.memo ? new Date(`${r.date}T12:00:00+09:00`).toISOString() : null,
      device_name: r.device,
      gear_name: r.shoes,
      weather: r.weather,
      splits: null,
      match_status: session ? "auto" : "unplanned",
      review: {
        verdict: r.verdict,
        comment: null,
        reminders: r.reminders ?? [],
        rpe: null,
        source: "manual",
        model: null,
        created_at: new Date(`${r.date}T12:00:00+09:00`).toISOString(),
      },
    };
  });

  // Demo inbox: two things Strava "just synced" today, waiting for the athlete to pick a session.
  const today = todayJst();
  const base = { user_id: MOCK_USER_ID, description: null, memo: null, rpe: null, memo_updated_at: null, gear_name: null, weather: null, splits: null, session_id: null, match_status: "unplanned" as const, review: null };
  const unassigned: ApiActivity[] = [
    { ...base, id: "u-run", strava_activity_id: "900001", sport_type: "Run", start_time: new Date(`${today}T06:40:00+09:00`).toISOString(), distance_m: 6020, moving_time_sec: 2676, avg_pace_sec_km: 445, avg_hr: 141, max_hr: 149, avg_watts: null, kcal: 392, device_name: "Apple Watch Series 11" },
    { ...base, id: "u-hyrox", strava_activity_id: "900002", sport_type: "WeightTraining", start_time: new Date(`${today}T18:30:00+09:00`).toISOString(), distance_m: 0, moving_time_sec: 3480, avg_pace_sec_km: null, avg_hr: 152, max_hr: 171, avg_watts: null, kcal: 620, device_name: "Apple Watch Series 11" },
  ];

  return {
    plan: {
      id: PLAN_ID,
      user_id: MOCK_USER_ID,
      race_name: seed.race_name,
      race_date: seed.race_date,
      goal_time_sec: seed.goal_time_sec ?? null,
      days_per_week: seed.days_per_week ?? null,
      status: "active",
    },
    weeks,
    sessions,
    activities,
    unassigned,
  };
}

let cache: PlanResponse | undefined;
const data = () => (cache ??= build());

export function mockPlan(): PlanResponse {
  const d = data();
  return { ...d, activities: d.activities.filter((a) => a.session_id), unassigned: d.unassigned.filter((a) => !a.session_id) };
}

export function mockMe(): MeResponse {
  return {
    user: { id: MOCK_USER_ID, display_name: "Wei Wu", email: "wei@example.com" },
    strava: { athlete_id: "12345678", scope: "read,activity:read_all", expires_at: new Date(Date.now() + 3600_000).toISOString() },
    strava_connect_url: `https://example.invalid/strava/oauth/start?user=${MOCK_USER_ID}`,
  };
}

/** Demo mode: update the in-memory activity so the editor round-trips. */
export function mockPutMemo(activityId: string, body: PutMemoRequest): PutMemoResponse {
  const a = findActivity(activityId);
  if (!a) throw new Error("not found");
  a.memo = body.memo && body.memo.trim() ? body.memo.trim() : null;
  a.rpe = body.rpe ?? null;
  a.memo_updated_at = new Date().toISOString();
  return { activity: { ...a } };
}

const findActivity = (id: string) => [...data().activities, ...data().unassigned].find((x) => x.id === id);

/** Demo mode: assign an unassigned activity to a session; the "coach" answers after ~4 s. */
export function mockPutSession(activityId: string, body: PutSessionRequest): PutSessionResponse {
  const d = data();
  const a = findActivity(activityId);
  if (!a) throw new Error("not found");
  if (body.session_id) {
    const holder = d.activities.find((x) => x.session_id === body.session_id && x.id !== a.id);
    if (holder) { holder.session_id = null; holder.match_status = "unplanned"; holder.review = null; }
    a.session_id = body.session_id;
    a.match_status = "confirmed";
    a.review = null;
    if (body.memo !== undefined || body.rpe !== undefined) {
      a.memo = body.memo && body.memo.trim() ? body.memo.trim() : null;
      a.rpe = body.rpe ?? null;
      a.memo_updated_at = new Date().toISOString();
    }
    setTimeout(() => {
      a.review = { verdict: "達成", comment: "（示範）數據落在課表目標內，感受也一致。", reminders: [], source: "claude", model: "claude-haiku-4-5", created_at: new Date().toISOString() };
    }, 4000);
  } else {
    a.session_id = null;
    a.match_status = body.status ?? "unplanned";
    a.review = null;
  }
  d.activities = d.activities.filter((x) => x.session_id || x.id !== a.id);
  d.unassigned = d.unassigned.filter((x) => x.id !== a.id);
  if (a.session_id) d.activities.push(a);
  else d.unassigned.push(a);
  d.activities.sort((x, y) => x.start_time.localeCompare(y.start_time));
  return { activity: { ...a } };
}

export function mockActivities(status?: MatchStatus): ActivitiesResponse {
  const all = [...data().activities, ...data().unassigned].sort((a, b) => b.start_time.localeCompare(a.start_time));
  return { activities: status ? all.filter((a) => a.match_status === status) : all };
}
