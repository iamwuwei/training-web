// Turns training-api's seed/plans.json into the shapes the API returns, so the
// UI runs with no backend. Mirrors seed/seed.ts: one session per date, hand-typed
// results become an activity + manual review on the same local date.

import plans from "./plans.json";
import type { ActivitiesResponse, ApiActivity, ApiCoachMessage, ApiRoutine, ApiSession, ApiSplit, ApiWeek, ApiWeeklyReview, CoachResponse, PostCoachMessageRequest, PostCoachMessageResponse,
  PostCheckinPickRequest,
  PostCheckinPickResponse,
  PostCheckinResetResponse,
  PostRoutineRequest,
  PostRoutineResponse,
  PutRoutineRequest,
  PutRoutineResponse,
  PutCoachSeenResponse, MatchStatus, MeResponse, PlanResponse, PostAdjustmentRequest, PostAdjustmentResponse, PutMemoRequest, PutMemoResponse, PutSessionRequest, PutSessionResponse, RereviewResponse, Verdict, WeeklyResponse } from "../types/api";
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

  // Demo inbox: two things Strava "just synced" today, waiting for the athlete to pick a session.
  const today = todayJst();
  const base = { user_id: MOCK_USER_ID, description: null, memo: null, rpe: null, memo_updated_at: null, gear_name: null, weather: null, splits: null, session_id: null, match_status: "unplanned" as const, review: null };
  const unassigned: ApiActivity[] = [
    { ...base, id: "u-run", strava_activity_id: "900001", sport_type: "Run", start_time: new Date(`${today}T06:40:00+09:00`).toISOString(), distance_m: 7000, moving_time_sec: 2998, avg_pace_sec_km: 428, avg_hr: 152, max_hr: 171, avg_watts: 168, kcal: 512, device_name: "Apple Watch Series 11",
      splits: demoSplits([[442, 138], [435, 142], [401, 158], [404, 161], [413, 166], [448, 152], [455, 148]]) },
    { ...base, id: "u-hyrox", strava_activity_id: "900002", sport_type: "WeightTraining", start_time: new Date(`${today}T18:30:00+09:00`).toISOString(), distance_m: 0, moving_time_sec: 3480, avg_pace_sec_km: null, avg_hr: 152, max_hr: 171, avg_watts: null, kcal: 620, device_name: "Apple Watch Series 11" },
  ];

  return {
    coach_unread: 0,
    coach_checkin_open: false,
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
  return { ...d, coach_unread: coachUnread, coach_checkin_open: threadData().some((m) => (m.kind === "checkin" && m.checkin?.state === "open") || (m.kind === "ask" && m.ask?.state === "open")), activities: [...d.activities, ...d.unassigned].filter((a) => a.session_id), unassigned: d.unassigned.filter((a) => !a.session_id), routines: routines.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i })) })) };
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
      a.review = { verdict: "達成", comment: "（示範）數據落在課表目標內，感受也一致。", reminders: ["第 1 km 先走 2 分鐘再起跑"], source: "claude", model: "claude-haiku-4-5", adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString() };
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

/** Demo mode: the coach answers again after ~4 s. */
export function mockRereview(activityId: string): RereviewResponse {
  const a = findActivity(activityId);
  if (!a) throw new Error("not found");
  a.review = null;
  setTimeout(() => {
    a.review = { verdict: "達成但有提醒", comment: "（示範）重新分析：配速在區間內，但第 3 km 心拍衝到 166。", reminders: ["MP 第 3 公里開始看心拍"], source: "claude", model: "claude-haiku-4-5", adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString() };
  }, 4000);
  return { queued: true };
}

