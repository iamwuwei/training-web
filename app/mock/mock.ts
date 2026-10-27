// Turns training-api's seed/plans.json into the shapes the API returns, so the
// UI runs with no backend. Mirrors seed/seed.ts: one session per date, hand-typed
// results become an activity + manual review on the same local date.

import plans from "./plans.json";
import type { ActivitiesResponse, ApiActivity, ApiCoachMessage, ApiConstraint, ApiProposal, ApiProposalChange, ApiRoutine, ApiSession, ApiSplit, ApiWeek, ApiWeeklyReview, CoachResponse, PostCoachMessageRequest, PostCoachMessageResponse,
  PostCheckinPickRequest,
  PostCheckinPickResponse,
  PostCheckinResetResponse,
  PostConstraintResponse,
  PostProposalResponse,
  PostRoutineRequest,
  PostRoutineResponse,
  PostWeeklyAskRequest,
  PostWeeklyAskResponse,
  PutRoutineRequest,
  PutRoutineResponse,
  PutCoachSeenResponse, MatchStatus, MeResponse, PlanResponse, PostAdjustmentRequest, PostAdjustmentResponse, PutMemoRequest, PutMemoResponse, PutSessionRequest, PutSessionResponse, RereviewResponse, Verdict, WeeklyResponse } from "../types/api";
import { ApiError } from "../lib/api";
import { addDays, md, mdDow, todayJst } from "../lib/date";
import { kmPlan } from "../lib/format";
import { shortName } from "../lib/labels";
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

/** Demo splits from [sec/km, avg HR] pairs, shaped like Strava's splits_metric. */
const demoSplits = (rows: [number, number][]): ApiSplit[] =>
  rows.map(([p, hr], i) => ({ split: i + 1, distance: 1000, moving_time: p, elapsed_time: p, elevation_difference: 0, average_speed: 1000 / p, average_heartrate: hr }));
const PLAN_ID = "mock-plan";

/** Woo's one line per session (the worker writes these in production). */
const DEMO_BRIEFS: Record<string, string> = {
  "2026-10-21": "第 1 趟當熱身，從第 2 趟才用力，下坡真的慢",
  "2026-10-22": "腿留給明天的輕鬆跑和週日的長跑",
  "2026-10-23": "前 3 分鐘用呼吸不用錶",
  "2026-10-25": "找有起伏的路線，心拍比配速重要",
  "2026-10-27": "跑完 Hyrox 隔天，心拍壓住就好",
  "2026-10-28": "MP 段看心拍，過 165 就放慢",
};

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
    brief: DEMO_BRIEFS[s.date] ?? null,
    skipped_at: null,
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
      splits: r.date === "2026-10-13" ? demoSplits([[395, 132], [455, 140], [450, 141], [447, 141], [447, 142], [481, 144]]) : null,
      match_status: session ? "auto" : "unplanned",
      review: {
        verdict: r.verdict,
        comment: null,
        reminders: r.reminders ?? [],
        source: "manual",
        model: null,
        adjust_hint: null,
        failed: false,
        error: null,
        created_at: new Date(`${r.date}T12:00:00+09:00`).toISOString(),
      },
    };
  });

  // Demo inbox: three things Strava "just synced" today, waiting for the athlete to pick a
  // session. The walk is there so the mismatch question can be tried (pick it as the run).
  const today = todayJst();
  const base = { user_id: MOCK_USER_ID, description: null, memo: null, rpe: null, memo_updated_at: null, gear_name: null, weather: null, splits: null, session_id: null, match_status: "unplanned" as const, review: null };
  const unassigned: ApiActivity[] = [
    { ...base, id: "u-run", strava_activity_id: "900001", sport_type: "Run", start_time: new Date(`${today}T06:40:00+09:00`).toISOString(), distance_m: 7000, moving_time_sec: 2998, avg_pace_sec_km: 428, avg_hr: 152, max_hr: 171, avg_watts: 168, kcal: 512, device_name: "Apple Watch Series 11",
      splits: demoSplits([[442, 138], [435, 142], [401, 158], [404, 161], [413, 166], [448, 152], [455, 148]]) },
    { ...base, id: "u-walk", strava_activity_id: "900003", sport_type: "Walk", start_time: new Date(`${today}T17:30:00+09:00`).toISOString(), distance_m: 4900, moving_time_sec: 3840, avg_pace_sec_km: 784, avg_hr: 99, max_hr: 118, avg_watts: null, kcal: 290, device_name: "Apple Watch Series 11" },
    { ...base, id: "u-hyrox", strava_activity_id: "900002", sport_type: "WeightTraining", start_time: new Date(`${today}T18:30:00+09:00`).toISOString(), distance_m: 0, moving_time_sec: 3480, avg_pace_sec_km: null, avg_hr: 152, max_hr: 171, avg_watts: null, kcal: 620, device_name: "Apple Watch Series 11" },
  ];

  return {
    coach_unread: 0,
    coach_checkin_open: false,
    coach_ask_kind: null,
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
    routines: [],
    constraints: [],
  };
}

// ---- 肌力 day: Woo's checklist (demo) ----
const routines: ApiRoutine[] = [];
const STOCK_ITEMS = [
  { name: "平板支撐 3 × 40 秒", how: "手肘在肩膀下，臀部夾緊，身體一直線，不要塌腰。" },
  { name: "側棒式 每邊 2 × 30 秒", how: "手肘撐地，骨盆抬高不下沉，眼睛看前方。" },
  { name: "臀橋 3 × 15", how: "仰躺屈膝，腳跟推地把臀部抬到跟身體一直線，頂端停 1 秒。" },
  { name: "單腳硬舉（徒手）每邊 2 × 10", how: "單腳站，上身往前傾、另一腳往後伸，背打直，感覺後側臀腿。" },
  { name: "死蟲式 3 × 10", how: "仰躺，雙手朝天、膝蓋 90 度抬起。對側的手和腳慢慢往外伸直到接近地面，腰全程貼緊地板，再換邊。" },
  { name: "小腿提踵 2 × 20", how: "站在台階邊，腳跟懸空，慢慢踮起再放到比台階低。" },
];
export function mockPostRoutine(sessionId: string, body: PostRoutineRequest): PostRoutineResponse {
  const existing = routines.find((r) => r.session_id === sessionId);
  if (existing && !body.regenerate) return { routine: { ...existing } };
  if (existing) routines.splice(routines.indexOf(existing), 1);
  const r: ApiRoutine = { id: `r-${sessionId}-${Date.now()}`, session_id: sessionId, place: body.place, status: "pending", minutes: null, rules: null, items: [], error: null, rpe: null, note: null, completed_at: null, created_at: new Date().toISOString() };
  routines.push(r);
  setTimeout(() => {
    r.status = "ready";
    r.minutes = 15;
    r.rules = `${body.place === "home" ? "在家" : "健身房"} · 組間休息 45 秒 · 動作之間 1 分鐘 · 全程 RPE 6〜7`;
    r.items = STOCK_ITEMS.map((i) => ({ ...i, done: false }));
  }, 1500);
  return { routine: { ...r } };
}
export function mockPutRoutine(sessionId: string, body: PutRoutineRequest): PutRoutineResponse {
  const r = routines.find((x) => x.session_id === sessionId);
  if (!r) throw new Error("no routine yet");
  if (body.done) r.items = r.items.map((i, idx) => ({ ...i, done: body.done![idx] }));
  if (body.rpe !== undefined) r.rpe = body.rpe;
  if (body.note !== undefined) r.note = body.note;
  if (body.complete && !r.completed_at) {
    r.completed_at = new Date().toISOString();
    const t = threadData();
    const done = r.items.filter((i) => i.done).length;
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: `肌力 ${done}/${r.items.length} 項做完${r.rpe ? `，RPE ${r.rpe}` : ""}${r.note ? `，${r.note}` : ""}。明天 Easy 6 km，腿留一點給它。`, created_at: new Date().toISOString() });
  }
  return { routine: { ...r, items: r.items.map((i) => ({ ...i })) } };
}

let cache: PlanResponse | undefined;
const data = () => (cache ??= build());

let coachUnread = 1; // the demo thread has one unread post from Woo until the coach page is opened

export function mockPutCoachSeen(): PutCoachSeenResponse {
  coachUnread = 0;
  return { seen_at: new Date().toISOString() };
}

export function mockPlan(): PlanResponse {
  const d = data();
  const t = threadData();
  const openAsk = [...t].reverse().find((m) => m.kind === "ask" && m.ask?.state === "open")?.ask ?? null;
  return {
    ...d,
    coach_unread: coachUnread,
    coach_checkin_open: !!openAsk || t.some((m) => m.kind === "checkin" && m.checkin?.state === "open"),
    coach_ask_kind: openAsk?.kind ?? null,
    activities: [...d.activities, ...d.unassigned].filter((a) => a.session_id),
    unassigned: d.unassigned.filter((a) => !a.session_id),
    routines: routines.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i })) })),
    constraints: constraints.filter((c) => c.status === "active").map((c) => ({ ...c })),
  };
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
const isRun = (a: ApiActivity) => !a.sport_type || ["Run", "TrailRun", "VirtualRun"].includes(a.sport_type);

/** Move the activity to the list its session_id says it belongs in. */
function relist(a: ApiActivity) {
  const d = data();
  d.activities = d.activities.filter((x) => x.session_id || x.id !== a.id);
  d.unassigned = d.unassigned.filter((x) => x.id !== a.id);
  if (a.session_id) d.activities.push(a);
  else d.unassigned.push(a);
  d.activities.sort((x, y) => x.start_time.localeCompare(y.start_time));
}
function unassign(a: ApiActivity, status: MatchStatus = "unplanned") {
  a.session_id = null;
  a.match_status = status;
  a.review = null;
  relist(a);
}

/**
 * Why the pick looks wrong (a walk on a run day, a run far shorter than the session), or null.
 * Same two checks as the api's mismatchReason.
 */
function mismatchReason(a: ApiActivity, s: ApiSession): string | null {
  if (s.type === "rest") return null;
  if (!isRun(a)) return `這趟 ${Math.round(a.moving_time_sec / 60)} 分鐘、心拍 ${a.avg_hr}，看起來像走路，不像 ${shortName(s)}`;
  if (s.target_distance_m && a.distance_m < s.target_distance_m * 0.5) return `這趟只有 ${kmPlan(a.distance_m)} km，${shortName(s)} 是 ${kmPlan(s.target_distance_m)} km，差太多`;
  return null;
}

/** Woo's mismatch question as the newest message; the verdict waits for 是／不是. */
function postMismatchAsk(a: ApiActivity, s: ApiSession, reason: string, from: "checkin" | "report") {
  const t = threadData();
  t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "ask", text: `${reason}。真的要算成 ${md(s.scheduled_date)} 的 ${shortName(s).split(" ")[0]} 嗎？`, activity_id: a.id, ask: { state: "open", kind: "mismatch", from, activity_id: a.id, session_id: s.id, reason }, created_at: new Date().toISOString() });
}

/** The demo verdict (the worker's review of the activity + Woo's line in the thread). */
function judge(a: ApiActivity, s: ApiSession | null) {
  const comment = "（示範）數據落在課表目標內，感受也一致。";
  const reminder = "第 1 km 先走 2 分鐘再起跑";
  a.review = { verdict: "達成", comment, reminders: [reminder], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString() };
  const t = threadData();
  t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "review", text: comment, activity_id: a.id, review: { label: s ? shortName(s) : "未排課", verdict: "達成", reminder, date: s?.scheduled_date ?? todayJst() }, created_at: new Date().toISOString() });
}

/**
 * Demo mode: assign an unassigned activity to a session; the "coach" answers after ~4 s —
 * unless the pick looks wrong (a walk, or under half the distance): then Woo asks first,
 * like the api does, and the verdict comes after 是 in the thread.
 */