// Demo weekly review: one summary with two proposals (pending) against next week's sessions.
let weekly: ApiWeeklyReview[] | undefined;
function weeklyData(): ApiWeeklyReview[] {
  if (weekly) return weekly;
  const d = data();
  const long = d.sessions.find((s) => s.scheduled_date === "2026-10-18");
  const rec = d.sessions.find((s) => s.scheduled_date === "2026-10-16");
  weekly = [{
    id: "w-2026-10-12",
    week_start: "2026-10-12",
    summary: "（示範）第 2 週完成 3/4，Easy 心拍守得比第 1 週好（150→140）。10/14 MP 段配速到位但第 5 km 心拍 166 超過上限，體感也說第三公里開始腿重。長跑前一天排 Hyrox，建議把長跑目標心拍再壓低一點。",
    model: "claude-sonnet-5-5",
    adjustments: ([
      long ? { index: 0, session_id: long.id, field: "note" as const, old: long.note, new: "前日 Hyrox。心拍 ≤150 為最高優先，配速掉到 8:00 也可；超過 155 就走 1 分鐘。", reason: "10/14 MP 段心拍已衝到 166，長跑前一天又是 Hyrox，疲勞疊加時心拍容易失控。", status: "pending" as const, decided_at: null, applied_session_id: null } : null,
      rec ? { index: 1, session_id: rec.id, field: "target_distance_m" as const, old: rec.target_distance_m, new: 3000, reason: "本週已經有一次高強度，恢復跑縮短到 3 km 讓腿在 Hyrox 前多休一點。", status: "pending" as const, decided_at: null, applied_session_id: null } : null,
    ] as (ApiWeeklyReview["adjustments"][number] | null)[]).filter((x): x is ApiWeeklyReview["adjustments"][number] => !!x),
    created_at: new Date("2026-10-12T12:00:00Z").toISOString(),
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

// ---- the coach's thread (demo) ------------------------------------------------
let thread: ApiCoachMessage[] | undefined;
const at = (iso: string) => new Date(iso).toISOString();
const BLANK = { activity_id: null, weekly_review_id: null, status: "sent" as const, review: null, quote: null, rpe: null, checkin: null, ask: null, error: null };
function threadData(): ApiCoachMessage[] {
  if (thread) return thread;
  const w = weeklyData()[0];
  const today = todayJst();
  thread = [
    { id: "c1", role: "coach", kind: "weekly", text: w.summary ?? "", activity_id: null, weekly_review_id: w.id, status: "sent", review: null, quote: null, error: null, created_at: at("2026-10-12T12:00:00Z") },
    { id: "c2", role: "coach", kind: "review", text: "心拍整段壓在 140，是四次 Easy 裡最穩的一次。第 1 km 6:35 偏快是錶的心拍延遲，不是真的用力；第 6 km 8:01 是坡後自然放慢，正常。", activity_id: "a-2026-10-13", weekly_review_id: null, status: "sent", review: { label: "Easy 6 km", verdict: "達成", reminder: "第 1 km 前 3 分鐘用呼吸不用錶", date: "2026-10-13" }, quote: null, error: null, created_at: at("2026-10-12T22:52:00Z") },
    { id: "c3", role: "athlete", kind: "chat", text: "第一公里又衝太快了，有什麼辦法壓住？", activity_id: "a-2026-10-13", weekly_review_id: null, status: "sent", review: null, quote: "10/13 Easy 6.01 km · 7:25/km · 心拍 140（最高 148） · 達成", error: null, created_at: at("2026-10-12T23:10:00Z") },
    { id: "c4", role: "coach", kind: "chat", text: "這是連續第二次了。前 3 分鐘不要看錶，用鼻子呼吸能撐住的速度就是對的；第 1 km 跑到 7:30 以上才算成功。明天 MP 課的前 2 km Easy 也照這個來。", activity_id: null, weekly_review_id: null, status: "sent", review: null, quote: null, error: null, created_at: at("2026-10-12T23:10:20Z") },
    // Woo's check-in for today's run (demo: today's session is MP 7 km, two activities synced)
    { ...BLANK, id: "c5", role: "coach", kind: "checkin", text: "今天的課是 MP 7 km：2 km Easy + 3 km @ MP + 2 km Easy。Strava 剛進來 2 個活動，哪一個是這堂？", activity_id: "u-run", created_at: new Date(`${today}T07:05:00+09:00`).toISOString(),
      checkin: { state: "open", mode: "activity", date: today, session_id: todaySessionId(), session_label: "MP 7 km", candidates: [{ activity_id: "u-run", label: "跑步 06:40 · 7.00 km · 7:08/km" }, { activity_id: "u-hyrox", label: "重訓 18:30 · 58 分 · 心拍 152" }] } },
  ].map((m) => ({ ...BLANK, ...m })) as ApiCoachMessage[];
  return thread;
}

function todaySessionId(): string | null {
  const today = todayJst();
  return data().sessions.find((s) => s.scheduled_date === today)?.id ?? null;
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
  const cand = c.checkin.candidates.find((x) => x.activity_id === body.activity_id || x.session_id === body.session_id);
  if (!cand) throw new Error("not one of the candidates");
  const activityId = cand.activity_id ?? c.activity_id!;
  const sessionId = cand.session_id ?? c.checkin.session_id!;
  const d = data();
  const a = d.unassigned.find((x) => x.id === activityId) ?? d.activities.find((x) => x.id === activityId);
  if (a) { a.session_id = sessionId; a.match_status = "confirmed"; }
  c.checkin = { ...c.checkin, state: "picked" };
  const pick: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "pick", text: cand.label, status: "pending", activity_id: activityId, created_at: new Date().toISOString() };
  t.push(pick);
  setTimeout(() => {
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "ask", text: "收到，7.00 km 配到 MP 7 km。MP 段配速有守住，心拍第 5 km 到 166 超過上限。第 3 公里之後有撐住嗎？腿現在怎麼樣？", activity_id: activityId, ask: { state: "open", activity_id: activityId, session_id: sessionId }, created_at: new Date().toISOString() });
    pick.status = "sent";
  }, 2000);
  return { checkin: { ...c }, pick: { ...pick } };
}
/** Demo: undo the pick / dismissal and ask again. */
export function mockPostCheckinReset(checkinId: string): PostCheckinResetResponse {
  const t = threadData();
  const c = t.find((m) => m.id === checkinId && m.kind === "checkin");
  if (!c?.checkin || c.checkin.state === "open" || c.checkin.state === "reset") throw new Error("check-in cannot be reset");
  if (c.checkin.state === "picked") {
    const d = data();
    for (const m of t) if (m.kind === "pick" && m.activity_id) {
      const a = d.activities.find((x) => x.id === m.activity_id);
      if (a) { a.session_id = null; a.match_status = "unplanned"; a.review = null; a.memo = null; a.rpe = null; }
    }
    for (const m of t) if (m.kind === "ask" && m.ask?.state === "open") m.ask = { ...m.ask, state: "answered" };
    for (const m of t) if (m.role === "athlete" && m.status === "pending") m.status = "sent";
  }
  c.checkin = { ...c.checkin, state: "reset" };
  const fresh: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "checkin", text: `好，那是哪一個？今天的課是 ${c.checkin.session_label ?? ""}。`, activity_id: c.activity_id, checkin: { ...c.checkin, state: "open" }, created_at: new Date().toISOString() };
  t.push(fresh);
  return { checkin: { ...fresh } };
}

export function mockCoach(): CoachResponse {
  return { coach: { name: "Woo" }, messages: threadData().map((m) => ({ ...m })) };
}
/** Demo mode: Woo answers after ~3 s, off-topic gets the one-liner. */
export function mockPostCoachMessage(body: PostCoachMessageRequest): PostCoachMessageResponse {
  const t = threadData();
  if (body.answer_to) {
    const ask = t.find((m) => m.id === body.answer_to && m.kind === "ask");
    if (!ask?.ask) throw new Error("question not found");
    ask.ask = { ...ask.ask, state: "answered" };
    const d = data();
    const a = d.unassigned.find((x) => x.id === ask.ask!.activity_id) ?? d.activities.find((x) => x.id === ask.ask!.activity_id);
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