export function mockPutSession(activityId: string, body: PutSessionRequest): PutSessionResponse {
  const d = data();
  const a = findActivity(activityId);
  if (!a) throw new Error("not found");
  if (body.session_id) {
    // (an activity picked through the check-in still sits in `unassigned`, so look in both lists)
    const holder = [...d.activities, ...d.unassigned].find((x) => x.session_id === body.session_id && x.id !== a.id);
    if (holder) {
      holder.session_id = null; holder.match_status = "unplanned"; holder.review = null;
      // Woo's open question about the replaced activity is moot now.
      for (const m of threadData()) if (m.kind === "ask" && m.ask?.state === "open" && m.ask.activity_id === holder.id) m.ask = { ...m.ask, state: "answered" };
    }
    a.session_id = body.session_id;
    a.match_status = "confirmed";
    a.review = null;
    if (body.memo !== undefined || body.rpe !== undefined) {
      a.memo = body.memo && body.memo.trim() ? body.memo.trim() : null;
      a.rpe = body.rpe ?? null;
      a.memo_updated_at = new Date().toISOString();
    }
    const s = d.sessions.find((x) => x.id === body.session_id) ?? null;
    const reason = s ? mismatchReason(a, s) : null;
    if (s && reason) postMismatchAsk(a, s, reason, "report");
    else setTimeout(() => { a.review = { verdict: "達成", comment: "（示範）數據落在課表目標內，感受也一致。", reminders: ["第 1 km 先走 2 分鐘再起跑"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString() }; }, 4000);
  } else {
    a.session_id = null;
    a.match_status = body.status ?? "unplanned";
    a.review = null;
  }
  relist(a);
  return { activity: { ...a } };
}

export function mockActivities(status?: MatchStatus): ActivitiesResponse {
  const all = [...data().activities, ...data().unassigned].sort((a, b) => b.start_time.localeCompare(a.start_time));
  return { activities: status ? all.filter((a) => a.match_status === status) : all };
}

/** Demo mode: the coach answers again after ~4 s. */
export function mockRereview(activityId: string): RereviewResponse {
  const a = findActivity(activityId);
  if (!a) throw new Error("not found");
  a.review = null;
  setTimeout(() => {
    a.review = { verdict: "達成但有提醒", comment: "（示範）重新分析：配速在區間內，但第 3 km 心拍衝到 166。", reminders: ["MP 第 3 公里開始看心拍"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString() };
  }, 4000);
  return { queued: true };
}

// Demo weekly reviews: week 2 with two proposals (pending) against next week's sessions,
// and week 3 written before the 10/25 long run had a record — it asks instead of judging
// (the question itself is the ask's `question`; the text only says what Woo can see).
let weekly: ApiWeeklyReview[] | undefined;
const WEEK2_ID = "w-2026-10-12";
const WEEK3_ID = "w-2026-10-19";
const WEEK3_TEXT_ASK = "本週 4 堂跑步完成 3 堂：10/20 Easy 6.03 km（7:11、心拍 143）、10/21 坡跑、10/23 Easy 6.14 km（7:08、心拍 142），兩次 Easy 都比 7:15 快 4〜7 秒，心拍在範圍內。10/25 的長跑確定之後我再談 11/1 的 18 km。";
const WEEK3_TEXT_SKIPPED = "本週 4 堂跑步完成 3 堂：10/20 Easy 6.03 km（7:11、心拍 143）、10/21 坡跑、10/23 Easy 6.14 km（7:08、心拍 142）。10/25 的長跑你說沒跑，這週長跑量是 0，所以 11/1 的 18 km 不直接上：先回到 16 km，最後 4 km @ 6:45 看當天小腿狀況。兩次 Easy 都比 7:15 快 4〜7 秒，下週 Easy 以 7:15 為下限。";
function weeklyData(): ApiWeeklyReview[] {
  if (weekly) return weekly;
  const d = data();
  const long = d.sessions.find((s) => s.scheduled_date === "2026-10-18");
  const rec = d.sessions.find((s) => s.scheduled_date === "2026-10-16");
  weekly = [{
    id: WEEK2_ID,
    week_start: "2026-10-12",
    summary: "（示範）第 2 週完成 3/4，Easy 心拍守得比第 1 週好（150→140）。10/14 MP 段配速到位但第 5 km 心拍 166 超過上限，體感也說第三公里開始腿重。長跑前一天排 Hyrox，建議把長跑目標心拍再壓低一點。",
    model: null,
    adjustments: ([
      long ? { index: 0, session_id: long.id, field: "note" as const, old: long.note, new: "前日 Hyrox。心拍 ≤150 為最高優先，配速掉到 8:00 也可；超過 155 就走 1 分鐘。", reason: "10/14 MP 段心拍已衝到 166，長跑前一天又是 Hyrox，疲勞疊加時心拍容易失控。", status: "pending" as const, decided_at: null, applied_session_id: null } : null,
      rec ? { index: 1, session_id: rec.id, field: "target_distance_m" as const, old: rec.target_distance_m, new: 3000, reason: "本週已經有一次高強度，恢復跑縮短到 3 km 讓腿在 Hyrox 前多休一點。", status: "pending" as const, decided_at: null, applied_session_id: null } : null,
    ] as (ApiWeeklyReview["adjustments"][number] | null)[]).filter((x): x is ApiWeeklyReview["adjustments"][number] => !!x),
    created_at: new Date("2026-10-12T12:00:00Z").toISOString(),
    updated_at: null,
    update_reason: null,
  }, {
    id: WEEK3_ID,
    week_start: "2026-10-19",
    summary: WEEK3_TEXT_ASK,
    model: null,
    // No proposals while the question is open (same as the api); 沒跑 regenerates the review with one.
    adjustments: [],
    created_at: new Date(`${todayJst()}T04:00:00+09:00`).toISOString(),
    updated_at: null,
    update_reason: null,
  }];
  return weekly!;
}
export function mockWeekly(): WeeklyResponse {
  return { reviews: weeklyData().map((w) => ({ ...w, adjustments: w.adjustments.map((a) => ({ ...a })) })) };
}
export function mockPostAdjustment(weeklyId: string, index: number, body: PostAdjustmentRequest): PostAdjustmentResponse {
  const w = weeklyData().find((x) => x.id === weeklyId);
  const item = w?.adjustments[index];
  if (!w || !item) throw new Error("not found");
  if (body.action === "apply") {
    const s = data().sessions.find((x) => x.id === item.session_id);
    if (s) {
      (s as unknown as Record<string, unknown>)[item.field] = item.new;
      if (item.field === "target_distance_m" && typeof item.new === "number") s.content = s.content?.replace(/\d+(?:〜\d+)?\s*km/, `${item.new / 1000} km`) ?? s.content;
    }
    item.applied_session_id = item.session_id;
  }
  item.status = body.action === "apply" ? "applied" : "dismissed";
  item.decided_at = new Date().toISOString();
  return { review: { ...w, adjustments: w.adjustments.map((a) => ({ ...a })) } };
}

// ---- 記下來 constraints (demo) ----------------------------------------------------
// Three active ones (the settings page: one has expired) and three Woo proposes in the thread.
const at = (iso: string) => new Date(iso).toISOString();
const TODAY = todayJst();
const todayAt = (hm: string) => new Date(`${TODAY}T${hm}:00+09:00`).toISOString();
const constraints: ApiConstraint[] = [
  { id: "k-mon", text: "週一固定休息，不排課", start_date: null, end_date: null, kind: "fixed_day", weekday: 1, source_message_id: null, status: "active", created_at: at("2026-10-05T10:00:00+09:00") },
  { id: "k-trip", text: "11/3〜4 出差", start_date: "2026-11-03", end_date: "2026-11-04", kind: "period", weekday: null, source_message_id: null, status: "active", created_at: at("2026-10-09T21:30:00+09:00") },
  { id: "k-ankle", text: "左腳踝輕傷", start_date: "2026-10-01", end_date: "2026-10-10", kind: "period", weekday: null, source_message_id: null, status: "active", created_at: at("2026-10-02T08:00:00+09:00") },
  { id: "k-abroad", text: "11/21〜23 出國", start_date: "2026-11-21", end_date: "2026-11-23", kind: "period", weekday: null, source_message_id: "c-rp-a1", status: "proposed", created_at: todayAt("06:31") },
  { id: "k-knee", text: "左膝不舒服", start_date: null, end_date: "2026-10-31", kind: "period", weekday: null, source_message_id: "c-rp-a4", status: "proposed", created_at: todayAt("06:51") },
  { id: "k-wed", text: "週三肌力不能動", start_date: null, end_date: null, kind: "fixed_day", weekday: 3, source_message_id: "c-rp-a5", status: "proposed", created_at: todayAt("06:53") },
];

/** Demo: 記下來 → active, 不用 / 刪除 → dismissed. Deciding twice is a 409, like the api. */
export function mockPostConstraint(constraintId: string, action: "accept" | "dismiss"): PostConstraintResponse {
  const c = constraints.find((x) => x.id === constraintId);
  if (!c) throw new ApiError(404, "not found");
  if (c.status === "dismissed" || (c.status === "active" && action === "accept")) throw new ApiError(409, "already decided");
  c.status = action === "accept" ? "active" : "dismissed";
  return { constraint: { ...c } };
}

// ---- Woo's proposal cards in chat (demo) --------------------------------------
// Single-change cards: swap the long run and the rest day (two changes, applied together), and a
// flagged one. Multi-week cards: 11/21〜23 abroad (pending, applied-style, stale), an A／B pair, and
// the card Woo sends after 請 Woo 重看. Applying changes the demo plan for real; two cards that touch
// the same session make the second one a 409 (the card turns stale).
const chg = (o: Pick<ApiProposalChange, "op" | "label" | "date"> & Partial<ApiProposalChange>): ApiProposalChange =>
  ({ session_id: null, old: null, new: null, reason: null, flags: [], applied_session_id: null, ...o });

const BASIS_TEXT = "目標 4:45（6:45/km）。目前最長 16.2 km（10/25）、週跑量 36 km，兩次 Easy 心拍 142〜149 在範圍內，關卡 1（11/15 的 26 km）還沒到。原則：32 km 是關卡 2 唯一一次測試，不縮、只移；長跑之間至少隔 6 天；賽前 14 天內不排 25 km 以上。";
const BASIS = ["目標 4:45", "最長 16.2 km", "週 36 km", "關卡 1 未測"];
const ABROAD_WEEKS = [
  { week_no: 7, phase: null, focus: "出國前收尾，峰值移到下週" },
  { week_no: 8, phase: null, focus: "★ 峰值 32 km（11/25 週三），週末 16 km 收尾" },
];
const ABROAD_IMPACT = {
  keep: "11/22 你在國外，32 km 跑不到，關卡 2 測不到；比賽配速只能用保守的 7:00，4:45 會變 4:55 左右。",
  change: "峰值從 11/22 後移到 11/25，離比賽 18 天，恢復夠。第 7 週 60 → 28 km，第 8 週 42 → 58 km；11/29 的 16 km 讓腿在 taper 前收回來。",
  risk: "回程晚或 11/24 腿還重，32 km 再延到 11/26、11/29 改 12 km。11/25 跑不到 28 km 就當關卡 2 沒過，比賽照 7:00 起跑。",
};
const abroadChanges = (): ApiProposalChange[] => [
  chg({ op: "change", session_id: "s-2026-11-22", field: "scheduled_date", old: "2026-11-22", new: "2026-11-25", label: "Peak Long 32 km", date: "2026-11-22", flags: ["落到第 8 週：那週 42 → 58 km（+38%），減量週變峰值週"] }),
  chg({ op: "add", label: "休息", date: "2026-11-22", new_session: { scheduled_date: "2026-11-22", type: "rest", label: "休息", target_distance_m: 0, target_pace_sec_km: null, note: "出國" }, reason: "你 11/21〜23 不在，這天空出來。" }),
  chg({ op: "remove", session_id: "s-2026-11-25", label: "Easy 7 km", date: "2026-11-25", reason: "這天改跑 32 km，不另外加課。" }),
  chg({ op: "change", session_id: "s-2026-11-26", field: "skip", label: "Recovery 5 km", date: "2026-11-26", reason: "32 km 隔天，肌力也不做。" }),
  chg({ op: "change", session_id: "s-2026-11-27", field: "target_pace_sec_km", old: "7:15〜7:45", new: "7:45+（恢復跑）", label: "Easy 5 km", date: "2026-11-27" }),
  chg({ op: "change", session_id: "s-2026-11-29", field: "target_distance_m", old: 20000, new: 16000, label: "Long 20 km", date: "2026-11-29", reason: "離 32 km 只隔 4 天，20 km 會疊進 taper。" }),
];

const card = (o: Pick<ApiProposal, "id" | "message_id" | "changes" | "impact" | "basis_text" | "basis"> & Partial<ApiProposal>): ApiProposal =>
  ({ source: "chat", why: null, weeks: [], flags: [], group_id: null, option: null, status: "pending", stale_reason: null, created_at: "", decided_at: null, ...o });

const proposals: ApiProposal[] = [
  card({ id: "p-swap", message_id: "c-prop-1",
    changes: [
      chg({ op: "change", session_id: "s-2026-10-25", field: "scheduled_date", old: "2026-10-25", new: "2026-10-24", label: "Long 16 km", date: "2026-10-25" }),
      chg({ op: "change", session_id: "s-2026-10-24", field: "scheduled_date", old: "2026-10-24", new: "2026-10-25", label: "休息", date: "2026-10-24" }),
    ],
    why: "兩堂對調，週五 Easy → 週六長跑 → 週日休息，硬日沒有連著。",
    basis: ["本週已跑 12.1 / 36 km", "目前最長 12 km（10/11）", "10/24 原本休息"],
    basis_text: "目標 4:45。目前最長 12 km（10/11）、本週已跑 12.1 / 36 km，Easy 心拍都在 140〜150。原則：長跑前一天不排硬課，長跑之間至少隔 6 天。",
    impact: {
      keep: "10/25 週日你跑不了，這週長跑量會是 0，11/1 的 18 km 變成直接跳一大步。",
      change: "長跑移到 10/24 週六，10/25 休息；週五 Easy 當放鬆，這週長跑量 16 km 不掉。",
      risk: "10/24 腿還重就把長跑縮成 14 km，跟我說一聲我再重排。",
    } }),
  card({ id: "p-long", message_id: "c-prop-2",
    changes: [chg({ op: "change", session_id: "s-2026-11-01", field: "target_distance_m", old: 18000, new: 21000, label: "Long 18 km", date: "2026-11-01" })],
    why: "11/8 的 22 km 才接得上；小腿若還痠就只跑 18。",
    basis: ["目前最長 12 km（10/11）", "上週 16 / 36 km", "10/25 自述小腿微痠"],
    basis_text: "目標 4:45。目前最長 12 km（10/11），上週 16 / 36 km，10/25 你說小腿微痠。原則：長跑每週最多加 2〜4 km，補量要在恢復完之後。",
    impact: {
      keep: "11/1 照 18 km 跑，跟 11/8 的 22 km 之間跳 4 km，比較穩。",
      change: "11/1 直接 21 km，把上週少跑的補回來，11/8 的 22 km 接得上。",
      risk: "10/25 小腿還痠就只跑 18 km；21 km 比目前最長多 9 km，跑完隔天腿腫就停。",
    },
    flags: ["比目前最長多 9 km", "上週少跑 20 km 的補回"] }),
  // 11/21〜23 abroad: the canonical card (驗收 1)
  card({ id: "p-replan", message_id: "c-rp-a1", changes: abroadChanges(), weeks: ABROAD_WEEKS, basis: BASIS, basis_text: BASIS_TEXT, impact: ABROAD_IMPACT }),
  // already applied (yesterday): two weeks, the week-5 description was rewritten with the sessions
  card({ id: "p-applied", message_id: "c-rp-b2", status: "applied", decided_at: at(`${addDays(TODAY, -1)}T21:02:00+09:00`),
    changes: [
      chg({ op: "change", session_id: "s-2026-11-06", field: "target_distance_m", old: 6000, new: 5000, label: "Easy 6 km", date: "2026-11-06", applied_session_id: "s-2026-11-06" }),
      chg({ op: "change", session_id: "s-2026-11-08", field: "target_distance_m", old: 22000, new: 20000, label: "Long 22 km", date: "2026-11-08", reason: "小腿還痠，22 km 退到 20，最後 5 km 照測關卡 1。", applied_session_id: "s-2026-11-08" }),
      chg({ op: "change", session_id: "s-2026-11-10", field: "target_distance_m", old: 6000, new: 5000, label: "Recovery 6 km", date: "2026-11-10", applied_session_id: "s-2026-11-10" }),
    ],
    weeks: [{ week_no: 5, phase: null, focus: "長跑 20，小腿先恢復" }],
    basis: ["目標 4:45", "最長 16.2 km", "小腿微痠"],
    basis_text: "目標 4:45。你說小腿還痠，目前最長 16.2 km、10/25 之後週跑量 36 km。原則：痠痛期先把量減在長跑和隔天的恢復跑，不動關卡課。",
    impact: {
      keep: "11/8 照 22 km 跑，小腿沒好的話關卡 1 的最後 5 km 很可能跑不到 6:45。",
      change: "11/8 退到 20 km，11/6 和 11/10 各少 1 km，第 5 週 40 → 38 km，關卡 1 還是測得到。",
      risk: "11/6 腿還痠就把 Easy 改走路；11/8 最後 5 km 心拍過 168 就停，關卡 1 往後一週補測。",
    } }),
  // 409: the plan changed under it
  card({ id: "p-stale", message_id: "c-rp-c2", status: "stale", stale_reason: "11/29 長跑 20 km 在 10/27 被週回顧改過（現在是 18 km）",
    changes: [
      chg({ op: "change", session_id: "s-2026-11-27", field: "target_pace_sec_km", old: "7:15〜7:45", new: "7:45+（恢復跑）", label: "Easy 5 km", date: "2026-11-27" }),
      chg({ op: "change", session_id: "s-2026-11-29", field: "target_distance_m", old: 20000, new: 16000, label: "Long 20 km", date: "2026-11-29", reason: "離 32 km 只隔 4 天，20 km 會疊進 taper。" }),
    ],
    weeks: [{ week_no: 8, phase: null, focus: "★ 峰值 32 km（11/25 週三），週末 16 km 收尾" }],
    basis: BASIS, basis_text: BASIS_TEXT, impact: ABROAD_IMPACT }),
  // A／B: one reply, two cards, one 記下來
  card({ id: "p-ab-a", message_id: "c-rp-a2", group_id: "g-ab", option: { letter: "A", title: "32 km 後移到 11/25", recommended: true },
    changes: abroadChanges(), weeks: ABROAD_WEEKS, basis: BASIS, basis_text: BASIS_TEXT, impact: ABROAD_IMPACT }),
  card({ id: "p-ab-b", message_id: "c-rp-a3", group_id: "g-ab", option: { letter: "B", title: "縮成 26 km，11/20 跑完再走", recommended: false },
    changes: [
      chg({ op: "change", session_id: "s-2026-11-22", field: "scheduled_date", old: "2026-11-22", new: "2026-11-20", label: "Peak Long 32 km", date: "2026-11-22" }),
      chg({ op: "change", session_id: "s-2026-11-22", field: "target_distance_m", old: 32000, new: 26000, label: "Peak Long 32 km", date: "2026-11-22", flags: ["離 11/15 的 26 km 只隔 5 天"] }),
      chg({ op: "remove", session_id: "s-2026-11-20", label: "Easy 6 km", date: "2026-11-20", reason: "這天改跑 26 km。" }),
      chg({ op: "change", session_id: "s-2026-11-18", field: "type", old: "坡跑＋MP", new: "輕鬆跑 6 km", label: "坡跑+MP 10 km", date: "2026-11-18", reason: "26 km 前兩天不排坡。" }),
      chg({ op: "add", label: "休息", date: "2026-11-22", new_session: { scheduled_date: "2026-11-22", type: "rest", label: "休息", target_distance_m: 0, target_pace_sec_km: null, note: "出國" }, reason: "你 11/21〜23 不在。" }),
    ],
    weeks: [{ week_no: 7, phase: null, focus: "★ 峰值 26 km（11/20 週五），出國前跑完" }],
    basis: BASIS, basis_text: BASIS_TEXT,
    impact: {
      keep: "同上：關卡 2 測不到，比賽配速只能用 7:00。",
      change: "關卡 2 用 26 km 的最後 6 km 估，比賽配速最多押到 6:50；第 8 週照原本減量 42 km，taper 不受影響。",
      risk: "26 km 跑完兩天就上飛機，坐久腿會腫；回來 11/24 的恢復跑改走路也行。",
    } }),
];

/** What Woo says after 採用 (the api writes it; the demo has a few by hand). */
const CONFIRM: Record<string, () => string> = {
  "p-replan": () => `改好了。第 7 週變出國前收尾，11/25 週三 32 km、11/29 16 km。${constraints.find((c) => c.id === "k-abroad")?.status === "active" ? "11/21〜23 出國我記著了，設定頁看得到。" : ""}`.trim(),
  "p-ab-a": () => "改好了。11/25 週三 32 km，前一天的恢復跑別偷快。出國那三天走路算活動，不用找我報到。",
  "p-ab-b": () => "改好了。11/20 週五 26 km 跑完再走，出國那三天走路就好；回來 11/24 的恢復跑看腿再決定。",
  "p-restale": () => "改好了。11/27 的 Easy 放慢，11/29 的長跑 18 → 16 km。",
};

/** Why applying would be a 409: a session of the card moved, vanished, got a record, or no longer has the value the card started from. */
function planConflict(p: ApiProposal): string | null {
  const d = data();
  for (const c of p.changes) {
    if (c.op === "add" || !c.session_id) continue;
    const s = d.sessions.find((x) => x.id === c.session_id);
    const what = `${c.date ? md(c.date) : ""} ${c.label ?? "那堂"}`.trim();
    if (!s || (c.date && s.scheduled_date !== c.date)) return `${what} 在你按之前被別的提案改過`;
    if ([...d.activities, ...d.unassigned].some((a) => a.session_id === s.id)) return `${what} 已完成`;
    if (c.op === "change" && c.field && c.field !== "scheduled_date" && typeof c.old === "number" && (s as unknown as Record<string, unknown>)[c.field] !== c.old) return `${what} 在你按之前被別的提案改過`;
  }
  return null;
}

/** Write a card's changes into the demo plan (the api does this in one transaction); returns the bits Woo's confirmation names. */
function applyToPlan(p: ApiProposal): string[] {
  const d = data();
  const parts: string[] = [];
  const weekOf = (date: string) => d.weeks.find((w) => date >= w.week_start && date <= w.week_end)?.week_no ?? null;
  // removals first, so a session that moves onto the freed day does not meet the old one
  for (const c of p.changes) if (c.op === "remove" && c.session_id) d.sessions = d.sessions.filter((x) => x.id !== c.session_id);
  for (const c of p.changes) {
    if (c.op !== "change" || !c.session_id) continue;
    const s = d.sessions.find((x) => x.id === c.session_id);
    if (!s) continue;
    if (c.field === "skip") { s.type = "rest"; s.label = "休息"; s.content = "休息"; s.target_distance_m = 0; s.target = null; s.note = null; parts.push(`${md(c.date ?? s.scheduled_date)} 改成休息`); }
    else if (c.field === "type") {
      const n = String(c.new ?? "");
      const m = /([\d.]+)\s*km/.exec(n);
      s.type = "easy"; s.label = "Easy"; s.content = n; s.target = "7:15〜7:45 / 心拍 140〜150";
      if (m) s.target_distance_m = Number(m[1]) * 1000;
      parts.push(`${md(c.date ?? s.scheduled_date)} 改成 ${n}`);
    } else if (c.field === "target_pace_sec_km" && typeof c.new === "string") {
      const m = /^(\d+):(\d+)/.exec(c.new);
      if (m) s.target_pace_sec_km = Number(m[1]) * 60 + Number(m[2]);
      s.target = `${c.new} / 心拍 ≤140`;
    } else if (c.field) {
      (s as unknown as Record<string, unknown>)[c.field] = c.new;
      if (c.field === "scheduled_date" && typeof c.new === "string") s.week_no = weekOf(c.new);
      if (c.field === "target_distance_m" && typeof c.new === "number") s.content = s.content?.replace(/\d+(?:〜\d+)?\s*km/, `${kmPlan(c.new)} km`) ?? s.content;
      parts.push(c.field === "scheduled_date" && typeof c.new === "string" ? `${mdDow(c.new)}是 ${c.label ?? s.label}`
        : c.field === "target_distance_m" && typeof c.new === "number" ? `${md(s.scheduled_date)} 的 ${(c.label ?? s.label ?? "").split(" ")[0]} 是 ${kmPlan(c.new)} km`
        : `${md(s.scheduled_date)} 的 ${c.label ?? s.label} 改好了`);
    }
    c.applied_session_id = s.id;
  }
  p.changes.forEach((c, i) => {
    const n = c.new_session;
    if (c.op !== "add" || !n) return;
    const id = `s-add-${p.id}-${i}`;
    d.sessions.push({ id, plan_id: PLAN_ID, scheduled_date: n.scheduled_date, week_no: weekOf(n.scheduled_date), phase: d.weeks.find((w) => w.week_no === weekOf(n.scheduled_date))?.phase ?? null,
      label: n.label, type: n.type, content: n.label, note: n.note, target: null, target_distance_m: n.target_distance_m, target_pace_sec_km: n.target_pace_sec_km, target_pace_min_sec_km: null, target_pace_max_sec_km: null,
      target_hr_min: null, target_hr_max: null, brief: null, skipped_at: null, version: 1, superseded: false });
    c.applied_session_id = id;
  });
  for (const w of p.weeks) {
    const week = d.weeks.find((x) => x.week_no === w.week_no);
    if (week) { if (w.focus != null) week.focus = w.focus; if (w.phase != null) week.phase = w.phase; }
  }
  d.sessions.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  return parts;
}

// ---- the coach's thread (demo) ------------------------------------------------
let thread: ApiCoachMessage[] | undefined;
const BLANK = { activity_id: null, weekly_review_id: null, status: "sent" as const, review: null, quote: null, rpe: null, checkin: null, ask: null, weekly: null, proposal: null, constraint: null, error: null };
function threadData(): ApiCoachMessage[] {
  if (thread) return thread;
  const w = weeklyData()[0];
  const w3 = weeklyData()[1];
  const today = todayJst();
  const yAt = (hm: string) => new Date(`${addDays(today, -1)}T${hm}:00+09:00`).toISOString();
  for (const p of proposals) p.created_at = p.id === "p-applied" ? yAt("21:01") : p.id === "p-stale" ? yAt("22:11") : todayAt("06:21");
  thread = [
    { id: "c1", role: "coach", kind: "weekly", text: w.summary ?? "", activity_id: null, weekly_review_id: w.id, status: "sent", review: null, quote: null, error: null, created_at: at("2026-10-12T12:00:00Z") },
    { id: "c2", role: "coach", kind: "review", text: "心拍整段壓在 140，是四次 Easy 裡最穩的一次。第 1 km 6:35 偏快是錶的心拍延遲，不是真的用力；第 6 km 8:01 是坡後自然放慢，正常。", activity_id: "a-2026-10-13", weekly_review_id: null, status: "sent", review: { label: "Easy 6 km", verdict: "達成", reminder: "第 1 km 前 3 分鐘用呼吸不用錶", date: "2026-10-13" }, quote: null, error: null, created_at: at("2026-10-12T22:52:00Z") },
    { id: "c3", role: "athlete", kind: "chat", text: "第一公里又衝太快了，有什麼辦法壓住？", activity_id: "a-2026-10-13", weekly_review_id: null, status: "sent", review: null, quote: "10/13 Easy 6.01 km · 7:25/km · 心拍 140（最高 148） · 達成", error: null, created_at: at("2026-10-12T23:10:00Z") },
    { id: "c4", role: "coach", kind: "chat", text: "這是連續第二次了。前 3 分鐘不要看錶，用鼻子呼吸能撐住的速度就是對的；第 1 km 跑到 7:30 以上才算成功。明天 MP 課的前 2 km Easy 也照這個來。", activity_id: null, weekly_review_id: null, status: "sent", review: null, quote: null, error: null, created_at: at("2026-10-12T23:10:20Z") },
    // Yesterday: a multi-week card already applied (and Woo's confirmation), and one that went stale (409).
    { ...BLANK, id: "c-rp-b1", role: "athlete", kind: "chat", text: "小腿還痠，11/8 的長跑想退一點", created_at: yAt("21:00") },
    { ...BLANK, id: "c-rp-b2", role: "coach", kind: "chat", text: "22 km 退到 20 km，最後 5 km 照測關卡 1。11/6 和 11/10 各少 1 km，讓腿先恢復；第 5 週的描述跟著改。整張一起看：", proposal: proposals.find((x) => x.id === "p-applied") ?? null, created_at: yAt("21:01") },
    { ...BLANK, id: "c-rp-b3", role: "coach", kind: "chat", text: "改好了。11/8 長跑 20 km，11/6 Easy 5 km、11/10 恢復跑 5 km。跑完 20 km 跟我說腿的狀況。", created_at: yAt("21:02") },
    { ...BLANK, id: "c-rp-c1", role: "athlete", kind: "chat", text: "11/27 的 Easy 放慢、11/29 縮短，這樣調", created_at: yAt("22:10") },
    { ...BLANK, id: "c-rp-c2", role: "coach", kind: "chat", text: "11/29 那堂在你按之前已經改過了（週一的回顧把它改成 18 km）。這張不能照用。", proposal: proposals.find((x) => x.id === "p-stale") ?? null, created_at: yAt("22:11") },
    // Week 3's review, written before the 10/25 long run had a record: it asks (demo dates it this morning).
    { ...BLANK, id: "c-weekly-3", role: "coach", kind: "weekly", text: w3.summary ?? "", weekly_review_id: w3.id, created_at: w3.created_at,
      weekly: { week_start: w3.week_start, asks: [{ session_id: "s-2026-10-25", label: "Long 16 km", date: "2026-10-25", question: "10/25 的 Long 16 km 我沒看到紀錄，是沒跑，還是還沒同步？", state: "open" }], updated: null, cancelled: [] } },
    // A chat reply that carries a proposal card (two changes), and a flagged one.
    { ...BLANK, id: "c-ask-sun", role: "athlete", kind: "chat", text: "這週日有事，長跑跑不了", created_at: todayAt("06:20") },
    { ...BLANK, id: "c-prop-1", role: "coach", kind: "chat", text: "那把長跑提到週六，週日換成休息。週五的 Easy 當長跑前的放鬆，別跑快。", proposal: proposals[0], created_at: todayAt("06:21") },
    { ...BLANK, id: "c-prop-2", role: "coach", kind: "chat", text: "另外，上週少跑了 20 km，這週補一點回來的話，長跑可以直接到 21。這個比較激進，你決定。", proposal: proposals[1], created_at: todayAt("06:21") },
    // 11/21〜23 abroad: one card + 記下來 (驗收 1), then the same question as an A／B pair sharing one 記下來, then constraints alone.
    { ...BLANK, id: "c-rp-q1", role: "athlete", kind: "chat", text: "11/21〜23 要出國，課表怎麼調？", created_at: todayAt("06:30") },
    { ...BLANK, id: "c-rp-a1", role: "coach", kind: "chat", text: "11/22 是 32 km 的峰值長跑，11/23 本來就是完全休息。32 km 是關卡 2 唯一一次測試，不縮、往後移到 11/25 週三；第 8 週因此從減量週變成峰值週，11/29 的 20 km 縮成 16 km 讓腿收回來。整張一起看：", proposal: proposals.find((x) => x.id === "p-replan") ?? null, constraint: constraints.find((x) => x.id === "k-abroad") ?? null, created_at: todayAt("06:31") },
    { ...BLANK, id: "c-rp-q2", role: "athlete", kind: "chat", text: "我 11/21〜23 出國，32 km 還跑得了嗎", created_at: todayAt("06:40") },
    { ...BLANK, id: "c-rp-a2", role: "coach", kind: "chat", text: "兩條路。A：32 km 後移到 11/25，關卡 2 照測，第 8 週變重。B：縮成 26 km 提前到 11/20 週五跑完再走，第 8 週照減量，但關卡 2 只能用 26 km 估。我偏 A；回程累不累你比我清楚。", proposal: proposals.find((x) => x.id === "p-ab-a") ?? null, created_at: todayAt("06:41") },
    { ...BLANK, id: "c-rp-a3", role: "coach", kind: "chat", text: "", proposal: proposals.find((x) => x.id === "p-ab-b") ?? null, constraint: constraints.find((x) => x.id === "k-abroad") ?? null, created_at: todayAt("06:41") },
    { ...BLANK, id: "c-rp-q3", role: "athlete", kind: "chat", text: "左膝有點不舒服，到月底都會小心一點", created_at: todayAt("06:50") },
    { ...BLANK, id: "c-rp-a4", role: "coach", kind: "chat", text: "好。到 10/31 的課沒有坡跑和 MP，照跑，Easy 一律壓在 7:30 以後。跑完有腫、下樓梯會痛就跟我說，我再動課表。", constraint: constraints.find((x) => x.id === "k-knee") ?? null, created_at: todayAt("06:51") },
    { ...BLANK, id: "c-rp-q4", role: "athlete", kind: "chat", text: "週三晚上有課，肌力不能動", created_at: todayAt("06:52") },
    { ...BLANK, id: "c-rp-a5", role: "coach", kind: "chat", text: "知道了，週三的肌力不動；之後要調課我會避開它。", constraint: constraints.find((x) => x.id === "k-wed") ?? null, created_at: todayAt("06:53") },
    // Woo's check-in for today's run (demo: today's session is MP 7 km, three activities synced)
    { ...BLANK, id: "c5", role: "coach", kind: "checkin", text: "今天的課是 MP 7 km：2 km Easy + 3 km @ MP + 2 km Easy。Strava 剛進來 3 個活動，哪一個是這堂？", activity_id: "u-run", created_at: todayAt("07:05"),
      checkin: { state: "open", mode: "activity", date: today, session_id: todaySessionId(), session_label: "MP 7 km", candidates: [{ activity_id: "u-run", label: "跑步 06:40 · 7.00 km · 7:08/km" }, { activity_id: "u-walk", label: "走路 17:30 · 4.9 km · 64 分" }, { activity_id: "u-hyrox", label: "重訓 18:30 · 58 分 · 心拍 152" }] } },
  ].map((m) => ({ ...BLANK, ...m })) as ApiCoachMessage[];
  applyToPlan(proposals.find((x) => x.id === "p-applied")!);
  return thread;
}

/** Demo: 還沒同步 only records the answer; 沒跑 marks the session skipped and the review is regenerated ~2 s later (same message, updated in place). */
export function mockPostWeeklyAsk(weeklyId: string, sessionId: string, body: PostWeeklyAskRequest): PostWeeklyAskResponse {
  const t = threadData();
  const m = t.find((x) => x.kind === "weekly" && x.weekly_review_id === weeklyId);
  const w = weeklyData().find((x) => x.id === weeklyId);
  const ask = m?.weekly?.asks.find((a) => a.session_id === sessionId);
  if (!m?.weekly || !w || !ask) throw new Error("not found");
  if (ask.state === "skipped") throw new Error("already answered");
  m.weekly = { ...m.weekly, asks: m.weekly.asks.map((a) => (a.session_id === sessionId ? { ...a, state: body.answer } : a)) };
  if (body.answer === "skipped") {
    const d = data();
    const s = d.sessions.find((x) => x.id === sessionId);
    if (s) s.skipped_at = new Date().toISOString();
    setTimeout(() => {
      const now = new Date().toISOString();
      const reason = `你說 ${md(ask.date)} 沒跑`;
      const cancelled = supersedePending(w);
      const next = d.sessions.find((x) => x.scheduled_date === "2026-11-01");
      if (next) w.adjustments.push({ index: w.adjustments.length, session_id: next.id, field: "target_distance_m", old: next.target_distance_m, new: 16000, reason: "長跑斷了一週，18 km 直接上風險高，先回到 16。", status: "pending", decided_at: null, applied_session_id: null });
      w.summary = WEEK3_TEXT_SKIPPED;
      w.updated_at = now;
      w.update_reason = reason;
      m.text = WEEK3_TEXT_SKIPPED;
      m.weekly = { ...m.weekly!, updated: { at: now, reason }, cancelled };
    }, 2000);
  }
  return { message: { ...m } };
}

/**
 * Demo: apply writes every change into the plan and Woo confirms in the thread at once; the other
 * cards of an A／B group become superseded. A card whose sessions changed since is a 409 and turns
 * stale. Dismiss only records it (a stale card can still be dismissed).
 */
export function mockPostProposal(proposalId: string, action: "apply" | "dismiss"): PostProposalResponse {
  const p = proposals.find((x) => x.id === proposalId);
  if (!p) throw new ApiError(404, "not found");
  if (p.status !== "pending" && !(action === "dismiss" && p.status === "stale")) throw new ApiError(409, "already decided");
  const superseded: string[] = [];
  if (action === "apply") {
    const why = planConflict(p);
    if (why) {
      p.status = "stale";
      p.stale_reason = why;
      throw new ApiError(409, "plan_changed");
    }
    const parts = applyToPlan(p);
    for (const q of proposals) if (p.group_id && q.group_id === p.group_id && q.id !== p.id && q.status === "pending") { q.status = "superseded"; q.decided_at = new Date().toISOString(); superseded.push(q.id); }
    const t = threadData();
    const text = CONFIRM[p.id]?.() ?? (parts.length ? `改好了，課表上${parts.join("、")}。前一天的 Easy 跑完記得跟我說腿的狀況。` : "改好了。");
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text, created_at: new Date().toISOString() });
  }
  p.status = action === "apply" ? "applied" : "dismissed";
  p.decided_at = new Date().toISOString();
  return { proposal: { ...p, changes: p.changes.map((c) => ({ ...c })) }, superseded };
}

function todaySessionId(): string | null {
  const today = todayJst();
  return data().sessions.find((s) => s.scheduled_date === today)?.id ?? null;
}

/** A regeneration cancels the pending proposals; returns their "已取消" lines (api format: "10/16 距離 4 → 3 km"). */
function supersedePending(w: ApiWeeklyReview): string[] {
  const d = data();
  const now = new Date().toISOString();
  const lines: string[] = [];
  for (const a of w.adjustments) {
    if (a.status !== "pending") continue;
    const date = md(d.sessions.find((x) => x.id === a.session_id)?.scheduled_date ?? w.week_start);
    lines.push(a.field === "target_distance_m" ? `${date} 距離 ${kmPlan(Number(a.old))} → ${kmPlan(Number(a.new))} km` : `${date} 備註 → ${a.new}`);
    a.status = "superseded";
    a.decided_at = now;
  }
  return lines;
}

/**
 * The activity for a session of week 2 arrived: that review is regenerated in place, like
 * the worker does — its pending proposals are cancelled, a new one replaces them, and the
 * message gets the "⟳ 已更新 · … 進來了" line.
 */
function rerunWeek2(s: ApiSession) {
  const w = weeklyData().find((x) => x.id === WEEK2_ID);
  const m = threadData().find((x) => x.kind === "weekly" && x.weekly_review_id === WEEK2_ID);
  if (!w || !m || w.updated_at) return;
  const d = data();
  const now = new Date().toISOString();
  const reason = `${md(s.scheduled_date)} 的 ${shortName(s).split(" ")[0]} 進來了`;
  const cancelled = supersedePending(w);
  const rec = d.sessions.find((x) => x.scheduled_date === "2026-10-16");
  if (rec) w.adjustments.push({ index: w.adjustments.length, session_id: rec.id, field: "note" as const, old: rec.note, new: "MP 隔天只活動腿，心拍超過 140 就走；腿還重就改成完全休息", reason: "10/14 MP 段心拍到 166、第三公里開始腿重，隔天又是 Hyrox，恢復跑的心拍上限再壓一點。", status: "pending", decided_at: null, applied_session_id: null });
  w.summary = "（示範）第 2 週完成 4/4。10/14 MP 段 6:46 守住了，但第 5 km 心拍 166 超過上限，體感也說第三公里開始腿重。Easy 心拍守得比第 1 週好（150→140）。長跑前一天是 Hyrox，10/18 照原本的備註跑；10/16 的恢復跑心拍再壓一點。";
  w.updated_at = now;
  w.update_reason = reason;
  m.text = w.summary;
  m.weekly = { week_start: w.week_start, asks: [], updated: { at: now, reason }, cancelled: [...(m.weekly?.cancelled ?? []), ...cancelled] };
}

/** Demo: the pick assigns the activity, then Woo's question arrives after ~2 s. */
export function mockPostCheckinPick(checkinId: string, body: PostCheckinPickRequest): PostCheckinPickResponse {
  const t = threadData();
  const c = t.find((m) => m.id === checkinId && m.kind === "checkin");
  if (!c?.checkin || c.checkin.state !== "open") throw new Error("check-in is no longer open");
  if (body.none) {
    c.checkin = { ...c.checkin, state: "dismissed" };
    const pick: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "pick", text: "都不是", created_at: new Date().toISOString() };
    t.push(pick, { ...BLANK, id: `c${t.length + 2}`, role: "coach", kind: "chat", text: "好，這趟不算。改變主意的話按「重新選」。", created_at: new Date().toISOString() });
    return { checkin: { ...c }, pick };
  }
  const cand = c.checkin.candidates.find((x) => (body.activity_id ? x.activity_id === body.activity_id : !!body.session_id && x.session_id === body.session_id));
  if (!cand) throw new Error("not one of the candidates");
  const activityId = cand.activity_id ?? c.activity_id!;
  const sessionId = cand.session_id ?? c.checkin.session_id!;
  const a = findActivity(activityId);
  const s = data().sessions.find((x) => x.id === sessionId) ?? null;
  if (a) { a.session_id = sessionId; a.match_status = "confirmed"; }
  c.checkin = { ...c.checkin, state: "picked" };
  const pick: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "pick", text: cand.label, status: "pending", activity_id: activityId, created_at: new Date().toISOString() };
  t.push(pick);
  // The pick looks wrong (a walk on a run day): Woo asks instead of judging. His question is the reply, so the pick is settled at once.
  const reason = a && s ? mismatchReason(a, s) : null;
  if (a && s && reason) {
    pick.status = "sent";
    postMismatchAsk(a, s, reason, "checkin");
    return { checkin: { ...c }, pick: { ...pick } };
  }
  setTimeout(() => {
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "ask", text: "收到，7.00 km 配到 MP 7 km。MP 段配速有守住，心拍第 5 km 到 166 超過上限。第 3 公里之後有撐住嗎？腿現在怎麼樣？", activity_id: activityId, ask: { state: "open", kind: "feel", from: "checkin", activity_id: activityId, session_id: sessionId, reason: null }, created_at: new Date().toISOString() });
    pick.status = "sent";
    // The run's record is in: the review of its week is regenerated (the "已取消" line demo).
    if (a && s && isRun(a)) rerunWeek2(s);
  }, 2000);
  return { checkin: { ...c }, pick: { ...pick } };
}
/** Undo the picks made on this check-in (the activity goes back to unassigned), close Woo's open question, post a fresh check-in. */
function resetCheckin(c: ApiCoachMessage): ApiCoachMessage {
  const t = threadData();
  if (!c.checkin) throw new Error("not a check-in");
  if (c.checkin.state === "picked") {
    const from = t.indexOf(c);
    for (const m of t.slice(from + 1)) if (m.kind === "pick" && m.activity_id) {
      const a = findActivity(m.activity_id); // picked activities stay in `unassigned` until the plan is rebuilt, so look in both lists
      if (a) { a.session_id = null; a.match_status = "unplanned"; a.review = null; a.memo = null; a.rpe = null; }
    }
    for (const m of t) if (m.kind === "ask" && m.ask?.state === "open") m.ask = { ...m.ask, state: "answered" };
    for (const m of t) if (m.role === "athlete" && m.status === "pending") m.status = "sent";
  }
  c.checkin = { ...c.checkin, state: "reset" };
  const fresh: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "checkin", text: `好，那是哪一個？今天的課是 ${c.checkin.session_label ?? ""}。`, activity_id: c.activity_id, checkin: { ...c.checkin, state: "open" }, created_at: new Date().toISOString() };
  t.push(fresh);
  return fresh;
}
/** Demo: undo the pick / dismissal and ask again. */
export function mockPostCheckinReset(checkinId: string): PostCheckinResetResponse {
  const c = threadData().find((m) => m.id === checkinId && m.kind === "checkin");
  if (!c?.checkin || c.checkin.state === "open" || c.checkin.state === "reset") throw new Error("check-in cannot be reset");
  return { checkin: { ...resetCheckin(c) } };
}

export function mockCoach(): CoachResponse {
  return { coach: { name: "Woo" }, messages: threadData().map((m) => ({ ...m })) };
}
/** Demo mode: Woo answers after ~3 s, off-topic gets the one-liner. */
export function mockPostCoachMessage(body: PostCoachMessageRequest): PostCoachMessageResponse {
  const t = threadData();
  // 是／不是 on the mismatch question, same states as the api: the athlete's line is stored
  // as sent. 是 after a chip → the earlier pick goes back to pending until Woo's feel
  // question arrives; 是 after a report-page pick → the verdict is queued at once. 不是 after
  // a chip → the check-in reset; after a report-page pick → the activity is only unassigned.
  if (body.answer_to && body.confirm_match !== undefined) {
    const ask = t.find((m) => m.id === body.answer_to && m.kind === "ask");
    if (!ask?.ask || ask.ask.kind !== "mismatch" || ask.ask.state !== "open") throw new Error("question not found");
    ask.ask = { ...ask.ask, state: "answered" };
    const { activity_id, session_id, from } = ask.ask;
    const a = findActivity(activity_id);
    const s = data().sessions.find((x) => x.id === session_id) ?? null;
    const m: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "chat", text: body.text, status: "sent", activity_id, created_at: new Date().toISOString() };
    t.push(m);
    if (!body.confirm_match) {
      const c = from === "checkin" ? [...t].reverse().find((x) => x.kind === "checkin" && x.checkin?.state === "picked") : undefined;
      if (c) resetCheckin(c);
      else if (a) unassign(a);
      return { message: { ...m } };
    }
    if (from === "report") {
      setTimeout(() => { if (a) judge(a, s); }, 3000);
      return { message: { ...m } };
    }
    const pick = [...t].reverse().find((x) => x.kind === "pick" && x.activity_id === activity_id);
    if (pick) pick.status = "pending";
    setTimeout(() => {
      t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "ask", text: `好，算 ${s ? shortName(s) : "這堂"}。${a ? `${Math.round(a.moving_time_sec / 60)} 分鐘、心拍 ${a.avg_hr}，` : ""}跟這堂課的強度差很多，是身體哪裡不舒服嗎？腿現在怎麼樣？`, activity_id, ask: { state: "open", kind: "feel", from: "checkin", activity_id, session_id, reason: null }, created_at: new Date().toISOString() });
      if (pick) pick.status = "sent";
    }, 2000);
    return { message: { ...m } };
  }
  if (body.answer_to) {
    const ask = t.find((m) => m.id === body.answer_to && m.kind === "ask");
    if (!ask?.ask) throw new Error("question not found");
    ask.ask = { ...ask.ask, state: "answered" };
    const a = findActivity(ask.ask.activity_id);
    if (a) { a.memo = body.text; a.rpe = body.rpe ?? null; }
    const m: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "chat", text: body.text, status: "pending", activity_id: ask.ask.activity_id, rpe: body.rpe ?? null, created_at: new Date().toISOString() };
    t.push(m);
    setTimeout(() => {
      if (a) a.review = { verdict: "達成但有提醒", comment: "MP 段 6:46 守住了，第 5 km 心拍 166 超過上限。第三公里開始腿重跟數字對得上。", reminders: ["MP 第 3 公里開始看心拍，過 160 就稍微放慢"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString() };
      t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "review", text: "MP 段 6:46 守住了，第 5 km 心拍 166 超過上限。第三公里開始腿重跟數字對得上。", activity_id: ask.ask!.activity_id, review: { label: "MP 7 km", verdict: "達成但有提醒", reminder: "MP 第 3 公里開始看心拍，過 160 就稍微放慢", date: todayJst() }, created_at: new Date().toISOString() });
      m.status = "sent";
    }, 3000);
    return { message: { ...m } };
  }
  // 請 Woo 重看: he sends a new card against today's plan (the stale one stays as it was).
  if (body.re_propose) {
    const old = proposals.find((x) => x.id === body.re_propose);
    if (!old) throw new ApiError(404, "not found");
    const m: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "chat", text: body.text, status: "pending", created_at: new Date().toISOString() };
    t.push(m);
    setTimeout(() => {
      let next = proposals.find((x) => x.id === "p-restale");
      if (!next) {
        next = card({ id: "p-restale", message_id: null, created_at: new Date().toISOString(),
          changes: [
            chg({ op: "change", session_id: "s-2026-11-27", field: "target_pace_sec_km", old: "7:15〜7:45", new: "7:45+（恢復跑）", label: "Easy 5 km", date: "2026-11-27" }),
            chg({ op: "change", session_id: "s-2026-11-29", field: "target_distance_m", old: 18000, new: 16000, label: "Long 18 km", date: "2026-11-29", reason: "離 32 km 只隔 4 天，18 km 還是會疊進 taper。" }),
          ],
          weeks: old.weeks, basis: old.basis, basis_text: old.basis_text, impact: old.impact });
        proposals.push(next);
        const s29 = data().sessions.find((x) => x.id === "s-2026-11-29");
        if (s29 && s29.target_distance_m === 20000) { s29.target_distance_m = 18000; s29.content = "長跑 18 km"; } // the weekly review's edit the old card ran into
      }
      t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: "用現在的課表重排了一張：11/29 已經是 18 km，改成 16 km；11/27 的 Easy 配速照放慢。", proposal: next, created_at: new Date().toISOString() });
      m.status = "sent";
    }, 3000);
    return { message: { ...m } };
  }
  const quoted = body.activity_id ? findActivity(body.activity_id) : undefined;
  const quote = quoted ? `${quoted.start_time.slice(5, 10).replace("-", "/")} ${quoted.session_id ? "課表" : "未排課"} ${(quoted.distance_m / 1000).toFixed(2)} km` : null;
  const m: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "chat", text: body.text, activity_id: body.activity_id ?? null, status: "pending", quote, created_at: new Date().toISOString() };
  t.push(m);
  setTimeout(() => {
    const offTopic = /吃|電影|天氣|股票|工作/.test(body.text) && !/跑|課表|心拍|配速|腿/.test(body.text);
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: offTopic ? "這個不歸我管，我們回到課表。週五恢復跑完記得寫一下腿的感覺。" : "（示範）收到。以你最近 14 天的心拍來看，這個問題先用降速處理，不要先想拿掉課。週五恢復跑完再跟我說腿的狀況。", created_at: new Date().toISOString() });
    m.status = "sent";
  }, 3000);
  return { message: { ...m } };
}
