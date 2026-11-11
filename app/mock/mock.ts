// Turns training-api's seed/plans.json into the shapes the API returns, so the
// UI runs with no backend. Mirrors seed/seed.ts: one session per date, hand-typed
// results become an activity + manual review on the same local date.

import plans from "./plans.json";
import type { AcceptInviteResponse, DeleteStravaResponse, ActivitiesResponse, AdoptPlanDraftResponse, ApiActivity, ApiAthleteProfile, ApiDraftSession, ApiDraftWeek, ApiPlanDraft, LatestPlanDraftResponse, PlanDraftOkResponse, PlanDraftResponse, PlanIntake, PostPlanDraftRequest, SessionType, ApiGroup, ApiGroupEvent, ApiGroupMember, ApiGroupProgress, ApiSharedActivity, ApiSharedReview, GroupEventDetailResponse, GroupEventsResponse, GroupOkResponse, GroupResponse, GroupsResponse, InvitePreviewResponse, InviteState, MemberPlanResponse, PostGroupInviteResponse, PostGroupRequest, PostGroupResponse, PutShareRequest, ShareResponse, ShareSettings, ApiCoachMessage, ApiConstraint, ApiProposal, ApiProposalChange, ApiRoutine, ApiSession, ApiSplit, ApiWeek, ApiWeeklyReview, CoachResponse, DetailOptionsResponse, PutDetailsRequest, PutDetailsResponse, PostCoachMessageRequest, PostCoachMessageResponse,
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
import { combine, groupBySession, MAX_PER_SESSION, overlaps } from "../lib/combine";
import { buildPlanView } from "../lib/plan";
import { addDays, dayDiff, md, mdDow, timeJst, todayJst, toJstDate } from "../lib/date";
import { draftToPlanResponse, nextMonday } from "../lib/draft";
import { mdPlain } from "../lib/groups";
import { duration, kmPlan, pace } from "../lib/format";
import { shortName, typeLabel, typeName } from "../lib/labels";
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

// ---- 裝備／裝置／天氣 (the report's details, editable) ----------------------------
// The api keeps Strava's value and the athlete's own value side by side and shows the athlete's
// when set. The mock keeps the same two maps and recomputes the shown values from them.
type DetailKey = "gear_name" | "device_name" | "weather";
const DETAIL_KEYS: DetailKey[] = ["gear_name", "device_name", "weather"];
type Detail3 = Record<DetailKey, string | null>;
const NO_DETAILS: ApiActivity["details"] = { gear_name: { source: null, strava: null }, device_name: { source: null, strava: null }, weather: { source: null, strava: null } };
const stravaVals = new Map<string, Detail3>();
const ownVals = new Map<string, Detail3>();

/** Recompute an activity's shown values and `details` from the two maps. */
function showDetails(a: ApiActivity) {
  const sv = stravaVals.get(a.id), ov = ownVals.get(a.id);
  if (!sv || !ov) return;
  const details = { ...NO_DETAILS };
  for (const k of DETAIL_KEYS) {
    a[k] = ov[k] ?? sv[k];
    details[k] = { source: ov[k] != null ? "user" : sv[k] != null ? "strava" : null, strava: sv[k] };
  }
  a.details = details;
}
/** First sight of an activity: what it carries is Strava's — except weather, which Strava does not have (the seed's weather text counts as the athlete's own, like the api where weather has no automatic source). */
function seedDetails(a: ApiActivity, own: Partial<Detail3> = {}) {
  stravaVals.set(a.id, { gear_name: a.gear_name, device_name: a.device_name, weather: null });
  ownVals.set(a.id, { gear_name: null, device_name: null, weather: a.weather, ...own });
  showDetails(a);
}

/** Mock-only switches for QA (set on window before the page needs them). */
interface MockKnobs { __mockStage?: string | null; __mockNoReply?: boolean; __mockFailDetails?: boolean; __mockDetailsDelay?: number; __mockCoachPageSize?: number; __mockCoachDelay?: number; __mockOlderFail?: boolean; __mockNoCounts?: boolean; __mockWeeklyStale?: boolean; __mockWeekly400?: boolean; __mockWeeklyMissing?: boolean; __mockNoWeekly?: boolean; __mockWeeklyWide?: boolean; __mockWeeklyDelay?: number }
const knobs = () => globalThis as unknown as MockKnobs;

/**
 * multi-session-activities switches (`window.__mock = { … }`, set before the page loads, e.g. with addInitScript):
 *   noTargets     every session has no pace, heart rate or distance target (a plan with nothing to compare: the report draws no 目標 vs 實際)
 *   three         10/23 Easy is three recordings (off: no activity on that day, as before)
 *   five          10/20 Easy is five recordings: the sheet's 加進這堂 is disabled
 *   ignoreSegment an activity id (`a-2026-10-20-2`): that recording is ignored, the session shows one again
 *   tooMany       every append answers 409 "too many …"
 *   conflict      every append answers a 409 the page has no sentence for ("這堂的紀錄剛被改過")
 *   elsewhere     `u-early` and `u-run-1019` are two recordings of 10/21's session: no entry offers them to 10/20 (the web hides them)
 *   elsewhere409  every move of an activity that sits in a session with other recordings answers the api's 409 (the rule below is always on; this forces it for any activity)
 */
interface MultiSwitches { noTargets?: boolean; three?: boolean; five?: boolean; ignoreSegment?: string; tooMany?: boolean; conflict?: boolean; elsewhere?: boolean; elsewhere409?: boolean }
const multi = (): MultiSwitches => (globalThis as unknown as { __mock?: MultiSwitches }).__mock ?? {};

/**
 * coach-correct-review switches (same `window.__mock`, set before the page loads). Sending a line like 「課表是 7:10 啊」 (課表是／報告…更新／重判／判錯／更正)
 * in the coach thread makes Woo agree (about the newest verdict message) and redo that verdict, unless:
 *   correction: "disagree"        only a reply, no re-judge (the correction is null)
 *               "failed"          the re-judge fails: the wait line becomes 重判沒成功, the report page 分析失敗
 *               "slow"            the new verdict never arrives (use a fake clock for the 3 minutes)
 *               "rejected"        Woo agreed but the api refused: why = limit (corrected twice today)
 *               "rejected-daily" | "rejected-manual" | "rejected-queued" | "rejected-unknown"   the other four whys
 *   reviewLimit                   the day's re-judge quota is used up: 重新分析 answers 429; a memo / a changed session leaves the fixed "今天沒辦法重判" failed row and Woo says so once;
 *                                 a correction is refused with why = daily
 * (without a switch: Woo agrees, the wait line walks reading → judging, the new verdict follows ~6 s after his reply; the third correction of one session in a day is refused with why = limit, and one while another is running with queued.)
 */
type CorrectionMode = "ok" | "disagree" | "failed" | "slow" | "rejected" | "rejected-daily" | "rejected-manual" | "rejected-queued" | "rejected-unknown";
interface CorrectionSwitches { correction?: CorrectionMode; reviewLimit?: boolean }
const ccr = (): CorrectionSwitches => (globalThis as unknown as { __mock?: CorrectionSwitches }).__mock ?? {};
const reviewLimited = () => ccr().reviewLimit === true;

/**
 * coach-correct-plan switch (same `window.__mock`, set before the page loads): Woo's card that corrects a session which is already done. Off by default
 * (the demo thread and plan stay as they were). With it on, 11/4 坡跑 (8 km on the plan, 6.1 km run) has its activity and the thread has Wei's two questions:
 *   "card"      the correction card is pending (採用 → Woo's confirmation, the wait line, ~4 s later the new verdict 「坡跑 6 km」, the old one dimmed)
 *   "note"      one row, distance and note together
 *   "mixed"     11/4 更正 plus an ordinary distance change on 11/11 (a full-width card across two weeks)
 *   "three"     3 sessions (11/1, 11/4, 11/5) in one card; the new verdicts come one by one
 *   "stale"     the card turned stale: 11/4 is no longer a completed session (409)
 *   "rejected"  Woo explains why 11/4 cannot become a rest day (no card), and a card the api refused (the grey line)
 *   "limit"     the day's re-judge quota is used up: the plan changes, the confirmation says it was not queued, no wait line
 *   "notqueued" the re-judge could not be queued (not the quota): the api's failed row and its line 「這次分析沒成功…」, then the same confirmation
 *   "slow"      the new verdict never arrives (the 3-minute sentence; use a fake clock)
 *   "interval"  like card, but 11/4 is labelled 間歇 (a label the web has no name for: its session name differs from the api's; the wait line must still end)
 *   "failafter" like card, but the re-judge fails after the confirmation: ~4 s later the api's failed row and its line 「這次分析沒成功…」 (no verdict)
 */
type CorrectPlanMode = "card" | "note" | "mixed" | "three" | "stale" | "rejected" | "limit" | "notqueued" | "slow" | "interval" | "failafter";
const CCP_MODES: readonly string[] = ["card", "note", "mixed", "three", "stale", "rejected", "limit", "notqueued", "slow", "interval", "failafter"];
const ccp = (): CorrectPlanMode | null => {
  const v = (globalThis as unknown as { __mock?: { correctPlan?: unknown } }).__mock?.correctPlan;
  return v === true ? "card" : typeof v === "string" && CCP_MODES.includes(v) ? (v as CorrectPlanMode) : null;
};

const REVIEW_LIMIT_TEXT = "今天重新分析的次數用完了（每天 20 次）。數據和心得都存好了，明天按「重新分析」就會重判。"; // the api's REVIEW_LIMIT_TEXT
const REVIEW_LIMIT_THREAD = "今天重新分析的次數用完了（每天 20 次），這些我明天再看；數據和心得都存好了。"; // the api's REVIEW_LIMIT_THREAD

const weekNoOn = (weeks: ApiWeek[], date: string) => weeks.find((w) => date >= w.week_start && date <= w.week_end)?.week_no ?? null;

/**
 * Write a 補課 into the demo plan the way the api's applyMakeup does: the old row stays (已改期, pointing at the
 * new one) and a new row appears on the new day. The new row counts in the old row's week unless that week
 * has a review (`reviewed`) — then in the week of the new day. The old row counts as a missed one in its own
 * week when the make-up counts elsewhere, and in no week when the make-up took its place.
 */
function makeUpSession(sessions: ApiSession[], weeks: ApiWeek[], old: ApiSession, toDate: string, reviewed: ReadonlySet<number>): ApiSession {
  const originWeek = weekNoOn(weeks, old.scheduled_date), newWeek = weekNoOn(weeks, toDate);
  const counts = originWeek != null && reviewed.has(originWeek) ? newWeek : originWeek;
  const row: ApiSession = { ...old, id: `s-mk-${old.scheduled_date}`, scheduled_date: toDate, week_no: newWeek, phase: weeks.find((w) => w.week_no === newWeek)?.phase ?? old.phase,
    version: old.version + 1, superseded: false, skipped_at: null, brief: null,
    moved_to_session_id: null, moved_to_date: null, moved_from_session_id: old.id, moved_from_date: old.scheduled_date, counts_in_week_no: counts };
  old.superseded = true;
  old.moved_to_session_id = row.id;
  old.moved_to_date = toDate;
  old.counts_in_week_no = counts !== originWeek ? originWeek : null;
  sessions.push(row);
  return row;
}

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
    target_distance_m: multi().noTargets ? null : s.distance_m,
    target_pace_sec_km: multi().noTargets ? null : s.pace_sec_km,
    target_pace_min_sec_km: multi().noTargets ? null : s.pace_min_sec_km,
    target_pace_max_sec_km: multi().noTargets ? null : s.pace_max_sec_km,
    target_hr_min: multi().noTargets ? null : s.hr_min,
    target_hr_max: multi().noTargets ? null : s.hr_max,
    brief: DEMO_BRIEFS[s.date] ?? null,
    skipped_at: null,
    version: 1,
    superseded: false,
    moved_to_session_id: null,
    moved_to_date: null,
    moved_from_session_id: null,
    moved_from_date: null,
    counts_in_week_no: s.week_no,
  }));

  const weeks: ApiWeek[] = (seed.weeks ?? []).map((w) => ({
    week_no: w.week_no, week_start: w.start, week_end: w.end, phase: w.phase, focus: w.focus,
  }));

  // Two 補課 already adopted (history, so the plan has 已改期 rows and make-up rows from the start). Both came from week 2 and
  // use sessions the weekly texts never call done (10/16 and 10/18; the texts say 10/13, 10/14 and week 3's runs were done).
  //  - 10/16 Recovery 4 km → 10/30: adopted before week 2's review was written → counts in week 2 (its original week); the 10/30 Easy made room.
  //  - 10/18 Long 14 km → 11/3: adopted after the review → counts in week 5, where it is run; the 11/3 Easy made room.
  const byId = (id: string) => sessions.find((x) => x.id === id)!;
  const drop = (id: string) => sessions.splice(sessions.findIndex((x) => x.id === id), 1);
  drop("s-2026-10-30");
  makeUpSession(sessions, weeks, byId("s-2026-10-16"), "2026-10-30", new Set());
  drop("s-2026-11-03");
  makeUpSession(sessions, weeks, byId("s-2026-10-18"), "2026-11-03", new Set([2]));
  sessions.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  if (ccp() === "interval") byId("s-2026-11-04").label = "間歇"; // coach-correct-plan: an AI-made plan's label

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
      details: NO_DETAILS,
      details_updated_at: null,
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
        corrected_at: null,
      },
      elapsed_time_sec: r.moving_time_sec + 60, // a minute of stops at the lights
      segment: null,
    };
  });

  // Demo inbox: three things Strava "just synced" today, waiting for the athlete to pick a
  // session. The walk is there so the mismatch question can be tried (pick it as the run).
  const today = todayJst();
  const base = { user_id: MOCK_USER_ID, description: null, memo: null, rpe: null, memo_updated_at: null, gear_name: null, weather: null, details: NO_DETAILS, details_updated_at: null, splits: null, session_id: null, match_status: "unplanned" as const, review: null, elapsed_time_sec: null, segment: null };
  const unassigned: ApiActivity[] = [
    { ...base, id: "u-run", strava_activity_id: "900001", sport_type: "Run", start_time: new Date(`${today}T06:40:00+09:00`).toISOString(), distance_m: 7000, moving_time_sec: 2998, elapsed_time_sec: 3100, avg_pace_sec_km: 428, avg_hr: 152, max_hr: 171, avg_watts: 168, kcal: 512, device_name: "Apple Watch Series 11", gear_name: "Adidas Adizero EVO SL",
      splits: demoSplits([[442, 138], [435, 142], [401, 158], [404, 161], [413, 166], [448, 152], [455, 148]]) },
    { ...base, id: "u-walk", strava_activity_id: "900003", sport_type: "Walk", start_time: new Date(`${today}T17:30:00+09:00`).toISOString(), distance_m: 4900, moving_time_sec: 3840, elapsed_time_sec: 3960, avg_pace_sec_km: 784, avg_hr: 99, max_hr: 118, avg_watts: null, kcal: 290, device_name: "Apple Watch Series 11" },
    { ...base, id: "u-hyrox", strava_activity_id: "900002", sport_type: "WeightTraining", start_time: new Date(`${today}T18:30:00+09:00`).toISOString(), distance_m: 0, moving_time_sec: 3480, elapsed_time_sec: 3600, avg_pace_sec_km: null, avg_hr: 152, max_hr: 171, avg_watts: null, kcal: 620, device_name: "Apple Watch Series 11" },
    // multi-session-activities: a second run the same morning (7:40, after u-run ended at 7:31: 也算今天的課), and one recorded twice
    // (6:41, a phone running next to the watch: it overlaps u-run, so it is never offered as another recording of that session)
    { ...base, id: "u-run2", strava_activity_id: "900004", sport_type: "Run", start_time: new Date(`${today}T07:40:00+09:00`).toISOString(), distance_m: 2100, moving_time_sec: 940, elapsed_time_sec: 960, avg_pace_sec_km: 448, avg_hr: 146, max_hr: 158, avg_watts: 160, kcal: 160, device_name: "Apple Watch Series 11", gear_name: "Adidas Adizero EVO SL",
      splits: demoSplits([[452, 144], [444, 148]]) },
    { ...base, id: "u-run-dup", strava_activity_id: "900005", sport_type: "Run", start_time: new Date(`${today}T06:41:00+09:00`).toISOString(), distance_m: 6900, moving_time_sec: 2985, elapsed_time_sec: 3080, avg_pace_sec_km: 433, avg_hr: null, max_hr: null, avg_watts: null, kcal: null, device_name: "iPhone 17" },
  ];

  // multi-session-activities: 10/20 Easy 6 km was run as two recordings (the watch was stopped by mistake at 2.5 km and started again: 隔 12 分,
  // counted from the first one's elapsed time; the moving time alone would say 14), and a few activities around that day to add, swap and be refused.
  // The first recording carries the review and the memo; the second has its own note. `three` also makes 10/23 three recordings; `five` makes 10/20 five.
  const at20 = (hm: string) => new Date(`2026-10-20T${hm}:00+09:00`).toISOString();
  const at23 = (hm: string) => new Date(`2026-10-23T${hm}:00+09:00`).toISOString();
  const runBase = { ...base, user_id: MOCK_USER_ID, sport_type: "Run", match_status: "confirmed" as const, device_name: "Apple Watch Series 11", gear_name: "Adidas Adizero EVO SL", avg_watts: null };
  const multiRuns: ApiActivity[] = [
    { ...runBase, id: "a-2026-10-20", strava_activity_id: "20261020", session_id: "s-2026-10-20", start_time: at20("07:00"), distance_m: 2500, moving_time_sec: 1075, elapsed_time_sec: 1200, avg_pace_sec_km: 430, avg_hr: 141, max_hr: 152, kcal: 190, weather: "晴 14℃",
      memo: "前 2.5 km 手錶被誤觸關掉，停下來重新開了一筆。前半輕鬆，呼吸很穩。", rpe: 3, memo_updated_at: at20("12:00"),
      splits: [...demoSplits([[432, 139], [428, 142]]), { split: 3, distance: 500, moving_time: 215, elapsed_time: 215, elevation_difference: 0, average_speed: 500 / 215, average_heartrate: 143 }],
      review: { verdict: "達成", comment: "（示範）整堂 6.03 km、7:11，心拍 143 都在範圍內。中間手錶關掉重開不影響整體節奏，後半沒有掉速。", reminders: ["第 1 km 前 3 分鐘用呼吸不用錶"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: at20("12:30"), corrected_at: null } },
    { ...runBase, id: "a-2026-10-20-2", strava_activity_id: "20261020002", session_id: "s-2026-10-20", start_time: at20("07:32"), distance_m: 3530, moving_time_sec: 1524, elapsed_time_sec: 1580, avg_pace_sec_km: 432, avg_hr: 145, max_hr: 155, kcal: 270, weather: null,
      memo: "後半腿比較沉，最後 1 km 有點喘。", rpe: 6, memo_updated_at: at20("12:05"),
      splits: [...demoSplits([[434, 143], [431, 145], [430, 146]]), { split: 4, distance: 530, moving_time: 229, elapsed_time: 229, elevation_difference: 0, average_speed: 530 / 229, average_heartrate: 148 }] },
  ];
  if (multi().five) {
    for (const [n, hm] of [[3, "08:10"], [4, "08:30"], [5, "08:50"]] as const) {
      multiRuns.push({ ...runBase, id: `a-2026-10-20-${n}`, strava_activity_id: `20261020${String(n).padStart(3, "0")}`, session_id: "s-2026-10-20", start_time: at20(hm), distance_m: 1000, moving_time_sec: 430, elapsed_time_sec: 470, avg_pace_sec_km: 430, avg_hr: 144, max_hr: 150, kcal: 80, splits: demoSplits([[430, 144]]) });
    }
  }
  if (multi().three) {
    multiRuns.push(
      { ...runBase, id: "a-2026-10-23", strava_activity_id: "20261023", session_id: "s-2026-10-23", start_time: at23("07:00"), distance_m: 2000, moving_time_sec: 860, elapsed_time_sec: 920, avg_pace_sec_km: 430, avg_hr: 140, max_hr: 149, kcal: 150, weather: "くもり 12℃",
        memo: "前 2 km 熱身，手錶一直沒鎖定，乾脆停掉重開。", rpe: 3, memo_updated_at: at23("12:00"), splits: demoSplits([[432, 138], [428, 141]]),
        review: { verdict: "達成", comment: "（示範）整堂 6.14 km、7:08，三段接起來節奏很一致。", reminders: ["前 2 km 的心拍留在 140 以下"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: at23("12:30"), corrected_at: null } },
      { ...runBase, id: "a-2026-10-23-2", strava_activity_id: "20261023002", session_id: "s-2026-10-23", start_time: at23("07:25"), distance_m: 2200, moving_time_sec: 940, elapsed_time_sec: 1000, avg_pace_sec_km: 427, avg_hr: 143, max_hr: 151, kcal: 165, splits: demoSplits([[429, 142], [425, 144]]) },
      { ...runBase, id: "a-2026-10-23-3", strava_activity_id: "20261023003", session_id: "s-2026-10-23", start_time: at23("07:50"), distance_m: 1940, moving_time_sec: 828, elapsed_time_sec: 828, avg_pace_sec_km: 427, avg_hr: 144, max_hr: 152, kcal: 140, splits: demoSplits([[426, 144]]) },
    );
  }
  // coach-correct-plan: the sessions its card corrects were run (11/4 坡跑 8 km on the plan, 6.1 km run, verdict 達成)
  if (ccp()) {
    const atC = (date: string, hm: string) => new Date(`${date}T${hm}:00+09:00`).toISOString();
    const verdictOf = (date: string, comment: string, reminder: string) => ({ verdict: "達成" as const, comment, reminders: [reminder], source: "claude" as const, model: null, adjust_hint: null, failed: false, error: null, created_at: atC(date, "19:40"), corrected_at: null });
    multiRuns.push({ ...runBase, id: "a-2026-11-04", strava_activity_id: "20261104", session_id: "s-2026-11-04", start_time: atC("2026-11-04", "18:30"), distance_m: 6100, moving_time_sec: 2500, elapsed_time_sec: 2640, avg_pace_sec_km: 410, avg_hr: 142, max_hr: 168, kcal: 470, weather: "晴 15℃",
      review: verdictOf("2026-11-04", "6 趟上坡都在 6:00 以內，平均 5:41；前後兩段 Easy 7:20 上下，心拍 142。", "下次坡跑第 6 趟一樣守 6:00") });
    if (ccp() === "three") {
      multiRuns.push(
        { ...runBase, id: "a-2026-11-01", strava_activity_id: "20261101", session_id: "s-2026-11-01", start_time: atC("2026-11-01", "07:00"), distance_m: 15800, moving_time_sec: 6060, elapsed_time_sec: 6420, avg_pace_sec_km: 384, avg_hr: 151, max_hr: 166, kcal: 1180, weather: "晴 12℃",
          review: verdictOf("2026-11-01", "前 12 km 穩在 6:55，最後 4 km 6:45 守住，心拍 151。", "補給照這次的節奏") },
        { ...runBase, id: "a-2026-11-05", strava_activity_id: "20261105", session_id: "s-2026-11-05", start_time: atC("2026-11-05", "07:00"), distance_m: 4600, moving_time_sec: 2100, elapsed_time_sec: 2160, avg_pace_sec_km: 457, avg_hr: 131, max_hr: 142, kcal: 300, weather: null,
          review: verdictOf("2026-11-05", "全程 7:37，心拍 131，是該有的恢復跑。", "保持這個放鬆程度") },
      );
    }
  }
  for (const a of multiRuns) {
    if (a.id === multi().ignoreSegment) { a.session_id = null; a.match_status = "ignored"; a.review = null; unassigned.push(a); } else activities.push(a);
  }
  activities.sort((x, y) => x.start_time.localeCompare(y.start_time));
  // ... and the activities around 10/20 that nothing is assigned to (with `elsewhere`, two of them are the recordings of another session)
  unassigned.push(
    { ...base, id: "u-early", strava_activity_id: "900011", sport_type: "Run", start_time: at20("06:10"), distance_m: 1200, moving_time_sec: 560, elapsed_time_sec: 600, avg_pace_sec_km: 467, avg_hr: 128, max_hr: 139, avg_watts: null, kcal: 80, device_name: "Apple Watch Series 11" },
    { ...base, id: "u-dup-1020", strava_activity_id: "900012", sport_type: "Run", start_time: at20("07:05"), distance_m: 2400, moving_time_sec: 1040, elapsed_time_sec: 1150, avg_pace_sec_km: 433, avg_hr: null, max_hr: null, avg_watts: null, kcal: null, device_name: "iPhone 17" },
    { ...base, id: "u-walk-1020", strava_activity_id: "900013", sport_type: "Walk", start_time: at20("18:20"), distance_m: 3100, moving_time_sec: 2465, elapsed_time_sec: 2520, avg_pace_sec_km: 795, avg_hr: 98, max_hr: 116, avg_watts: null, kcal: 190, device_name: "Apple Watch Series 11" },
    { ...base, id: "u-run-1019", strava_activity_id: "900014", sport_type: "Run", start_time: new Date("2026-10-19T19:05:00+09:00").toISOString(), distance_m: 4050, moving_time_sec: 1830, elapsed_time_sec: 1890, avg_pace_sec_km: 452, avg_hr: 139, max_hr: 150, avg_watts: null, kcal: 280, device_name: "Apple Watch Series 11" },
  );
  // link-past-activity (算成哪一堂): runs nothing is bound to, from before today. 10/27 has an Easy 7 km with no recording (the plain case: the same day, so it is
  // picked when the sheet opens). 10/09 is a rest day with every run session around it already run (10/8, 10/10, 10/11), so only 10/14 MP is open and it is 5 days away:
  // nothing is picked when the sheet opens.
  unassigned.push(
    { ...base, id: "u-link-1027", strava_activity_id: "900021", sport_type: "Run", start_time: new Date("2026-10-27T06:50:00+09:00").toISOString(), distance_m: 7040, moving_time_sec: 3140, elapsed_time_sec: 3200, avg_pace_sec_km: 446, avg_hr: 141, max_hr: 153, avg_watts: null, kcal: 480, device_name: "Apple Watch Series 11" },
    { ...base, id: "u-link-1009", strava_activity_id: "900022", sport_type: "Run", start_time: new Date("2026-10-09T18:30:00+09:00").toISOString(), distance_m: 3200, moving_time_sec: 1480, elapsed_time_sec: 1530, avg_pace_sec_km: 463, avg_hr: 133, max_hr: 146, avg_watts: null, kcal: 215, device_name: "Apple Watch Series 11" },
  );
  if (multi().elsewhere) {
    for (const id of ["u-early", "u-run-1019"]) {
      const i = unassigned.findIndex((x) => x.id === id);
      const [x] = unassigned.splice(i, 1);
      x.session_id = "s-2026-10-21"; x.match_status = "confirmed";
      activities.push(x);
    }
    activities.sort((x, y) => x.start_time.localeCompare(y.start_time));
  }

  // Test-only activities a few days back, `ignored` so no list shows them (open them by URL): a yoga
  // session with nothing but a time (every detail empty), and a run whose Strava names are very long.
  const back = addDays(today, -10);
  const hidden = { ...base, match_status: "ignored" as const, avg_pace_sec_km: null, avg_hr: null, max_hr: null, avg_watts: null, kcal: null, device_name: null, gear_name: null };
  unassigned.push(
    { ...hidden, id: "u-yoga", strava_activity_id: "900101", sport_type: "Yoga", start_time: new Date(`${back}T20:00:00+09:00`).toISOString(), distance_m: 0, moving_time_sec: 2700 },
    { ...hidden, id: "u-longname", strava_activity_id: "900102", sport_type: "Run", start_time: new Date(`${back}T07:00:00+09:00`).toISOString(), distance_m: 5000, moving_time_sec: 1750, avg_pace_sec_km: 350, avg_hr: 148, max_hr: 163, avg_watts: 201, kcal: 345,
      device_name: "Garmin Forerunner 965 Black Titanium Edition", gear_name: "Adidas Adizero Boston 13 Prototype Racing Edition" },
  );
  for (const a of [...activities, ...unassigned]) {
    // 10/10 is a run whose shoes the athlete corrected after Strava's default
    if (a.id === "a-2026-10-10") { seedDetails(a, { gear_name: "Nike Pegasus 41" }); a.details_updated_at = new Date("2026-10-10T13:00:00+09:00").toISOString(); } else seedDetails(a);
  }

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
    groups_unread: 0,
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

/** `window.__mockNoCounts = true`: the plan as an api from before coach-adjust-2 sends it (no 補課 fields, no 已改期 rows), to try web deployed first. */
const withoutMakeupFields = (sessions: ApiSession[]): ApiSession[] =>
  sessions.filter((s) => !s.moved_to_date).map((s) => {
    const o = { ...s } as Partial<ApiSession>;
    delete o.moved_to_session_id; delete o.moved_to_date; delete o.moved_from_session_id; delete o.moved_from_date; delete o.counts_in_week_no;
    return o as ApiSession;
  });

/**
 * apple-native-redesign (今天 hero ring): `window.__mock = { ring: "half" | "done" | "over" }` gives the current week runs for its sessions
 * (about 55 %, 100 %, 112 % of the week's plan) so the ring can be seen part-way, closed (達標) and over 100 %. Off by default: the data is the same as before.
 */
function ringRuns(d: PlanResponse, sessions: ApiSession[]): ApiActivity[] {
  const mode = (globalThis as unknown as { __mock?: { ring?: string } }).__mock?.ring;
  if (!mode) return [];
  const today = todayJst();
  const week = d.weeks.find((w) => today >= w.week_start && today <= w.week_end);
  if (!week) return [];
  const k = mode === "half" ? 0.55 : mode === "over" ? 1.12 : 1;
  const mine = sessions.filter((x) => x.counts_in_week_no === week.week_no && (x.target_distance_m ?? 0) > 0 && x.type !== "rest" && !x.moved_to_date);
  const tpl = d.activities.find((a) => a.session_id) ?? d.activities[0];
  if (!tpl) return [];
  return mine.filter((x) => !d.activities.some((a) => a.session_id === x.id)).map((x) => ({
    ...tpl, id: `a-ring-${x.id}`, strava_activity_id: `ring-${x.id}`, session_id: x.id, start_time: new Date(`${x.scheduled_date}T07:00:00+09:00`).toISOString(),
    distance_m: Math.round((x.target_distance_m ?? 0) * k), moving_time_sec: Math.round(((x.target_distance_m ?? 0) * k) / 1000 * 420), match_status: "auto" as const, splits: null,
  }));
}

/** Every GET /plan the app made (timestamps), for QA (`window.__planCalls`): with `__weeklyCalls`, shows /weekly is asked next to /plan. */
const planCalls: number[] = [];
if (typeof window !== "undefined") (window as unknown as { __planCalls: number[] }).__planCalls = planCalls;
export function mockPlan(): PlanResponse {
  planCalls.push(Date.now());
  const pf = lsw().planFail; // link-past-activity: GET /plan fails (see LinkSwitches)
  if (pf) throw pf === "503" ? new ApiError(503, "service unavailable") : new Error("network");
  if (adoptedPlan) return { ...adoptedPlan, groups_unread: groupsUnreadTotal() }; // ai-plan-generation: a draft was adopted, that is my plan now
  if (has("nomyplan")) throw new ApiError(404, "no active plan"); // the api answers 404 to someone without an active plan
  refreshSegments();
  const d = data();
  // `planFinished`: the plan ended yesterday (its sessions stop there); the activities stay
  const ended = dsw().planFinished === true ? addDays(todayJst(), -1) : null;
  const t = threadData();
  const openAsk = [...t].reverse().find((m) => m.kind === "ask" && m.ask?.state === "open")?.ask ?? null;
  const sessions = ended ? d.sessions.filter((s) => s.scheduled_date <= ended) : d.sessions;
  return {
    ...d,
    plan: ended ? { ...d.plan, race_date: ended } : d.plan,
    weeks: ended ? d.weeks.filter((w) => w.week_start <= ended) : d.weeks,
    sessions: knobs().__mockNoCounts ? withoutMakeupFields(sessions) : sessions,
    coach_unread: coachUnread,
    coach_checkin_open: !!openAsk || t.some((m) => m.kind === "checkin" && m.checkin?.state === "open"),
    coach_ask_kind: openAsk?.kind ?? null,
    activities: [...d.activities, ...ringRuns(d, sessions), ...d.unassigned].filter((a) => a.session_id),
    unassigned: d.unassigned.filter((a) => !a.session_id),
    routines: routines.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i })) })),
    constraints: constraints.filter((c) => c.status === "active").map((c) => ({ ...c })),
    groups_unread: groupsUnreadTotal(),
  };
}

/** 解除 Strava (設定): after it answers ok, GET /me has no Strava (the Strava page stays and shows 尚未連結). `strava: "unlink-fail"` answers 500 and the link stays. */
let stravaUnlinked = false;
export async function mockDisconnectStrava(): Promise<DeleteStravaResponse> {
  await new Promise((r) => setTimeout(r, 600)); // long enough to see 解除中…
  if (gsw().strava === "unlink-fail") throw new ApiError(500, "伺服器錯誤，稍後再試");
  stravaUnlinked = true;
  return { ok: true };
}

export function mockMe(): MeResponse {
  return {
    user: { id: MOCK_USER_ID, display_name: "Wei Wu", email: gsw().me === "long" ? "wei.wu.longaddress@example-mail.com" : "wei@example.com" },
    strava: stravaUnlinked || dsw().strava === false || gsw().strava === "none" ? null : { athlete_id: "12345678", scope: gsw().me === "long" ? "read,activity:read_all,profile:read_all,read_all" : "read,activity:read_all", expires_at: new Date(Date.now() + 3600_000).toISOString() },
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
  refreshSegments();
  // reviewLimit: the memo is saved, the re-judge is not queued (the api writes a failed row with the fixed sentence)
  if (reviewLimited() && a.session_id && a.review?.source === "claude") limitReview(groupOfSession(a.session_id)[0] ?? a);
  return { activity: { ...a } };
}

/**
 * Demo mode: the athlete's own shoe / device / weather. Same rules as the api: a present key is set
 * (cleaned to one line, ≤ 40 chars), "" or null clears it. `window.__mockFailDetails = true` makes it fail.
 */
export async function mockPutDetails(activityId: string, body: PutDetailsRequest): Promise<PutDetailsResponse> {
  await new Promise((r) => setTimeout(r, knobs().__mockDetailsDelay ?? 250));
  if (knobs().__mockFailDetails) throw new ApiError(500, "伺服器錯誤，稍後再試");
  const a = findActivity(activityId);
  if (!a) throw new ApiError(404, "activity not found");
  const keys = DETAIL_KEYS.filter((k) => k in body);
  if (!keys.length) throw new ApiError(400, "nothing to update");
  const next: Partial<Detail3> = {};
  for (const k of keys) {
    const v: unknown = body[k];
    if (v == null) { next[k] = null; continue; }
    if (typeof v !== "string") throw new ApiError(400, `${k} must be a string`);
    const clean = [...v].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").replace(/\s+/g, " ").trim(); // control chars → space, like the api
    if (clean.length > 40) throw new ApiError(400, `${k} too long (40 chars)`);
    next[k] = clean || null;
  }
  ownVals.set(a.id, { ...(ownVals.get(a.id) as Detail3), ...next });
  a.details_updated_at = new Date().toISOString();
  showDetails(a);
  return { activity: { ...a } };
}

/** Demo mode: names used before (own values and Strava's), distinct, most recently used first, at most 8 each. */
export function mockDetailOptions(): DetailOptionsResponse {
  const all = [...data().activities, ...data().unassigned];
  const pick = (k: "gear_name" | "device_name") => {
    const seen = new Map<string, string>();
    for (const a of all) {
      const sv = stravaVals.get(a.id)?.[k], ov = ownVals.get(a.id)?.[k];
      if (sv) { const t = a.start_time; if (!seen.has(sv) || seen.get(sv)! < t) seen.set(sv, t); }
      if (ov) { const t = a.details_updated_at ?? a.start_time; if (!seen.has(ov) || seen.get(ov)! < t) seen.set(ov, t); }
    }
    return [...seen.entries()].sort((x, y) => y[1].localeCompare(x[1])).slice(0, 8).map(([v]) => v);
  };
  return { gear_name: pick("gear_name"), device_name: pick("device_name") };
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
  const was = a.session_id;
  a.session_id = null;
  a.match_status = status;
  a.review = null;
  relist(a);
  if (was) regroupMock(was);
}

// ---- several recordings in one session (multi-session-activities) ----
// The api's rules, in memory: a session holds up to 5 activities (ignored ones left out), the earliest start is the primary one and
// carries the review, adding / removing / swapping one drops the Claude review of the whole group and Woo judges it again.

const km2 = (m: number) => (m / 1000).toFixed(2);
const byStart = (x: ApiActivity, y: ApiActivity) => x.start_time.localeCompare(y.start_time) || x.id.localeCompare(y.id);
const everyActivity = (): ApiActivity[] => [...new Map([...data().activities, ...data().unassigned].map((a) => [a.id, a])).values()];
/** The session's activities that are not ignored, oldest start first; `exceptId` leaves one out. */
const groupOfSession = (sessionId: string, exceptId?: string) => everyActivity().filter((a) => a.session_id === sessionId && a.match_status !== "ignored" && a.id !== exceptId).sort(byStart);

/** The `segment` field of every activity, as the api computes it in ACTIVITY_SELECT. */
function refreshSegments() {
  const all = everyActivity();
  const groups = groupBySession(all);
  for (const a of all) {
    const g = a.session_id && a.match_status !== "ignored" ? groups.get(a.session_id) : undefined;
    a.segment = g ? { primary_activity_id: g[0].id, index: g.findIndex((x) => x.id === a.id) + 1, count: g.length } : null;
  }
}

/** Drop the group's Claude review and have Woo judge it again in ~4 s (a manual review on the primary stays). The last change wins. */
const regroupToken = new Map<string, number>();
function regroupMock(sessionId: string) {
  const group = groupOfSession(sessionId);
  for (const g of group) if (g.review?.source === "claude") g.review = null;
  const token = (regroupToken.get(sessionId) ?? 0) + 1;
  regroupToken.set(sessionId, token);
  if (!group.length || group[0].review) return;
  if (reviewLimited()) { limitReview(group[0]); return; }
  setTimeout(() => {
    if (regroupToken.get(sessionId) !== token) return;
    const now = groupOfSession(sessionId);
    if (!now.length || now[0].review) return;
    judge(now[0], data().sessions.find((x) => x.id === sessionId) ?? null, now.length);
    afterJudged();
  }, 4000);
}

/** The three append paths (check-in chip, 也算今天的課, 這堂的活動 → 加進這堂) end the same way: Woo's fixed line, then the whole session is judged again. */
function appendDone(sessionId: string) {
  const group = groupOfSession(sessionId);
  const t = threadData();
  t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: `好，${group.length} 段一起算 ${km2(combine(group).distance_m)} km，我重新看一次。`, activity_id: group[0]?.id ?? null, created_at: new Date().toISOString() });
  regroupMock(sessionId);
}

/** The api's refusal for moving an activity out of a session that has other recordings (its review would be left over a group that lost a segment): take it out there first. */
function checkElsewhere(a: ApiActivity, sessionId: string) {
  if (multi().elsewhere409 || (a.session_id && a.session_id !== sessionId && a.match_status !== "ignored" && groupOfSession(a.session_id, a.id).length > 0)) {
    throw new ApiError(409, "source session has other segments, remove it there first"); // the api's string
  }
}

/** The api's refusals for adding `a` to a session that already has activities, in its order, with its English wording. */
function checkAppend(a: ApiActivity, sessionId: string) {
  checkElsewhere(a, sessionId);
  const holders = groupOfSession(sessionId, a.id);
  if (multi().conflict) throw new ApiError(409, "session changed, try again");
  if (multi().tooMany || holders.length + 1 > MAX_PER_SESSION) throw new ApiError(409, `too many activities for one session (${MAX_PER_SESSION})`);
  if (isRun(a) !== isRun(holders[0])) throw new ApiError(409, "segments must be the same kind of activity");
  if (holders.some((h) => overlaps(h, a))) throw new ApiError(409, "activities overlap in time");
}

/** Today's session already has a run and another one of the same kind came in: Woo asks whether it is the same session (once per activity). */
const appendAsked = new Set<string>();
function maybeAppendCheckin() {
  const d = data();
  const t = threadData();
  const today = todayJst();
  const s = d.sessions.find((x) => x.scheduled_date === today && !x.moved_to_date);
  if (!s) return;
  const group = groupOfSession(s.id);
  if (!group.length || group.length >= MAX_PER_SESSION) return;
  const tail = t[t.length - 1];
  if (tail?.kind === "ask" && tail.ask?.state === "open") return; // his other question first
  if (t.some((m) => m.kind === "checkin" && m.checkin?.mode === "append" && m.checkin.state === "open")) return;
  const cands = everyActivity().filter((x) => !x.session_id && x.match_status !== "ignored" && toJstDate(x.start_time) === today && isRun(x) === isRun(group[0]) && !appendAsked.has(x.id) && !group.some((g) => overlaps(g, x))).sort(byStart);
  if (!cands.length) return;
  for (const x of cands) appendAsked.add(x.id);
  const label = (x: ApiActivity) => `加進同一堂：${isRun(x) ? "跑步" : "運動"} ${timeJst(x.start_time)} · ${km2(x.distance_m)} km${isRun(x) ? ` · ${pace(x.avg_pace_sec_km)}/km` : ""}`;
  t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "checkin", activity_id: cands[0].id, created_at: new Date().toISOString(),
    text: `今天的 ${shortName(s)} 已經配了 ${group.map((g) => `${timeJst(g.start_time)} 那趟 ${km2(g.distance_m)} km`).join("、")}。Strava 又進來 ${cands.length} 個活動，是同一堂的另一段嗎？`,
    checkin: { state: "open", mode: "append", date: today, session_id: s.id, session_label: shortName(s), candidates: cands.map((x) => ({ activity_id: x.id, label: label(x) })) } });
}
/** After anything that binds today's run, or finishes a question about it. */
function afterJudged() {
  setTimeout(maybeAppendCheckin, 600);
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

/** The api's `sessionLabel` (label ?? type, then the distance): the title the worker writes on a verdict message. The demo uses it in the correct-plan scenarios, where the label can be one the web has no name for. */
const sessionTitle = (s: Pick<ApiSession, "label" | "type" | "target_distance_m">) => `${s.label ?? s.type}${s.target_distance_m ? ` ${Math.round(s.target_distance_m / 100) / 10} km` : ""}`;

/** The demo verdict (the worker's review of the activity + Woo's line in the thread). */
function judge(a: ApiActivity, s: ApiSession | null, segments = 1) {
  if (reviewLimited()) { limitReview(a); return; }
  const comment = segments > 1 ? `（示範）${segments} 段一起 ${km2(combine(groupOfSession(a.session_id ?? "")).distance_m)} km，數據落在課表目標內，整堂當一趟來看。` : "（示範）數據落在課表目標內，感受也一致。";
  const reminder = "第 1 km 先走 2 分鐘再起跑";
  a.review = { verdict: "達成", comment, reminders: [reminder], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString(), corrected_at: null };
  const t = threadData();
  supersedeEarlier(a);
  t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "review", text: comment, activity_id: a.id, review: { label: s ? (ccp() ? sessionTitle(s) : shortName(s)) : "未排課", verdict: "達成", reminder, date: s?.scheduled_date ?? todayJst(), updated: null, superseded: false }, created_at: new Date().toISOString() });
}

/** Every redo marks the session's earlier verdict messages in the thread as replaced (the api's supersedeReviewMessages): they stay, dimmed. Call before pushing the new one. */
function supersedeEarlier(a: ApiActivity) {
  const ids = new Set([a.id, ...(a.session_id ? groupOfSession(a.session_id).map((g) => g.id) : [])]);
  for (const m of threadData()) if (m.kind === "review" && m.review && m.activity_id && ids.has(m.activity_id)) m.review = { ...m.review, superseded: true };
}

/** reviewLimit: the day's re-judge quota is used up. The review becomes the api's failed row with the fixed sentence, and Woo says it in the thread once a day. */
function limitReview(a: ApiActivity) {
  a.review = { verdict: null, comment: null, reminders: [], source: "claude", model: null, adjust_hint: null, failed: true, error: REVIEW_LIMIT_TEXT, created_at: new Date().toISOString(), corrected_at: null };
  const t = threadData();
  if (!t.some((m) => m.role === "coach" && m.kind === "chat" && m.text === REVIEW_LIMIT_THREAD)) t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: REVIEW_LIMIT_THREAD, activity_id: a.id, created_at: new Date().toISOString() });
}

/**
 * Demo mode: assign an unassigned activity to a session; the "coach" answers after ~4 s —
 * unless the pick looks wrong (a walk, or under half the distance): then Woo asks first,
 * like the api does, and the verdict comes after 是 in the thread.
 *   append: one more recording of the session (the holders stay; the api's 409s: too many, another kind, overlap);
 *   without it a confirmed holder is a 409 unless `replace`, which bumps every holder back to unassigned.
 *   { session_id: null } on a recording of a group: the rest of the group is judged again.
 */
function putSessionNow(activityId: string, body: PutSessionRequest): PutSessionResponse {
  const d = data();
  const a = findActivity(activityId);
  if (!a) throw new Error("not found");
  if (body.append && body.replace) throw new ApiError(400, "append and replace are exclusive");
  if (body.session_id) {
    const sessionId = body.session_id;
    const s = d.sessions.find((x) => x.id === sessionId) ?? null;
    checkElsewhere(a, sessionId);
    // (an activity picked through the check-in still sits in `unassigned`, so look in both lists)
    const holders = groupOfSession(sessionId, a.id);
    const append = body.append === true && holders.length > 0;
    if (holders.length && append) checkAppend(a, sessionId);
    else if (holders.length) {
      if (holders.some((h) => h.match_status === "confirmed") && !body.replace) throw new ApiError(409, "session already confirmed for another activity");
      for (const holder of holders) {
        holder.session_id = null; holder.match_status = "unplanned"; holder.review = null;
        // Woo's open question about the replaced activity is moot now.
        for (const m of threadData()) if (m.kind === "ask" && m.ask?.state === "open" && m.ask.activity_id === holder.id) m.ask = { ...m.ask, state: "answered" };
        relist(holder);
      }
      regroupToken.set(sessionId, (regroupToken.get(sessionId) ?? 0) + 1); // a judgement still on its way for the old group is void
    }
    const wasSession = a.session_id && a.session_id !== sessionId ? a.session_id : null;
    a.session_id = sessionId;
    a.match_status = "confirmed";
    a.review = null;
    if (body.memo !== undefined || body.rpe !== undefined) {
      a.memo = body.memo && body.memo.trim() ? body.memo.trim() : null;
      a.rpe = body.rpe ?? null;
      a.memo_updated_at = new Date().toISOString();
    }
    relist(a);
    if (wasSession) regroupMock(wasSession);
    if (append) {
      // an open "same session?" check-in of that day is answered by this
      for (const m of threadData()) if (m.kind === "checkin" && m.checkin?.mode === "append" && m.checkin.state === "open" && m.checkin.session_id === sessionId) m.checkin = { ...m.checkin, state: "picked" };
      appendDone(sessionId);
    } else {
      const reason = s ? mismatchReason(a, s) : null;
      if (s && reason) postMismatchAsk(a, s, reason, "report");
      else if (reviewLimited()) limitReview(a);
      else setTimeout(() => { a.review = { verdict: "達成", comment: "（示範）數據落在課表目標內，感受也一致。", reminders: ["第 1 km 先走 2 分鐘再起跑"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString(), corrected_at: null }; afterJudged(); }, 4000);
    }
  } else {
    const was = a.session_id;
    a.session_id = null;
    a.match_status = body.status ?? "unplanned";
    a.review = null;
    relist(a);
    if (was) regroupMock(was);
  }
  refreshSegments();
  return { activity: { ...a } };
}

/**
 * link-past-activity (算成哪一堂): the sheet's call is `{ session_id }` alone (no replace, no append). It answers after `linkDelay` ms (350 unless set: the 送出中… state can be seen,
 * and a second press has time to happen) and is counted in `window.__linkPuts` (one entry per call, "activityId>sessionId"). `window.__mock = { link }` shapes the FIRST such call
 * only (the next ones are normal, so a retry or another pick can be tried):
 *   taken  another activity took the session first: 409 "session already confirmed for another activity" (the session now holds one, so the list loses it)
 *   gone   the session was changed under him (another tab adopted a card): 404 "session not found" (the session is no longer in the plan)
 *   fail   a network error, nothing changed
 *   lost   the api bound it but the answer never came back: the data changes, then a network error (the reload finds the activity bound)
 *   503    the database is waking up: 503, nothing changed
 * `planFail` (set on `window.__mock` AFTER the page has loaded, true or "503", false again to clear): every GET /plan fails (a network error, or a 503), as when the phone is offline
 * or the database is down; with `link: "fail"` or `"503"` it shows the sheet's answer when the page cannot look again.
 * `reviewLimit` works as for the other binds (the report page shows 今天沒辦法重判). A pick that does not look like the session makes Woo ask first (the usual mismatch).
 */
interface LinkSwitches { link?: "taken" | "gone" | "fail" | "lost" | "503"; linkDelay?: number; planFail?: boolean | "503" }
const lsw = (): LinkSwitches => (globalThis as unknown as { __mock?: LinkSwitches }).__mock ?? {};
const linkPuts: string[] = [];
if (typeof window !== "undefined") (window as unknown as { __linkPuts: string[] }).__linkPuts = linkPuts;
let linkShaped = false;

function linkPut(activityId: string, body: PutSessionRequest): Promise<PutSessionResponse> {
  const sessionId = body.session_id as string;
  linkPuts.push(`${activityId}>${sessionId}`);
  const mode = linkShaped ? undefined : lsw().link;
  linkShaped = true;
  return new Promise((resolve, reject) => setTimeout(() => {
    try {
      const d = data();
      const a = findActivity(activityId);
      if (!a) throw new ApiError(404, "activity not found");
      if (mode === "fail") throw new Error("network");
      if (mode === "503") throw new ApiError(503, "service unavailable");
      if (mode === "gone") {
        d.sessions.splice(d.sessions.findIndex((x) => x.id === sessionId), 1);
        throw new ApiError(404, "session not found");
      }
      if (mode === "taken") {
        const s = d.sessions.find((x) => x.id === sessionId);
        const other: ApiActivity = { ...a, id: "u-link-taker", strava_activity_id: "900999", session_id: sessionId, match_status: "confirmed", start_time: new Date(`${s?.scheduled_date ?? todayJst()}T07:30:00+09:00`).toISOString(), review: null, splits: null };
        d.activities.push(other);
        seedDetails(other);
        throw new ApiError(409, "session already confirmed for another activity");
      }
      const done = putSessionNow(activityId, body);
      if (mode === "lost") throw new Error("network");
      resolve(done);
    } catch (e) {
      reject(e);
    }
  }, lsw().linkDelay ?? 350));
}

export function mockPutSession(activityId: string, body: PutSessionRequest): PutSessionResponse | Promise<PutSessionResponse> {
  return body.session_id && !body.append && !body.replace ? linkPut(activityId, body) : putSessionNow(activityId, body);
}

export function mockActivities(status?: MatchStatus): ActivitiesResponse {
  if (dsw().noRuns) return { activities: [] }; // ai-plan-generation: the intake's second step with nothing to show
  refreshSegments();
  const all = [...data().activities, ...data().unassigned].sort((a, b) => b.start_time.localeCompare(a.start_time));
  return { activities: status ? all.filter((a) => a.match_status === status) : all };
}

/** Demo mode: the coach answers again after ~4 s. */
export function mockRereview(activityId: string): RereviewResponse {
  const asked = findActivity(activityId);
  if (!asked) throw new Error("not found");
  if (reviewLimited()) throw new ApiError(429, "review daily limit reached"); // the review is left as it is
  const a = (asked.session_id ? groupOfSession(asked.session_id)[0] : null) ?? asked; // on a recording of a group it acts on the primary one: the review is the session's
  a.review = null;
  setTimeout(() => {
    a.review = { verdict: "達成但有提醒", comment: "（示範）重新分析：配速在區間內，但第 3 km 心拍衝到 166。", reminders: ["MP 第 3 公里開始看心拍"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString(), corrected_at: null };
    // the worker posts the new verdict in the thread too, and the earlier ones of this session are replaced
    const t = threadData();
    const s = data().sessions.find((x) => x.id === a.session_id) ?? null;
    supersedeEarlier(a);
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "review", text: a.review.comment ?? "", activity_id: a.id, review: { label: s ? shortName(s) : "未排課", verdict: "達成但有提醒", reminder: a.review.reminders[0] ?? null, date: s?.scheduled_date ?? todayJst(), updated: null, superseded: false }, created_at: new Date().toISOString() });
  }, 4000);
  return { queued: true };
}

// Demo weekly reviews: week 2 with two proposals (pending) against next week's sessions,
// and week 3 written before the 10/25 long run had a record — it asks instead of judging
// (the question itself is the ask's `question`; the text only says what Woo can see).
let weekly: ApiWeeklyReview[] | undefined;
const WEEK2_ID = "w-2026-10-12";
const WEEK3_ID = "w-2026-10-19";
const WEEK4_ID = "w-2026-10-26";
const WEEK1_ID = "w-2026-10-05";
const WEEK3_TEXT_ASK = "本週 4 堂跑步完成 3 堂：10/20 Easy 6.03 km（7:11、心拍 143）、10/21 坡跑、10/23 Easy 6.14 km（7:08、心拍 142），兩次 Easy 都比 7:15 快 4〜7 秒，心拍在範圍內。10/25 的長跑確定之後我再談 11/1 的 18 km。";
const WEEK3_TEXT_SKIPPED = "本週 4 堂跑步完成 3 堂：10/20 Easy 6.03 km（7:11、心拍 143）、10/21 坡跑、10/23 Easy 6.14 km（7:08、心拍 142）。10/25 的長跑你說沒跑，這週長跑量是 0，所以 11/1 的 18 km 不直接上：先回到 16 km，最後 4 km @ 6:45 看當天小腿狀況。兩次 Easy 都比 7:15 快 4〜7 秒，下週 Easy 以 7:15 為下限。";
// coach-format (md.ts) samples. The explanation is the real question from Wei: a conclusion, three reasons as a list, two bold spans, a next step.
const MD_EXPLAIN = "心拍還看不出進步，主要是時間還不夠，不是你練錯。\n\n- **才練 3 週**：有氧底子通常要 6〜8 週，同配速的心拍才會開始往下掉。\n- 前 2 km 起跑偏快：10/20、10/23 都比後段快 10 秒以上，心拍一開頭就被拉上 150。\n- 疲勞和睡眠：10/24 走了 95 分鐘、這週兩晚睡不到 6 小時，心拍整體會高 3〜5 下。\n\n下週 Easy 配速固定 **7:20**，前 2 km 也一樣，3 週後用同一條路再比一次。";
// every syntax that is printed as the characters themselves (T7)
const MD_NOT_RENDERED = "# 標題\n![圖](https://example.com/y.png)\n[連結](https://example.com)\n<b>粗</b>\n| a | b |\n```js\nx\n```\n> 引用\n*斜體* 與 _底線_";
// 2000 characters, 45 list items, one unpaired ** in the middle (T12)
const MD_LONG = ["結論先講：這 45 點都是同一件事，慢慢來。", "", ...Array.from({ length: 45 }, (_, i) => `- 第 ${i + 1} 點：前 2 km 配速守在 7:20 以上，心拍別超過 150，${i === 22 ? "**這一點的粗體沒有結尾，" : ""}再放慢。`)].join("\n").slice(0, 2000);
// replies to what the runner types in the mock
const MD_REPLY_WHY = MD_EXPLAIN;
const MD_REPLY_SHORT = "明天 11/1 週日是長跑 18 km：前 14 km 7:20〜7:40，最後 4 km 6:45。";
const MD_REPLY_SYNTAX = "這裡只能用段落和清單，標題、表格、連結和圖片都排不出來，我直接用文字講。你想看哪一週的課表，告訴我日期，我一堂一堂列給你。";
function weeklyData(): ApiWeeklyReview[] {
  if (weekly) return weekly;
  const d = data();
  const long = d.sessions.find((s) => s.scheduled_date === "2026-10-18");
  const rec = d.sessions.find((s) => s.scheduled_date === "2026-10-16");
  // newest first, like the api's `week_start desc`
  weekly = [{
    id: WEEK4_ID,
    week_start: "2026-10-26",
    // weekly-review-entry: week 4, markdown (a 3-item list, one bold); its card is p-w4 (pending), on the message c-weekly-4
    summary: "第 4 週 4 堂全部完成，進度剛好。\n\n- 10/27 Easy 5.02 km（7:20、心拍 146）\n- 10/28 坡跑 5 趟，每趟都在 6:00 內\n- 11/1 長跑 18.1 km（7:28、心拍 151）\n\n長跑後段心拍到 **158**，前半可以再慢一點；下週 11/12 的 Recovery 先少 1 km。",
    model: null,
    adjustments: [],
    created_at: new Date("2026-11-02T04:00:00+09:00").toISOString(),
    updated_at: null,
    update_reason: null,
  }, {
    id: WEEK2_ID,
    week_start: "2026-10-12",
    // markdown (coach-format 3.6, T16 shape: conclusion, a 3-item list, a closing paragraph with one bold); week 3 below stays plain text on purpose
    summary: "（示範）第 2 週完成 3/4。\n\n- Easy 心拍守得比第 1 週好（150→140）\n- 10/14 MP 段配速到位，但第 5 km 心拍 166 超過上限\n- 體感也說第三公里開始腿重\n\n長跑前一天排 Hyrox，建議把**長跑目標心拍**再壓低一點。",
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
  weekly.push({
    id: WEEK1_ID,
    week_start: "2026-10-05",
    // weekly-review-entry: the first review (the plan's week 1 starts 10/8, inside its 7 days); its card p-w1 was applied
    summary: "第 1 週 3 堂都跑完了，Easy 的心拍都在範圍內。10/11 的長跑 12 km 比預定輕鬆，下週照原計畫。",
    model: null,
    adjustments: [],
    created_at: new Date("2026-10-12T04:00:00+09:00").toISOString(),
    updated_at: null,
    update_reason: null,
  });
  weekly.sort((a, b) => b.week_start.localeCompare(a.week_start));
  return weekly;
}
export function mockWeekly(): WeeklyResponse | Promise<WeeklyResponse> {
  weeklyCalls.push(Date.now());
  const delay = knobs().__mockWeeklyDelay; // weekly-review-entry: `window.__mockWeeklyDelay = ms` slows GET /weekly (the entries come in late)
  if (delay) return new Promise((resolve) => setTimeout(() => resolve(weeklyAnswer()), delay));
  return weeklyAnswer();
}
function weeklyAnswer(): WeeklyResponse {
  if (knobs().__mockNoWeekly) return { reviews: [] }; // weekly-review-entry: no review at all (no entry on 課表 or 今天)
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
const todayAtS = (hms: string) => new Date(`${TODAY}T${hms}+09:00`).toISOString();
const constraints: ApiConstraint[] = [
  { id: "k-mon", text: "週一固定休息，不排課", start_date: null, end_date: null, kind: "fixed_day", weekday: 1, source_message_id: null, status: "active", created_at: at("2026-10-05T10:00:00+09:00") },
  { id: "k-trip", text: "11/3〜4 出差", start_date: "2026-11-03", end_date: "2026-11-04", kind: "period", weekday: null, source_message_id: null, status: "active", created_at: at("2026-10-09T21:30:00+09:00") },
  { id: "k-ankle", text: "左腳踝輕傷", start_date: "2026-10-01", end_date: "2026-10-10", kind: "period", weekday: null, source_message_id: null, status: "active", created_at: at("2026-10-02T08:00:00+09:00") },
  { id: "k-abroad", text: "11/21〜23 出國", start_date: "2026-11-21", end_date: "2026-11-23", kind: "period", weekday: null, source_message_id: "c-rp-a1", status: "proposed", created_at: todayAt("06:31") },
  { id: "k-abroad-ab", text: "11/21〜23 出國", start_date: "2026-11-21", end_date: "2026-11-23", kind: "period", weekday: null, source_message_id: "c-rp-a3", status: "proposed", created_at: todayAt("06:41") },
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
  ({ session_id: null, old: null, new: null, reason: null, flags: [], applied_session_id: null, makeup: false, counts_in_week_no: null, correction: false, ...o });

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
  chg({ op: "change", session_id: "s-2026-11-27", field: "target_pace_sec_km", old: 450, new: 465, label: "Easy 5 km", date: "2026-11-27" }),
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
  // weekly-review-entry: the cards of two weekly reviews (source weekly, on the review's own message). Week 4's is pending (11/12 Recovery 5 → 4 km, narrow card);
  // week 1's was applied a week later (a note on 10/14 MP that the plan already carries, so no plan row changes)
  card({ id: "p-w4", message_id: "c-weekly-4", source: "weekly",
    // `window.__mockWeeklyWide = true`: the card also changes 11/19 (week 7), so it is the full-width kind (採用整張, 不用, 在課表上看 ›)
    changes: [chg({ op: "change", session_id: "s-2026-11-12", field: "target_distance_m", old: 5000, new: 4000, label: "Recovery 5 km", date: "2026-11-12" }),
      ...(knobs().__mockWeeklyWide ? [chg({ op: "change", session_id: "s-2026-11-19", field: "target_distance_m", old: 5000, new: 4000, label: "Recovery 5 km", date: "2026-11-19" })] : [])],
    why: "長跑後段心拍到 158，下週的 Recovery 先收一點。",
    basis: ["11/1 長跑後段心拍 158", "第 4 週 18.1 km"],
    basis_text: "目標 4:45。11/1 的長跑 18.1 km，後 6 km 心拍從 148 爬到 158；那堂之後第 5 週有 38 km。原則：長跑後的第一週，恢復跑先減量，不動關卡課。",
    impact: {
      keep: "11/12 照 5 km 跑，長跑後腿還沒鬆就接 MP 隔天的恢復，容易累積。",
      change: "11/12 改 4 km，其他不動；第 6 週少 1 km。",
      risk: "沒有。11/12 腿狀況好就照原計畫跑，跟我說一聲。",
    } }),
  card({ id: "p-w1", message_id: "c-weekly-1", source: "weekly", status: "applied", decided_at: at("2026-10-12T09:30:00+09:00"),
    changes: [chg({ op: "change", session_id: "s-2026-10-14", field: "note", old: null, new: "MP 段心拍不要超過 165", label: "MP 7 km", date: "2026-10-14", applied_session_id: "s-2026-10-14" })],
    why: "第 1 週 Easy 的心拍都守住了，MP 課把心拍上限寫進備註。",
    basis: ["第 1 週 Easy 心拍 140〜150", "10/11 長跑 12 km"],
    basis_text: "目標 4:45。第 1 週三堂跑步心拍都在範圍內，10/11 長跑 12 km 比預定輕鬆。原則：進入 MP 課之前，先把心拍上限寫在備註。",
    impact: { keep: "備註沒有心拍上限，MP 段容易跑過頭。", change: "10/14 MP 的備註寫上心拍不超過 165。", risk: "沒有。" } }),
  // 409: the plan changed under it
  card({ id: "p-stale", message_id: "c-rp-c2", status: "stale", stale_reason: "11/29 長跑 20 km 在 10/27 被週回顧改過（現在是 18 km）",
    changes: [
      chg({ op: "change", session_id: "s-2026-11-27", field: "target_pace_sec_km", old: 450, new: 465, label: "Easy 5 km", date: "2026-11-27" }),
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
      chg({ op: "change", session_id: "s-2026-11-18", field: "type", old: "interval", new: "easy", label: "坡跑+MP 10 km", date: "2026-11-18", reason: "26 km 前兩天不排坡。" }),
      chg({ op: "change", session_id: "s-2026-11-18", field: "target_distance_m", old: 10000, new: 6000, label: "坡跑+MP 10 km", date: "2026-11-18" }),
      chg({ op: "add", label: "休息", date: "2026-11-22", new_session: { scheduled_date: "2026-11-22", type: "rest", label: "休息", target_distance_m: 0, target_pace_sec_km: null, note: "出國" }, reason: "你 11/21〜23 不在。" }),
    ],
    weeks: [{ week_no: 7, phase: null, focus: "★ 峰值 26 km（11/20 週五），出國前跑完" }],
    basis: BASIS, basis_text: BASIS_TEXT,
    impact: {
      keep: "同上：關卡 2 測不到，比賽配速只能用 7:00。",
      change: "關卡 2 用 26 km 的最後 6 km 估，比賽配速最多押到 6:50；第 8 週照原本減量 42 km，taper 不受影響。",
      risk: "26 km 跑完兩天就上飛機，坐久腿會腫；回來 11/24 的恢復跑改走路也行。",
    } }),
  // ---- coach-adjust-2 補課 (today = the demo's 10/28 Wed; week 3's review is written, week 4's is not) ----
  // Yesterday's Easy 7 km (10/27) was missed: makeup to Thursday, the 肌力 day makes room and its core work moves into the note. Week 4 has no review yet → counts in week 4.
  card({ id: "p-mk-this", message_id: "c-mk-a1",
    changes: [
      chg({ op: "change", session_id: "s-2026-10-27", field: "scheduled_date", old: "2026-10-27", new: "2026-10-29", label: "Easy 7 km", date: "2026-10-27", makeup: true, reason: "昨天漏的 Easy 補到週四，今天 MP 之後隔一天再跑。" }),
      chg({ op: "change", session_id: "s-2026-10-27", field: "note", old: null, new: "跑完做核心＋臀腿 15 分", label: "Easy 7 km", date: "2026-10-27" }),
      chg({ op: "remove", session_id: "s-2026-10-29", label: "肌力日", date: "2026-10-29", reason: "週四改跑 Easy，肌力併到這堂的備註。" }),
    ],
    why: "Easy 7 km 補到週四，肌力併進去，這週的量不掉。",
    basis: ["目標 4:45", "本週已跑 0 / 34 km", "10/27 Easy 7 km 漏跑"],
    basis_text: "目標 4:45（6:45/km）。本週 34 km，10/27 的 Easy 7 km 沒跑，今天 10/28 是 MP 9 km，週五有坡跑。原則：硬課前後 48 小時不疊另一堂硬課，Easy 補在兩個硬日中間剛好；肌力日不另外佔一天。",
    impact: {
      keep: "10/27 的 Easy 7 km 算沒跑，本週只剩 27 km（34 → 27），11/1 長跑 18 km 前的量少一截。",
      change: "Easy 7 km 補到 10/29 週四。第 4 週的週報還沒出，這堂算在本週：本週維持 34 km，跑完就算這週的那堂。",
      risk: "週四腿還重就把 Easy 縮成 5 km，週五的坡跑照排；週報出來前改成算在下週也行，跟我說。",
    } }),
  // Week 3's review is written, so a make-up counts in the week it is run. A／B for the missed 10/25 long run (its question in week 3's review is still open).
  card({ id: "p-mk-a", message_id: "c-mk-a2", group_id: "g-mk", option: { letter: "A", title: "補：併進 11/1 的長跑", recommended: true },
    changes: [
      chg({ op: "change", session_id: "s-2026-10-25", field: "scheduled_date", old: "2026-10-25", new: "2026-11-01", label: "Long 16 km", date: "2026-10-25", makeup: true, reason: "11/1 本來就是長跑，補課那堂取代它，不疊兩堂。", flags: ["離 11/8 的 22 km 剛好 7 天"] }),
      chg({ op: "change", session_id: "s-2026-10-25", field: "target_distance_m", old: 16000, new: 18000, label: "Long 16 km", date: "2026-10-25" }),
      chg({ op: "change", session_id: "s-2026-10-25", field: "note", old: "找有起伏的路線（駒沢、代代木）", new: "每 40 分 1 包能量膠＋水，測試腸胃；穿比賽衣褲", label: "Long 16 km", date: "2026-10-25" }),
      chg({ op: "remove", session_id: "s-2026-11-01", label: "Long 18 km", date: "2026-11-01", reason: "補課那堂已經是 18 km，原本這堂刪掉。" }),
    ],
    basis: ["目標 4:45", "最長 12 km（10/11）", "長跑間隔 7 天"], basis_text: "目標 4:45。目前最長 12 km（10/11），10/25 的 16 km 沒跑。原則：長跑每次最多比上一次多 2〜4 km，之間隔至少 7 天；補長跑不另外開一天，併進下一次長跑。",
    impact: {
      keep: "10/25 的 16 km 算沒跑，第 3 週剩 20 km；11/1 的 18 km 之前最長只有 12 km，一次跳 6 km。",
      change: "10/25 的長跑併進 11/1 的 18 km。第 3 週的週報已經出了，補課算在補跑那週：這堂算在第 4 週，第 4 週維持 34 km；第 3 週維持沒跑。",
      risk: "11/1 當天腿重就停在 16 km，不補最後 2 km；補給照 11/1 的備註試。",
    } }),
  card({ id: "p-mk-b", message_id: "c-mk-a3", group_id: "g-mk", option: { letter: "B", title: "不補：11/1 前段放慢", recommended: false },
    changes: [
      chg({ op: "change", session_id: "s-2026-11-01", field: "note", old: "每 40 分 1 包能量膠＋水，測試腸胃；穿比賽衣褲", new: "前 16 km 7:30 以後，最後 2 km 看腿；每 40 分 1 包能量膠＋水", label: "Long 18 km", date: "2026-11-01", reason: "10/25 沒跑，最長還是 12 km，前段放慢把最後 2 km 留給腿。" }),
    ],
    basis: ["目標 4:45", "最長 12 km（10/11）"], basis_text: "目標 4:45。目前最長 12 km，10/25 的 16 km 沒跑，11/1 的 18 km 之間沒有 16 km 的前置。原則：不補時把下一次長跑的前段放慢，把量留給最後。",
    impact: {
      keep: "同上：11/1 直接 18 km，之前最長只有 12 km。",
      change: "不補。10/25 維持沒跑（第 3 週 2/3 堂不動），11/1 的 18 km 前 16 km 放慢到 7:30 以後。",
      risk: "最長 12 km 直接上 18 km，跑到一半痠痛就走完剩下的，關卡 1 的 26 km 往後一週。",
    } }),
  // Yesterday evening, after the 10/27 the card moves to had passed by the time it was pressed (409 → 課表已變).
  card({ id: "p-mk-stale", message_id: "c-mk-b2", status: "stale", stale_reason: "10/23 Easy 6 km 要移到的 10/27 已經過了",
    changes: [
      chg({ op: "change", session_id: "s-2026-10-23", field: "scheduled_date", old: "2026-10-23", new: "2026-10-27", label: "Easy 6 km", date: "2026-10-23", makeup: true, reason: "10/23 漏的 Easy 補到明天。" }),
      chg({ op: "remove", session_id: "s-2026-10-27", label: "Easy 7 km", date: "2026-10-27", reason: "補課那堂取代它。" }),
    ],
    basis: ["目標 4:45", "10/23 Easy 6 km 漏跑"], basis_text: "目標 4:45。10/23 的 Easy 6 km 沒跑，明天 10/27 有 Easy 7 km，併成一堂。原則：Easy 漏了通常不補，要補就併進另一堂 Easy。",
    impact: { keep: "10/23 的 Easy 6 km 算沒跑，第 3 週 3/4 堂。", change: "補到 10/27，取代那天的 Easy 7 km。第 3 週的週報已經出了，這堂算在第 4 週。", risk: "10/27 腿還重就照原本的 7 km 跑，不補。" } }),
  // Today's session moved away (no new row there): 今天沒有排課.
  card({ id: "p-today-move", message_id: "c-mk-a5",
    changes: [
      chg({ op: "change", session_id: "s-2026-10-28", field: "scheduled_date", old: "2026-10-28", new: "2026-10-31", label: "MP 9 km", date: "2026-10-28", flags: ["隔天 11/1 是 18 km 長跑"] }),
      chg({ op: "change", session_id: "s-2026-10-28", field: "target_distance_m", old: 9000, new: 7000, label: "MP 9 km", date: "2026-10-28", reason: "長跑前一天，MP 縮成 7 km。" }),
      chg({ op: "remove", session_id: "s-2026-10-31", label: "休息", date: "2026-10-31", reason: "這天改跑 MP。" }),
    ],
    basis: ["目標 4:45", "本週已跑 0 / 34 km", "11/1 長跑 18 km"], basis_text: "目標 4:45。今天 MP 9 km 你跑不了，週六本來休息。原則：MP 不能直接丟掉，移到長跑前一天要縮量。",
    impact: { keep: "今天的 MP 算沒跑，本週少 9 km，MP 這週測不到。", change: "MP 移到 10/31 週六、縮成 7 km，今天沒有排課；本週 34 → 32 km。", risk: "週六腿重就改 Easy 5 km，11/1 的長跑不受影響。" } }),
  // Today's session, shorter (a narrow card, one change)
  card({ id: "p-today-short", message_id: "c-mk-a4",
    changes: [chg({ op: "change", session_id: "s-2026-10-28", field: "target_distance_m", old: 9000, new: 7000, label: "MP 9 km", date: "2026-10-28", reason: "腿痠，MP 段縮短。" })],
    why: "腿痠就把今天的 MP 縮短，心拍壓住比距離重要。",
    basis: ["目標 4:45", "昨天沒跑"], basis_text: "目標 4:45。今天 MP 9 km，你說腿痠。原則：腿痠時保留強度、縮量。",
    impact: { keep: "9 km 照跑，腿痠時 MP 段心拍容易衝過 165。", change: "今天 MP 7 km，本週 34 → 32 km。", risk: "跑到一半還是痠就停在熱身後的第一段 MP。" } }),
  // An A／B reply where one card failed the api's check and the other was kept: a single card, and proposal_rejected is true (the grey line and the card show together)
  card({ id: "p-kept", message_id: "c-mk-k2",
    changes: [chg({ op: "change", session_id: "s-2026-11-13", field: "target_distance_m", old: 6000, new: 5000, label: "Easy 6 km", date: "2026-11-13", reason: "11/15 長跑前一天少一點。" })],
    why: "長跑前兩天的 Easy 縮短 1 km。",
    basis: ["目標 4:45", "11/15 長跑 26 km"], basis_text: "目標 4:45。11/15 是 26 km 的關卡 1，前兩天的 Easy 不用多。",
    impact: { keep: "11/13 照 6 km 跑，量沒問題。", change: "11/13 縮成 5 km，第 6 週 55 → 54 km。", risk: "腿沒感覺就照原本的 6 km。" } }),
  // Moves a missed session onto a day that already has one and does not deal with it: apply → 400 (an old card from before the check existed)
  card({ id: "p-mk-two", message_id: "c-mk-a7",
    changes: [chg({ op: "change", session_id: "s-2026-10-14", field: "scheduled_date", old: "2026-10-14", new: "2026-10-30", label: "MP 7 km", date: "2026-10-14", makeup: true, reason: "10/14 漏的 MP 補到週五。" })],
    basis: ["目標 4:45", "10/14 MP 漏跑"], basis_text: "目標 4:45。10/14 的 MP 7 km 沒跑。",
    impact: { keep: "10/14 的 MP 算沒跑。", change: "補到 10/30 週五。", risk: "週五本來有坡跑，兩堂疊在一起。" } }),
];

/** What Woo says after 採用 (the api writes it; the demo has a few by hand). */
const CONFIRM: Record<string, () => string> = {
  "p-replan": () => `改好了。第 7 週變出國前收尾，11/25 週三 32 km、11/29 16 km。${constraints.find((c) => c.id === "k-abroad")?.status === "active" ? "11/21〜23 出國我記著了，設定頁看得到。" : ""}`.trim(),
  "p-ab-a": () => "改好了。11/25 週三 32 km，前一天的恢復跑別偷快。出國那三天走路算活動，不用找我報到。",
  "p-ab-b": () => "改好了。11/20 週五 26 km 跑完再走，出國那三天走路就好；回來 11/24 的恢復跑看腿再決定。",
  "p-restale": () => "改好了。11/27 的 Easy 放慢，11/29 的長跑 18 → 16 km。",
  "p-mk-this": () => "改好了。10/27 的 Easy 7 km 補到 10/29，算在第 4 週。肌力併進那堂的備註。",
  "p-mk-a": () => "改好了。10/25 的 Long 16 km 併進 11/1 的 18 km，算在第 4 週。",
  "p-mk-b": () => "改好了。10/25 不補，11/1 的 18 km 前 16 km 放慢到 7:30 以後。",
  "p-mk-restale": () => "改好了。10/23 的 Easy 6 km 補到 10/29，算在第 4 週。",
  "p-today-move": () => "改好了。今天沒有排課，MP 移到 10/31 週六、縮成 7 km。",
};

/** Why applying would be a 409: a session of the card moved, vanished, got a record, or no longer has the value the card started from. */
function planConflict(p: ApiProposal): string | null {
  const d = data();
  for (const c of p.changes) {
    if (c.op === "add" || !c.session_id) continue;
    const s = d.sessions.find((x) => x.id === c.session_id);
    const what = `${c.date ? md(c.date) : ""} ${c.label ?? "那堂"}`.trim();
    if (!s || (c.date && s.scheduled_date !== c.date)) return `${what} 在你按之前被別的提案改過`;
    if (c.field === "scheduled_date" && typeof c.new === "string" && c.new < TODAY) return `${what} 要移到的 ${md(c.new)} 已經過了`;
    // a correction is the one card that is for a completed session: it is stale when the session is not completed any more
    const completed = [...d.activities, ...d.unassigned].some((a) => a.session_id === s.id);
    if (c.correction ? !completed : completed) return c.correction ? `${what} 已不是已完成的課` : `${what} 已完成`;
    if (c.op === "change" && c.field && c.field !== "scheduled_date" && typeof c.old === "number" && (s as unknown as Record<string, unknown>)[c.field] !== c.old) return `${what} 在你按之前被別的提案改過`;
  }
  return null;
}

/** Two sessions on one day after the card (the api answers 400): only the days the card moves something onto are looked at. */
function doubleBooked(p: ApiProposal): string | null {
  const d = data();
  const gone = new Set(p.changes.filter((c) => c.op === "remove" && c.session_id).map((c) => c.session_id as string));
  const date = new Map(d.sessions.filter((x) => !x.moved_to_date && !gone.has(x.id)).map((x) => [x.id, x.scheduled_date]));
  const touched = new Set<string>();
  const added: string[] = [];
  for (const c of p.changes) {
    if (c.op === "add" && c.new_session) { added.push(c.new_session.scheduled_date); touched.add(c.new_session.scheduled_date); }
    if (c.op === "change" && c.field === "scheduled_date" && c.session_id && typeof c.new === "string") { date.set(c.session_id, c.new); touched.add(c.new); }
  }
  for (const day of touched) if ([...date.values(), ...added].filter((x) => x === day).length > 1) return day;
  return null;
}

/** Write a card's changes into the demo plan (the api does this in one transaction); returns the bits Woo's confirmation names. */
function applyToPlan(p: ApiProposal): string[] {
  const d = data();
  const parts: string[] = [];
  const weekOf = (date: string) => d.weeks.find((w) => date >= w.week_start && date <= w.week_end)?.week_no ?? null;
  const reviewed = new Set(weeklyData().map((w) => weekOf(w.week_start)).filter((n): n is number => n != null));
  const landed = new Map<string, ApiSession>(); // 補課: later changes of the card to that session land on its new row
  // a make-up row that is skipped or removed puts the original day back as a plain skipped session
  const putBack = (row: ApiSession) => {
    const origin = d.sessions.find((x) => x.id === row.moved_from_session_id);
    if (!origin) return;
    origin.superseded = false; origin.moved_to_session_id = null; origin.moved_to_date = null; origin.counts_in_week_no = origin.week_no;
    row.moved_from_session_id = null; row.moved_from_date = null; row.counts_in_week_no = row.week_no;
  };
  // removals first, so a session that moves onto the freed day does not meet the old one
  for (const c of p.changes) {
    if (c.op !== "remove" || !c.session_id) continue;
    const gone = d.sessions.find((x) => x.id === c.session_id);
    if (gone?.moved_from_session_id) putBack(gone);
    d.sessions = d.sessions.filter((x) => x.id !== c.session_id);
  }
  for (const c of p.changes) {
    if (c.op !== "change" || !c.session_id) continue;
    const old = d.sessions.find((x) => x.id === c.session_id);
    if (old && c.makeup && c.field === "scheduled_date" && typeof c.new === "string" && !landed.has(old.id)) {
      const row = makeUpSession(d.sessions, d.weeks, old, c.new, reviewed);
      landed.set(old.id, row);
      c.applied_session_id = row.id;
      c.counts_in_week_no = row.counts_in_week_no;
      parts.push(`${md(old.scheduled_date)} 的 ${c.label ?? old.label} 補到 ${md(c.new)}，算在第 ${row.counts_in_week_no} 週`);
      continue;
    }
    const s = landed.get(c.session_id) ?? old;
    if (!s) continue;
    if (c.field === "skip") {
      if (s.moved_from_session_id) putBack(s); s.type = "rest"; s.label = "休息"; s.content = "休息"; s.target_distance_m = 0; s.target = null; s.note = null; parts.push(`${md(c.date ?? s.scheduled_date)} 改成休息`); }
    else if (c.field === "type") {
      // the api's enum: the session becomes that kind (label and content follow; distance is its own change)
      const t = String(c.new) as ApiSession["type"];
      s.type = t; s.label = typeLabel(t); s.content = null; s.target = t === "easy" ? "7:15〜7:45 / 心拍 140〜150" : null;
      parts.push(`${md(c.date ?? s.scheduled_date)} 改成 ${typeName(t)}`);
    } else if (c.field === "target_pace_sec_km" && typeof c.new === "number") {
      const by = c.new - (s.target_pace_sec_km ?? c.new);
      s.target = [pace(c.new), ...(s.target?.split(" / ").slice(1) ?? [])].join(" / ");
      if (s.target_pace_min_sec_km != null) s.target_pace_min_sec_km += by;
      if (s.target_pace_max_sec_km != null) s.target_pace_max_sec_km += by;
      s.target_pace_sec_km = c.new;
    } else if (c.field) {
      (s as unknown as Record<string, unknown>)[c.field] = c.new;
      if (c.field === "scheduled_date" && typeof c.new === "string") { s.week_no = weekOf(c.new); if (!s.moved_from_session_id) s.counts_in_week_no = s.week_no; }
      if (c.field === "target_distance_m" && typeof c.new === "number" && !c.correction) s.content = s.content?.replace(/\d+(?:〜\d+)?\s*km/, `${kmPlan(c.new)} km`) ?? s.content;
      if (!c.correction) parts.push(c.field === "scheduled_date" && typeof c.new === "string" ? `${mdDow(c.new)}是 ${c.label ?? s.label}`
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
      target_hr_min: null, target_hr_max: null, brief: null, skipped_at: null, version: 1, superseded: false,
      moved_to_session_id: null, moved_to_date: null, moved_from_session_id: null, moved_from_date: null, counts_in_week_no: weekOf(n.scheduled_date) });
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
const BLANK = { activity_id: null, weekly_review_id: null, status: "sent" as const, review: null, quote: null, rpe: null, checkin: null, ask: null, weekly: null, proposal: null, constraint: null, proposal_rejected: false, stage: null, correction: null, error: null };

/** Walk a pending message through Woo's stages on timers (in production the worker writes them), then run `done`. `window.__mockNoReply = true` never finishes. */
function walkStages(m: ApiCoachMessage, steps: [string, number][], doneAt: number, done: () => void) {
  m.stage = steps[0][0];
  for (const [st, at] of steps.slice(1)) setTimeout(() => { if (m.stage) m.stage = st; }, at);
  setTimeout(() => { if (knobs().__mockNoReply) return; m.stage = null; done(); }, doneAt);
}
function threadData(): ApiCoachMessage[] {
  if (thread) return thread;
  const w = weeklyData().find((x) => x.id === WEEK2_ID)!;
  const w3 = weeklyData().find((x) => x.id === WEEK3_ID)!;
  const w4 = weeklyData().find((x) => x.id === WEEK4_ID)!;
  const w1 = weeklyData().find((x) => x.id === WEEK1_ID)!;
  const today = todayJst();
  const yAt = (hm: string) => new Date(`${addDays(today, -1)}T${hm}:00+09:00`).toISOString();
  for (const p of proposals) p.created_at = p.id === "p-w4" ? w4.created_at : p.id === "p-w1" ? w1.created_at : p.id === "p-applied" ? yAt("21:01") : p.id === "p-stale" ? yAt("22:11") : p.id === "p-mk-stale" ? yAt("22:31") : todayAt("06:21");
  thread = [
    // weekly-review-entry: the messages of weeks 1 and 4 (their cards p-w1, p-w4 ride on them)
    { ...BLANK, id: "c-weekly-1", role: "coach", kind: "weekly", text: w1.summary ?? "", weekly_review_id: w1.id, proposal: proposals.find((x) => x.id === "p-w1") ?? null, created_at: w1.created_at,
      weekly: { week_start: w1.week_start, asks: [], updated: null, cancelled: [], makeups: [] } },
    { ...BLANK, id: "c-weekly-4", role: "coach", kind: "weekly", text: w4.summary ?? "", weekly_review_id: w4.id, proposal: proposals.find((x) => x.id === "p-w4") ?? null, created_at: w4.created_at,
      weekly: { week_start: w4.week_start, asks: [], updated: null, cancelled: [], makeups: [] } },
    { id: "c1", role: "coach", kind: "weekly", text: w.summary ?? "", activity_id: null, weekly_review_id: w.id, status: "sent", review: null, quote: null, error: null, created_at: at("2026-10-12T12:00:00Z"),
      // 10/16 Recovery was moved to 10/30 before this review was written: it counts in this week and the review says so
      weekly: { week_start: w.week_start, asks: [], updated: null, cancelled: [], makeups: [{ from: "2026-10-16", to: "2026-10-30", label: "Recovery 4 km", done: false }] } },
    { id: "c2", role: "coach", kind: "review", text: "心拍整段壓在 140，是四次 Easy 裡最穩的一次。第 1 km 6:35 偏快是錶的心拍延遲，不是真的用力；第 6 km 8:01 是坡後自然放慢，正常。", activity_id: "a-2026-10-13", weekly_review_id: null, status: "sent", review: { label: "Easy 6 km", verdict: "達成", reminder: "第 1 km 前 3 分鐘用呼吸不用錶", date: "2026-10-13", updated: null, superseded: false }, quote: null, error: null, created_at: at("2026-10-12T22:52:00Z") },
    { id: "c3", role: "athlete", kind: "chat", text: "第一公里又衝太快了，有什麼辦法壓住？", activity_id: "a-2026-10-13", weekly_review_id: null, status: "sent", review: null, quote: "10/13 Easy 6.01 km · 7:25/km · 心拍 140（最高 148） · 達成", error: null, created_at: at("2026-10-12T23:10:00Z") },
    { id: "c4", role: "coach", kind: "chat", text: "這是連續第二次了。前 3 分鐘不要看錶，用鼻子呼吸能撐住的速度就是對的；第 1 km 跑到 7:30 以上才算成功。明天 MP 課的前 2 km Easy 也照這個來。", activity_id: null, weekly_review_id: null, status: "sent", review: null, quote: null, error: null, created_at: at("2026-10-12T23:10:20Z") },
    // coach-format samples (md.ts): an explanation with a list and bold (T4+T6), syntax that is not rendered (T7), an old plain text with a single line break (T2), and a long one (T12)
    { ...BLANK, id: "c-md-1", role: "coach", kind: "chat", text: MD_EXPLAIN, created_at: at("2026-10-12T23:11:00Z") },
    { ...BLANK, id: "c-md-2", role: "coach", kind: "chat", text: MD_NOT_RENDERED, created_at: at("2026-10-12T23:12:00Z") },
    { ...BLANK, id: "c-md-3", role: "coach", kind: "chat", text: "這是連續第二次了。\n前 3 分鐘不要看錶，跟著呼吸跑。", created_at: at("2026-10-12T23:13:00Z") },
    { ...BLANK, id: "c-md-4", role: "coach", kind: "chat", text: MD_LONG, created_at: at("2026-10-12T23:14:00Z") },
    // Yesterday: a multi-week card already applied (and Woo's confirmation), and one that went stale (409).
    { ...BLANK, id: "c-rp-b1", role: "athlete", kind: "chat", text: "小腿還痠，11/8 的長跑想退一點", created_at: yAt("21:00") },
    { ...BLANK, id: "c-rp-b2", role: "coach", kind: "chat", text: "22 km 退到 20 km，最後 5 km 照測關卡 1。11/6 和 11/10 各少 1 km，讓腿先恢復；第 5 週的描述跟著改。整張一起看：", proposal: proposals.find((x) => x.id === "p-applied") ?? null, created_at: yAt("21:01") },
    { ...BLANK, id: "c-rp-b3", role: "coach", kind: "chat", text: "改好了。11/8 長跑 20 km，11/6 Easy 5 km、11/10 恢復跑 5 km。跑完 20 km 跟我說腿的狀況。", created_at: yAt("21:02") },
    { ...BLANK, id: "c-rp-c1", role: "athlete", kind: "chat", text: "11/27 的 Easy 放慢、11/29 縮短，這樣調", created_at: yAt("22:10") },
    { ...BLANK, id: "c-rp-c2", role: "coach", kind: "chat", text: "11/29 那堂在你按之前已經改過了（週一的回顧把它改成 18 km）。這張不能照用。", proposal: proposals.find((x) => x.id === "p-stale") ?? null, created_at: yAt("22:11") },
    // Week 3's review, written before the 10/25 long run had a record: it asks (demo dates it this morning).
    { ...BLANK, id: "c-weekly-3", role: "coach", kind: "weekly", text: w3.summary ?? "", weekly_review_id: w3.id, created_at: w3.created_at,
      weekly: { week_start: w3.week_start, asks: [{ session_id: "s-2026-10-25", label: "Long 16 km", date: "2026-10-25", question: "10/25 的 Long 16 km 我沒看到紀錄，是沒跑，還是還沒同步？", state: "open" }], updated: null, cancelled: [], makeups: [] } },
    // A chat reply that carries a proposal card (two changes), and a flagged one.
    { ...BLANK, id: "c-ask-sun", role: "athlete", kind: "chat", text: "這週日有事，長跑跑不了", created_at: todayAt("06:20") },
    { ...BLANK, id: "c-prop-1", role: "coach", kind: "chat", text: "那把長跑提到週六，週日換成休息。週五的 Easy 當長跑前的放鬆，別跑快。", proposal: proposals[0], created_at: todayAt("06:21") },
    { ...BLANK, id: "c-prop-2", role: "coach", kind: "chat", text: "另外，上週少跑了 20 km，這週補一點回來的話，長跑可以直接到 21。這個比較激進，你決定。", proposal: proposals[1], created_at: todayAt("06:21") },
    // 11/21〜23 abroad: one card + 記下來 (驗收 1), then the same question as an A／B pair sharing one 記下來, then constraints alone.
    { ...BLANK, id: "c-rp-q1", role: "athlete", kind: "chat", text: "11/21〜23 要出國，課表怎麼調？", created_at: todayAt("06:30") },
    { ...BLANK, id: "c-rp-a1", role: "coach", kind: "chat", text: "11/22 是 32 km 的峰值長跑，11/23 本來就是完全休息。32 km 是關卡 2 唯一一次測試，不縮、往後移到 11/25 週三；第 8 週因此從減量週變成峰值週，11/29 的 20 km 縮成 16 km 讓腿收回來。整張一起看：", proposal: proposals.find((x) => x.id === "p-replan") ?? null, constraint: constraints.find((x) => x.id === "k-abroad") ?? null, created_at: todayAt("06:31") },
    { ...BLANK, id: "c-rp-q2", role: "athlete", kind: "chat", text: "我 11/21〜23 出國，32 km 還跑得了嗎", created_at: todayAt("06:40") },
    { ...BLANK, id: "c-rp-a2", role: "coach", kind: "chat", text: "兩條路。A：32 km 後移到 11/25，關卡 2 照測，第 8 週變重。B：縮成 26 km 提前到 11/20 週五跑完再走，第 8 週照減量，但關卡 2 只能用 26 km 估。我偏 A；回程累不累你比我清楚。", proposal: proposals.find((x) => x.id === "p-ab-a") ?? null, created_at: todayAt("06:41") },
    { ...BLANK, id: "c-rp-a3", role: "coach", kind: "chat", text: "", proposal: proposals.find((x) => x.id === "p-ab-b") ?? null, constraint: constraints.find((x) => x.id === "k-abroad-ab") ?? null, created_at: todayAt("06:41") },
    { ...BLANK, id: "c-rp-q3", role: "athlete", kind: "chat", text: "左膝有點不舒服，到月底都會小心一點", created_at: todayAt("06:50") },
    { ...BLANK, id: "c-rp-a4", role: "coach", kind: "chat", text: "好。到 10/31 的課沒有坡跑和 MP，照跑，Easy 一律壓在 7:30 以後。跑完有腫、下樓梯會痛就跟我說，我再動課表。", constraint: constraints.find((x) => x.id === "k-knee") ?? null, created_at: todayAt("06:51") },
    { ...BLANK, id: "c-rp-q4", role: "athlete", kind: "chat", text: "週三晚上有課，肌力不能動", created_at: todayAt("06:52") },
    { ...BLANK, id: "c-rp-a5", role: "coach", kind: "chat", text: "知道了，週三的肌力不動；之後要調課我會避開它。", constraint: constraints.find((x) => x.id === "k-wed") ?? null, created_at: todayAt("06:53") },
    // A card that failed the api's check: only his text stays, plus the grey line.
    { ...BLANK, id: "c-rp-q5", role: "athlete", kind: "chat", text: "11/16 那週全部改成輕鬆跑好了", created_at: todayAt("06:58") },
    { ...BLANK, id: "c-rp-a6", role: "coach", kind: "chat", text: "11/16 那週有 11/18 的坡跑加 MP，是第三階段最重要的一堂，整週改輕鬆跑我不建議；要動的話跟我說是哪幾天不方便。", proposal_rejected: true, created_at: todayAt("06:59") },
    // coach-adjust-2 (older than the replan messages below, so the first page of the thread is what it was before): yesterday's card that went stale (the day it moved to was over by the time it was pressed), then today's 補課 and today's-session cards.
    { ...BLANK, id: "c-mk-b1", role: "athlete", kind: "chat", text: "10/23 的 Easy 沒跑，明天補", created_at: yAt("22:30") },
    { ...BLANK, id: "c-mk-b2", role: "coach", kind: "chat", text: "好，10/23 的 Easy 6 km 補到明天 10/27，取代那天的 Easy 7 km，不疊兩堂。這堂算在第 4 週（第 3 週的週報已經出了）。整張一起看：", proposal: proposals.find((x) => x.id === "p-mk-stale") ?? null, created_at: yAt("22:31") },
    { ...BLANK, id: "c-mk-k1", role: "athlete", kind: "chat", text: "11/13 的 Easy 可以短一點嗎", created_at: todayAtS("05:05:00") },
    { ...BLANK, id: "c-mk-k2", role: "coach", kind: "chat", text: "可以，11/13 的 Easy 6 km 縮成 5 km，整張看一下：", proposal: proposals.find((x) => x.id === "p-kept") ?? null, proposal_rejected: true, created_at: todayAtS("05:05:10") },
    { ...BLANK, id: "c-mk-q1", role: "athlete", kind: "chat", text: "昨天的 Easy 沒跑，要補嗎？", created_at: todayAtS("05:00:00") },
    { ...BLANK, id: "c-mk-a1", role: "coach", kind: "chat", text: "要補。Easy 7 km 補到週四 10/29，今天是 MP，隔一天再跑剛好；週四原本是肌力日，核心併到這堂的備註。第 4 週的週報還沒出，這堂算在本週，本週 34 km 不變。整張一起看：", proposal: proposals.find((x) => x.id === "p-mk-this") ?? null, created_at: todayAtS("05:00:10") },
    { ...BLANK, id: "c-mk-q2", role: "athlete", kind: "chat", text: "10/25 的長跑沒跑，想補", created_at: todayAtS("05:01:00") },
    { ...BLANK, id: "c-mk-a2", role: "coach", kind: "chat", text: "兩條路。A：補，但不另開一天，併進 11/1 的長跑，18 km 當成補的那堂；第 3 週的週報已經出了，這堂算在第 4 週。B：不補，11/1 前段放慢，把量留給最後 2 km。離比賽還有 6 週，我偏 A。", proposal: proposals.find((x) => x.id === "p-mk-a") ?? null, created_at: todayAtS("05:01:10") },
    { ...BLANK, id: "c-mk-a3", role: "coach", kind: "chat", text: "", proposal: proposals.find((x) => x.id === "p-mk-b") ?? null, created_at: todayAtS("05:01:10") },
    { ...BLANK, id: "c-mk-q3", role: "athlete", kind: "chat", text: "今天腿有點痠，MP 少跑一點", created_at: todayAtS("05:02:00") },
    { ...BLANK, id: "c-mk-a4", role: "coach", kind: "chat", text: "9 km 縮成 7 km，心拍壓在 165 以下就好。", proposal: proposals.find((x) => x.id === "p-today-short") ?? null, created_at: todayAtS("05:02:10") },
    { ...BLANK, id: "c-mk-q4", role: "athlete", kind: "chat", text: "今天臨時有事，MP 往後移", created_at: todayAtS("05:03:00") },
    { ...BLANK, id: "c-mk-a5", role: "coach", kind: "chat", text: "移到週六 10/31，那天本來休息；隔天是 18 km 長跑，所以 MP 縮成 7 km。今天就沒有排課了。整張一起看：", proposal: proposals.find((x) => x.id === "p-today-move") ?? null, created_at: todayAtS("05:03:10") },
    { ...BLANK, id: "c-mk-q5", role: "athlete", kind: "chat", text: "今天早上跑了 7 km，Strava 有進來", created_at: todayAtS("05:04:00") },
    { ...BLANK, id: "c-mk-a6", role: "coach", kind: "chat", text: "那趟 7.00 km 還沒配到課，我不開提案卡。到「今天」頁，在「今天其他活動」那列按「算成 今天的課」就會配上；要算成別堂的話跟我說，我先把那堂移到今天，你再按。", created_at: todayAtS("05:04:10") },
    { ...BLANK, id: "c-mk-q6", role: "athlete", kind: "chat", text: "10/14 的 MP 想補到週五", created_at: todayAtS("05:04:30") },
    { ...BLANK, id: "c-mk-a7", role: "coach", kind: "chat", text: "10/14 的 MP 7 km 補到 10/30 週五。整張一起看：", proposal: proposals.find((x) => x.id === "p-mk-two") ?? null, created_at: todayAtS("05:04:40") },
    // Woo's check-in for today's run (demo: today's session is MP 7 km, three activities synced)
    { ...BLANK, id: "c5", role: "coach", kind: "checkin", text: "今天的課是 MP 7 km：2 km Easy + 3 km @ MP + 2 km Easy。Strava 剛進來 3 個活動，哪一個是這堂？", activity_id: "u-run", created_at: todayAt("07:05"),
      checkin: { state: "open", mode: "activity", date: today, session_id: todaySessionId(), session_label: "MP 7 km", candidates: [{ activity_id: "u-run", label: "跑步 06:40 · 7.00 km · 7:08/km" }, { activity_id: "u-walk", label: "走路 17:30 · 4.9 km · 64 分" }, { activity_id: "u-hyrox", label: "重訓 18:30 · 58 分 · 心拍 152" }] } },
  ].map((m) => ({ ...BLANK, ...m })) as ApiCoachMessage[];
  applyToPlan(proposals.find((x) => x.id === "p-applied")!);
  const mode = ccp();
  if (mode) thread.push(...correctPlanThread(mode));
  return thread;
}

/** coach-correct-plan: 11/4's verdict, Wei's two questions and Woo's answers (the texts are the design's, 02 §3.3), then the card (or what the mode asks for). */
const CCP_REASON = "6×90 秒上坡實跑 6.1 km，8 km 是估計值";
function correctPlanThread(mode: CorrectPlanMode): ApiCoachMessage[] {
  const N = mode === "interval" ? "間歇" : "坡跑"; // `interval`: the session's label is one the web has no name for (an AI-made plan: 間歇, 節奏)
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const corr = (sessionId: string, date: string, label: string, field: "target_distance_m" | "note", old: string | number | null, now: string | number, reason: string) =>
    chg({ op: "change", session_id: sessionId, field, old, new: now, label, date, reason, correction: true });
  const hill = (field: "target_distance_m" | "note" = "target_distance_m") =>
    field === "note" ? corr("s-2026-11-04", "2026-11-04", `${N} 8 km`, "note", null, "上坡用 6:00 以內的強度，6 趟約 6 km", CCP_REASON) : corr("s-2026-11-04", "2026-11-04", `${N} 8 km`, "target_distance_m", 8000, 6000, CCP_REASON);
  const mk = (id: string, changes: ApiProposalChange[], over: Partial<ApiProposal> & Pick<ApiProposal, "impact" | "basis" | "basis_text">): ApiProposal => {
    const p = card({ id, message_id: `${id}-m`, changes, created_at: ago(8), ...over });
    proposals.push(p);
    return p;
  };
  const hillImpact = {
    keep: `報告頁和判定標題繼續寫「${N} 8 km」，跟你跑的 6.1 km 對不上；第 5 週的計畫多算 2 km。`,
    change: "11/4 改成 6 km（估計值），那堂的判定重看一次；第 5 週計畫少 2 km。",
    risk: "沒有：實跑紀錄、配速、心得都不動，只有判定照新的數字重寫。",
  };
  const hillBasis = { basis: ["11/4 實跑 6.1 km", "課表 8 km（估計）", "6×90 秒上坡"], basis_text: `11/4 ${N}：2 km Easy + 6×90 秒上坡 + 2 km Easy，目標距離 8 km 是匯入課表時估的。你這趟 6.1 km，上坡 6 趟都在 6:00 以內。` };
  const A1 = `8 km 不是我算的，是課表上那堂的目標距離。11/4 在課表上是這樣寫的：\n\n- 11/4 週三 ${N}：2 km Easy + 6×90 秒上坡 + 2 km Easy，目標距離 8 km（估計）\n\n${N}用趟數和秒數寫，距離是匯入課表時估的，判定不拿它扣分。你這趟 6.1 km、6 趟上坡都在 6:00 以內，判定是達成；報告頁和判定標題寫的「${N} 8 km」就是這個估計值。\n\n要改成接近實際的 6 km，我可以開一張更正卡：只改課表上的距離，你的紀錄不動。`;
  const A2 = `可以。11/4 的目標距離改成 6 km，內容和其他欄位不動。你按採用後，那堂的判定我照 6 km 重看一次，報告頁和這裡的標題會變成「${N} 6 km」。`;
  const m = (id: string, role: "athlete" | "coach", text: string, min: number, extra: Partial<ApiCoachMessage> = {}): ApiCoachMessage => ({ ...BLANK, id, role, kind: "chat", text, created_at: ago(min), ...extra });
  const out: ApiCoachMessage[] = [
    { ...BLANK, id: "c-ccp-v", role: "coach", kind: "review", text: "6 趟上坡都在 6:00 以內，平均 5:41；前後兩段 Easy 7:20 上下，心拍 142。", activity_id: "a-2026-11-04",
      review: { label: `${N} 8 km`, verdict: "達成", reminder: `下次${N}第 6 趟一樣守 6:00`, date: "2026-11-04", updated: null, superseded: false }, created_at: at("2026-11-04T19:40:00+09:00") },
    m("c-ccp-q1", "athlete", `週三${N}你是怎麼估算 8 公里的？我照著跑也只有 6 公里`, 12),
    m("c-ccp-a1", "coach", A1, 11),
  ];
  if (mode === "rejected") {
    out.push(m("c-ccp-q3", "athlete", "可以把 11/4 改成休息嗎", 9),
      m("c-ccp-a3", "coach", "這個不行。11/4 已經綁了你那趟 6.1 km，改成休息等於把那趟從課表上拿掉，週跑量和判定都會對不上。已完成的課我只能更正目標距離和備註。想記下那天腿很沉，我可以寫進 11/4 的備註。", 8),
      m("c-ccp-q4", "athlete", `那把 11/4 的${N}移到週五`, 6),
      m("c-ccp-a4", "coach", "移到週五的話，那趟 6.1 km 就跟日期對不上了，我先不動日期。", 5, { proposal_rejected: true }));
    return out;
  }
  if (mode === "mixed") {
    const p = mk("p-ccp-mixed", [hill(), chg({ op: "change", session_id: "s-2026-11-11", field: "target_distance_m", old: 10000, new: 9000, label: "MP 10 km", date: "2026-11-11", reason: "前後各 1 km Easy 縮短，MP 段照舊。" })],
      { impact: { keep: "11/4 的標題跟實跑對不上；11/11 照 10 km 排，週跑量偏多。", change: "11/4 改成 6 km 並重判一次；11/11 縮成 9 km。", risk: "11/11 的 MP 段（7 km）不變，只少前後的 Easy。" }, ...hillBasis });
    out.push(m("c-ccp-q2", "athlete", `下次 MP 也縮短一點，${N}照實際的寫`, 9), m("c-ccp-a2", "coach", "11/4 更正成 6 km；11/11 的 MP 前後 Easy 少 1 km：", 8, { proposal: p }));
    return out;
  }
  if (mode === "three") {
    const p = mk("p-ccp-three", [
      corr("s-2026-11-01", "2026-11-01", "Long 18 km", "target_distance_m", 18000, 16000, "實跑 15.8 km，這次提早收在 16 km。"),
      hill(),
      corr("s-2026-11-05", "2026-11-05", "Recovery 5 km", "target_distance_m", 5000, 4500, "實跑 4.6 km，恢復跑本來就彈性。"),
    ], { impact: { keep: "三堂的標題都比實跑多一點；第 4 週、第 5 週的計畫各多算。", change: "三堂改成接近實跑的距離，各重判一次。", risk: "沒有：紀錄和心得不動；三次重判算在今天的重新分析次數裡。" },
      basis: ["11/1 實跑 15.8 km", "11/4 實跑 6.1 km", "11/5 實跑 4.6 km"], basis_text: "三堂的課表距離都比實跑多一點，照實跑改成接近的數字。" });
    out.push(m("c-ccp-q2", "athlete", "11/1 跟 11/5 的距離也一樣不準吧，一起改", 9), m("c-ccp-a2", "coach", "三堂都照實跑改成這樣：", 8, { proposal: p }));
    return out;
  }
  out.push(m("c-ccp-q2", "athlete", mode === "note" ? "距離改 6 km，備註也把上坡的做法寫清楚" : `你可以把${N} 8km 課表改正確嗎`, 9));
  if (mode === "note") {
    const p = mk("p-ccp-note", [hill(), hill("note")], { impact: { keep: "備註沒寫上坡怎麼跑。", change: "距離 6 km、備註寫清楚；判定重看一次（同一堂兩列只重判一次）。", risk: "沒有。" }, ...hillBasis });
    out.push(m("c-ccp-a2", "coach", "距離改 6 km，備註寫清楚上坡的實際做法：", 8, { proposal: p }));
    return out;
  }
  const p = mk("p-ccp", [hill()], { impact: hillImpact, ...hillBasis, ...(mode === "stale" ? { status: "stale" as const, stale_reason: `11/4 ${N} 8 km 已不是已完成的課` } : {}) });
  out.push(m("c-ccp-a2", "coach", mode === "stale" ? "可以。11/4 的目標距離改成 6 km，內容和其他欄位不動……" : A2, 8, { proposal: p }));
  return out;
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
    // Woo rewrites the review: preparing, then thinking, then it is updated in place (5 s)
    walkStages(m, [["preparing", 0], ["thinking", 2500]], 5000, () => {
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
    });
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
    // weekly-review-entry: `window.__mockWeeklyStale = true` turns a weekly card stale at the press (what another tab deciding first, or a changed plan, does)
    const why = p.source === "weekly" && knobs().__mockWeeklyStale ? "11/12 Recovery 5 km 在這張卡之後被改過" : planConflict(p);
    if (why) {
      p.status = "stale";
      p.stale_reason = why;
      throw new ApiError(409, "plan_changed");
    }
    if (p.source === "weekly" && knobs().__mockWeekly400) throw new ApiError(400, "two sessions on 2026-11-12"); // weekly-review-entry: the card stays pending; the card shows its fixed sentence
    const day = doubleBooked(p);
    if (day) throw new ApiError(400, `two sessions on ${day}`); // the card stays pending; the card shows its fixed sentence
    const parts = applyToPlan(p);
    const corrected = p.changes.some((c) => c.correction);
    closeAsksFor(p);
    for (const q of proposals) if (p.group_id && q.group_id === p.group_id && q.id !== p.id && q.status === "pending") { q.status = "superseded"; q.decided_at = new Date().toISOString(); superseded.push(q.id); }
    const t = threadData();
    if (corrected) rejudgeCorrected(p); // before the confirmation, like the api: a 「次數用完」 / 「這次分析沒成功」 line comes first
    const text = corrected ? correctionConfirm(p, !(ccp() === "limit" || ccp() === "notqueued" || reviewLimited())) : CONFIRM[p.id]?.() ?? (parts.length ? `改好了，課表上${parts.join("、")}。前一天的 Easy 跑完記得跟我說腿的狀況。` : "改好了。");
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text, created_at: new Date().toISOString() });
  }
  p.status = action === "apply" ? "applied" : "dismissed";
  p.decided_at = new Date().toISOString();
  return { proposal: { ...p, changes: p.changes.map((c) => ({ ...c })) }, superseded };
}

const isApprox = (s: Pick<ApiSession, "type" | "content">) => s.type === "interval" || /×|秒/.test(s.content ?? ""); // the api's isApproxDistance

/**
 * The api's confirmation after a card that corrected completed sessions (postProposalApplied's template, word for word): one segment per corrected session
 * ("11/4 的坡跑目標距離改成 6 km（估計值）"), then the sentence about the re-judge; `queued` false: 今天的次數用完 / 排程失敗.
 */
function correctionConfirm(p: ApiProposal, queued: boolean): string {
  const d = data();
  const segs: string[] = [];
  const seen = new Set<string>();
  for (const c of p.changes) {
    if (!c.correction || !c.session_id || seen.has(c.session_id)) continue;
    seen.add(c.session_id);
    const s = d.sessions.find((x) => x.id === c.session_id);
    const rows = p.changes.filter((x) => x.correction && x.session_id === c.session_id);
    const name = (c.label ?? s?.label ?? "").replace(/\s*[\d.]+\s*km$/, "");
    const sp = /^[A-Za-z0-9]/.test(name) ? " " : "";
    const dist = rows.find((x) => x.field === "target_distance_m" && typeof x.new === "number");
    const note = rows.some((x) => x.field === "note");
    const parts = [dist && typeof dist.new === "number" ? `目標距離改成 ${kmPlan(dist.new)} km${s && isApprox(s) ? "（估計值）" : ""}` : null, note ? "備註更新了" : null].filter(Boolean).join("、");
    segs.push(`${md(c.date ?? s?.scheduled_date ?? "")} 的${sp}${name}${sp}${parts}`);
  }
  const tail = !queued ? "判定這次沒有排到重判（今天的次數用完或排程失敗），報告頁可以按「重新分析」。"
    : segs.length > 1 ? "那幾堂的判定我各重看一次，報告頁和這裡都會更新。" : "那堂的判定我重看一次，報告頁和這裡都會更新。";
  return `改好了，課表上${segs.join("、")}。${tail}`;
}

/**
 * After 採用 of a correction card (the api's regroupReview, before it posts the confirmation): each corrected session's Claude verdict goes (the report page shows
 * 分析中) and Woo judges it again (the worker; ~4 s each, one after the other). `limit` (or reviewLimit): nothing is queued, the review is the failed row and the thread
 * gets the day's fixed line once; `notqueued`: the same failed row with the api's own line 「這次分析沒成功，報告頁可以按「重新分析」。」; `slow`: queued, never answered.
 */
function rejudgeCorrected(p: ApiProposal) {
  const ids = [...new Set(p.changes.filter((c) => c.correction && c.session_id).map((c) => c.session_id as string))];
  if (ccp() === "limit" || reviewLimited()) {
    for (const id of ids) { const g = groupOfSession(id)[0]; if (g?.review?.source === "claude") limitReview(g); }
    return;
  }
  if (ccp() === "notqueued") {
    const t = threadData();
    for (const id of ids) {
      const g = groupOfSession(id)[0];
      if (!g || g.review?.source !== "claude") continue;
      g.review = { verdict: null, comment: null, reminders: [], source: "claude", model: null, adjust_hint: null, failed: true, error: "這次分析沒成功，再試一次", created_at: new Date().toISOString(), corrected_at: null };
      t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: "這次分析沒成功，報告頁可以按「重新分析」。", activity_id: g.id, created_at: new Date().toISOString() });
    }
    return;
  }
  for (const id of ids) for (const g of groupOfSession(id)) if (g.review?.source === "claude") g.review = null;
  if (ccp() === "failafter") {
    // the worker's model call fails: no verdict; a failed row and the api's line (with the activity) arrive after the confirmation
    ids.forEach((id, i) => setTimeout(() => {
      const g = groupOfSession(id)[0];
      if (!g || g.review) return;
      const t = threadData();
      g.review = { verdict: null, comment: null, reminders: [], source: "claude", model: null, adjust_hint: null, failed: true, error: "這次分析沒成功，再試一次", created_at: new Date().toISOString(), corrected_at: null };
      t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: "這次分析沒成功，報告頁可以按「重新分析」。", activity_id: g.id, created_at: new Date().toISOString() });
    }, 4000 + i * 2500));
    return;
  }
  if (ccp() !== "slow") ids.forEach((id, i) => setTimeout(() => regroupMock(id), i * 2500));
}

/** A 補課 answers the weekly review's open question about that session: it closes as skipped, nothing is re-run (the api does the same). */
function closeAsksFor(p: ApiProposal) {
  const ids = new Set(p.changes.filter((c) => c.makeup && c.session_id).map((c) => c.session_id as string));
  for (const m of threadData()) {
    if (m.kind !== "weekly" || !m.weekly) continue;
    m.weekly = { ...m.weekly, asks: m.weekly.asks.map((a) => (ids.has(a.session_id) && a.state === "open" ? { ...a, state: "skipped" as const } : a)) };
  }
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
  m.weekly = { week_start: w.week_start, asks: [], updated: { at: now, reason }, cancelled: [...(m.weekly?.cancelled ?? []), ...cancelled], makeups: m.weekly?.makeups ?? [] };
}

/** Demo: the pick assigns the activity, then Woo's question arrives after ~2 s. */
export function mockPostCheckinPick(checkinId: string, body: PostCheckinPickRequest): PostCheckinPickResponse {
  const t = threadData();
  const c = t.find((m) => m.id === checkinId && m.kind === "checkin");
  if (!c?.checkin || c.checkin.state !== "open") throw new ApiError(409, "check-in is no longer open"); // the api's answer
  // append: today's session already has a run and another came in. 不是，另外算 leaves it unassigned; a chip makes it one more recording
  // (no feel question: Woo posts one fixed line and judges the whole session again).
  if (c.checkin.mode === "append") {
    if (body.none) {
      c.checkin = { ...c.checkin, state: "dismissed" };
      const pick: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "pick", text: "不是，另外算", created_at: new Date().toISOString() };
      t.push(pick, { ...BLANK, id: `c${t.length + 2}`, role: "coach", kind: "chat", text: "好，這趟另外算，留在「其他活動」。要併進去的話到報告頁按「這堂的活動」。", created_at: new Date().toISOString() });
      return { checkin: { ...c }, pick };
    }
    const cand = c.checkin.candidates.find((x) => x.activity_id === body.activity_id);
    const sessionId = c.checkin.session_id;
    const a = cand?.activity_id ? findActivity(cand.activity_id) : undefined;
    if (!cand || !a || !sessionId) throw new ApiError(400, "not one of the candidates");
    checkAppend(a, sessionId);
    a.session_id = sessionId;
    a.match_status = "confirmed";
    a.review = null;
    relist(a);
    c.checkin = { ...c.checkin, state: "picked" };
    const pick: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "pick", text: cand.label, activity_id: a.id, created_at: new Date().toISOString() };
    t.push(pick);
    appendDone(sessionId);
    refreshSegments();
    return { checkin: { ...c }, pick: { ...pick } };
  }
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
    afterJudged();
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
      if (a) {
        const was = a.session_id;
        a.session_id = null; a.match_status = "unplanned"; a.review = null; a.memo = null; a.rpe = null;
        relist(a);
        if (was) regroupMock(was); // an appended recording taken back: the rest of the session is judged again
      }
    }
    for (const m of t) if (m.kind === "ask" && m.ask?.state === "open") m.ask = { ...m.ask, state: "answered" };
    for (const m of t) if (m.role === "athlete" && m.status === "pending") m.status = "sent";
  }
  c.checkin = { ...c.checkin, state: "reset" };
  const fresh: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "checkin", text: c.checkin.mode === "append" ? "好，那這趟是同一堂的另一段嗎？" : `好，那是哪一個？今天的課是 ${c.checkin.session_label ?? ""}。`, activity_id: c.activity_id, checkin: { ...c.checkin, state: "open" }, created_at: new Date().toISOString() };
  t.push(fresh);
  return fresh;
}
/** Demo: undo the pick / dismissal and ask again. */
export function mockPostCheckinReset(checkinId: string): PostCheckinResetResponse {
  const c = threadData().find((m) => m.id === checkinId && m.kind === "checkin");
  if (!c?.checkin || c.checkin.state === "open" || c.checkin.state === "reset") throw new Error("check-in cannot be reset");
  return { checkin: { ...resetCheckin(c) } };
}

/** What the api sends for a message: `stage` only while it is pending (or a weekly review being rewritten). `window.__mockStage` overrides it (a string, or null) to try unknown values. */
function exposed(m: ApiCoachMessage): ApiCoachMessage {
  const k = knobs();
  const stage = m.status === "pending" || m.stage ? (k.__mockStage !== undefined ? k.__mockStage : m.stage) : null;
  return { ...m, stage };
}

/** Every GET /weekly the page made, for QA (`window.__weeklyCalls`). */
const weeklyCalls: number[] = [];
if (typeof window !== "undefined") (window as unknown as { __weeklyCalls: number[] }).__weeklyCalls = weeklyCalls;

/** Every GET /coach the page made, for QA (`window.__coachCalls`). */
export interface CoachCall { limit: number; before: string | null; at: number }
export const coachCalls: CoachCall[] = [];
if (typeof window !== "undefined") (window as unknown as { __coachCalls: CoachCall[] }).__coachCalls = coachCalls;

/** Same order the client merges in: oldest first, same time → by id. */
const byTime = (a: ApiCoachMessage, b: ApiCoachMessage) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * The newest `limit` messages (default 10), or the `limit` before `before`; `has_more` = something older exists.
 * `window.__mockCoachPageSize` replaces the requested limit (e.g. 100: the whole thread on the first page),
 * `__mockCoachDelay` (ms) slows every call, `__mockOlderFail` fails the ones with `before`.
 */
export function mockCoach(opts: { limit?: number; before?: string } = {}): CoachResponse | Promise<CoachResponse> {
  const delay = knobs().__mockCoachDelay;
  if (!delay) return coachPage(opts);
  return new Promise((resolve, reject) => setTimeout(() => { try { resolve(coachPage(opts)); } catch (e) { reject(e); } }, delay));
}
function coachPage({ limit = 10, before }: { limit?: number; before?: string }): CoachResponse {
  const k = knobs();
  const lim = k.__mockCoachPageSize ?? limit;
  coachCalls.push({ limit: lim, before: before ?? null, at: Date.now() });
  if (before && k.__mockOlderFail) throw new ApiError(500, "伺服器錯誤，稍後再試");
  const all = [...threadData()].filter((m) => !(k.__mockWeeklyMissing && m.id === "c-weekly-1")).sort(byTime); // __mockWeeklyMissing: week 1's message is not in the thread
  let end = all.length;
  if (before) {
    const i = all.findIndex((m) => m.id === before);
    if (i < 0) throw new ApiError(400, "unknown before");
    end = i;
  }
  const start = Math.max(0, end - lim);
  return { coach: { name: "Woo" }, messages: all.slice(start, end).map(exposed), has_more: start > 0 };
}
// ---- 更正判定 (coach-correct-review) ----
/** What the athlete says that makes Woo look at a verdict again (the real Woo decides by reading the schedule; the demo by these words). */
const CORRECTION_WORDS = /課表是|報告.*更新|重判|判錯|更正/;
const corrections = { today: new Map<string, number>(), running: new Set<string>() }; // per primary activity: corrections done today, re-judges on their way

/** The newest verdict message in the thread that is still the current one, and the session's primary activity; null when this line is not a correction or there is nothing to correct. */
function correctionTarget(text: string): { msg: ApiCoachMessage; a: ApiActivity; s: ApiSession | null } | null {
  if (!CORRECTION_WORDS.test(text)) return null;
  const msg = [...threadData()].reverse().find((x) => x.kind === "review" && x.activity_id && !x.review?.superseded);
  const asked = msg?.activity_id ? findActivity(msg.activity_id) : undefined;
  if (!msg || !asked) return null;
  const a = (asked.session_id ? groupOfSession(asked.session_id)[0] : null) ?? asked;
  return { msg, a, s: data().sessions.find((x) => x.id === a.session_id) ?? null };
}

/** Woo's reply to a correction, then (if he agreed and the api took it) the re-judge: the wait line walks reading → judging, then the new verdict is posted. */
function answerCorrection(athlete: ApiCoachMessage, { msg, a, s }: NonNullable<ReturnType<typeof correctionTarget>>) {
  const t = threadData();
  const mode = ccr().correction ?? "ok";
  const label = msg.review?.label ?? (s ? shortName(s) : "這堂");
  const date = msg.review?.date ?? s?.scheduled_date ?? todayJst();
  const tgt = s?.target ?? null;
  const pace = tgt ? tgt.split(" / ")[0] : null;
  const base = { ...BLANK, id: `c${t.length + 1}`, role: "coach" as const, kind: "chat" as const, activity_id: null, created_at: new Date().toISOString() };
  if (mode === "disagree") {
    t.push({ ...base, text: `${pace ? `課表寫的是 ${pace}` : "我對照了課表"}，你這堂的數字跟它對不上，所以我維持這個判定和提醒。要是有停錶、繞路這類數據看不出來的情況，跟我說，我再看一次。` });
    return;
  }
  const text = `你說得對，${pace ? `課表的配速是 ${pace}` : "課表的區間我讀錯了"}，我把上一次提醒的數字當成課表了。我重判一次，報告頁和這裡都會更新。`;
  const why = ccr().reviewLimit ? "daily"
    : mode === "rejected" ? "limit" : mode.startsWith("rejected-") ? mode.slice(9) as "daily" | "manual" | "queued" | "unknown"
    : (corrections.today.get(a.id) ?? 0) >= 2 ? "limit"
    : corrections.running.has(a.id) ? "queued"
    : null;
  const reply: ApiCoachMessage = { ...base, text, correction: { activity_id: a.id, label, date, state: why ? "rejected" : "queued", why } };
  t.push(reply);
  if (why) return;
  // accepted: the Claude verdict goes, the report page shows 分析中; the athlete's line now counts as a correction
  corrections.today.set(a.id, (corrections.today.get(a.id) ?? 0) + 1);
  corrections.running.add(a.id);
  const token = (regroupToken.get(a.session_id ?? a.id) ?? 0) + 1;
  regroupToken.set(a.session_id ?? a.id, token);
  a.review = null;
  setTimeout(() => { if (reply.correction?.state === "queued") reply.stage = "reading"; }, 1500);
  setTimeout(() => { if (reply.correction?.state === "queued") reply.stage = "judging"; }, 3500);
  if (mode === "slow") return; // the verdict never arrives: the wait line, then the 3-minute sentence
  setTimeout(() => {
    corrections.running.delete(a.id);
    reply.stage = null;
    const now = new Date().toISOString();
    if (mode === "failed") {
      a.review = { verdict: null, comment: null, reminders: [], source: "claude", model: null, adjust_hint: null, failed: true, error: "這次分析沒成功，再試一次", created_at: now, corrected_at: null };
      reply.correction = { ...reply.correction!, state: "failed", why: null };
      t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: "這次分析沒成功，報告頁可以按「重新分析」", activity_id: a.id, created_at: now });
      return;
    }
    const reason = pace ? `課表的配速是 ${pace}` : "課表的區間讀錯了";
    const comment = `更正後的判定：${reason}，這堂的配速和心拍都落在區間內，整堂達成。上次把提醒的數字當成課表是我讀錯。`;
    const reminder = "前段照課表的區間跑就好";
    a.review = { verdict: "達成", comment, reminders: [reminder], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: now, corrected_at: athlete.created_at };
    supersedeEarlier(a);
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "review", text: comment, activity_id: a.id, review: { label, verdict: "達成", reminder, date, updated: { reason }, superseded: false }, created_at: now });
    reply.correction = { ...reply.correction!, state: "done", why: null };
  }, 5500);
}

/** Demo mode: Woo answers after ~10 s, walking through the stages, off-topic gets the one-liner. */
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
      setTimeout(() => { if (a) { judge(a, s); afterJudged(); } }, 3000);
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
    if (reviewLimited()) { m.status = "sent"; if (a) limitReview(groupOfSession(a.session_id ?? "")[0] ?? a); return { message: { ...m } }; } // the answer is kept, no re-judge: the line is not left pending
    // the verdict's wait: reading the run, then comparing pace and heart rate
    walkStages(m, [["reading", 0], ["judging", 2500]], 5000, () => {
      if (a) a.review = { verdict: "達成但有提醒", comment: "MP 段 6:46 守住了，第 5 km 心拍 166 超過上限。第三公里開始腿重跟數字對得上。", reminders: ["MP 第 3 公里開始看心拍，過 160 就稍微放慢"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date().toISOString(), corrected_at: null };
      if (a) supersedeEarlier(a);
      t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "review", text: "MP 段 6:46 守住了，第 5 km 心拍 166 超過上限。第三公里開始腿重跟數字對得上。", activity_id: ask.ask!.activity_id, review: { label: "MP 7 km", verdict: "達成但有提醒", reminder: "MP 第 3 公里開始看心拍，過 160 就稍微放慢", date: todayJst(), updated: null, superseded: false }, created_at: new Date().toISOString() });
      m.status = "sent";
      afterJudged();
    });
    return { message: { ...m } };
  }
  // 請 Woo 重看: he sends a new card against today's plan (the stale one stays as it was).
  if (body.re_propose) {
    const old = proposals.find((x) => x.id === body.re_propose);
    if (!old) throw new ApiError(404, "not found");
    const m: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "chat", text: body.text, status: "pending", created_at: new Date().toISOString() };
    t.push(m);
    walkStages(m, [["preparing", 0], ["thinking", 2500], ["writing", 5000]], 7000, () => {
      if (old.id === "p-mk-stale") {
        // the 補課 whose day had passed: against today's plan, to Thursday (the 肌力 day makes room), counted in week 4
        let again = proposals.find((x) => x.id === "p-mk-restale");
        if (!again) {
          again = card({ id: "p-mk-restale", message_id: null, created_at: new Date().toISOString(),
            changes: [
              chg({ op: "change", session_id: "s-2026-10-23", field: "scheduled_date", old: "2026-10-23", new: "2026-10-29", label: "Easy 6 km", date: "2026-10-23", makeup: true, reason: "10/23 漏的 Easy 補到週四。" }),
              chg({ op: "remove", session_id: "s-2026-10-29", label: "肌力日", date: "2026-10-29", reason: "週四改跑 Easy。" }),
            ],
            basis: old.basis, basis_text: old.basis_text,
            impact: { keep: "10/23 的 Easy 6 km 算沒跑，第 3 週 3/4 堂。", change: "補到 10/29 週四。第 3 週的週報已經出了，這堂算在第 4 週：第 4 週 34 → 40 km。", risk: "週四腿還重就不補，Easy 漏了本來就不用硬補。" } });
          proposals.push(again);
        }
        t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: "用現在的課表重排了一張：10/27 已經過了，10/23 的 Easy 6 km 改補到 10/29 週四，這堂算在第 4 週。", proposal: again, created_at: new Date().toISOString() });
        m.status = "sent";
        return;
      }
      let next = proposals.find((x) => x.id === "p-restale");
      if (!next) {
        next = card({ id: "p-restale", message_id: null, created_at: new Date().toISOString(),
          changes: [
            chg({ op: "change", session_id: "s-2026-11-27", field: "target_pace_sec_km", old: 450, new: 465, label: "Easy 5 km", date: "2026-11-27" }),
            chg({ op: "change", session_id: "s-2026-11-29", field: "target_distance_m", old: 18000, new: 16000, label: "Long 18 km", date: "2026-11-29", reason: "離 32 km 只隔 4 天，18 km 還是會疊進 taper。" }),
          ],
          weeks: old.weeks, basis: old.basis, basis_text: old.basis_text, impact: old.impact });
        proposals.push(next);
        const s29 = data().sessions.find((x) => x.id === "s-2026-11-29");
        if (s29 && s29.target_distance_m === 20000) { s29.target_distance_m = 18000; s29.content = "長跑 18 km"; } // the weekly review's edit the old card ran into
      }
      t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: "用現在的課表重排了一張：11/29 已經是 18 km，改成 16 km；11/27 的 Easy 配速照放慢。", proposal: next, created_at: new Date().toISOString() });
      m.status = "sent";
    });
    return { message: { ...m } };
  }
  const quoted = body.activity_id ? findActivity(body.activity_id) : undefined;
  const quote = quoted ? `${quoted.start_time.slice(5, 10).replace("-", "/")} ${quoted.session_id ? "課表" : "未排課"} ${(quoted.distance_m / 1000).toFixed(2)} km` : null;
  const m: ApiCoachMessage = { ...BLANK, id: `c${t.length + 1}`, role: "athlete", kind: "chat", text: body.text, activity_id: body.activity_id ?? null, status: "pending", quote, created_at: new Date().toISOString() };
  t.push(m);
  // preparing → thinking → searching → writing, then the reply (10 s: each stage outlasts the 2 s poll, so every one can be seen)
  const target = correctionTarget(body.text);
  if (target) {
    walkStages(m, [["preparing", 0], ["thinking", 2500], ["searching", 5000], ["writing", 7500]], 10000, () => { answerCorrection(m, target); m.status = "sent"; });
    return { message: { ...m } };
  }
  walkStages(m, [["preparing", 0], ["thinking", 2500], ["searching", 5000], ["writing", 7500]], 10000, () => {
    const offTopic = /吃|電影|天氣|股票|工作/.test(body.text) && !/跑|課表|心拍|配速|腿/.test(body.text);
    const reply = offTopic ? "這個不歸我管，我們回到課表。週五恢復跑完記得寫一下腿的感覺。"
      : /為何|為什麼/.test(body.text) ? MD_REPLY_WHY // explanation: paragraphs, a list, bold
      : /標題|連結|圖片|表格/.test(body.text) ? MD_REPLY_SYNTAX // asked for what the app cannot show: a short answer with none of that syntax
      : /幾公里/.test(body.text) ? MD_REPLY_SHORT // simple question: one short paragraph
      : "（示範）收到。以你最近 14 天的心拍來看，這個問題先用降速處理，不要先想拿掉課。週五恢復跑完再跟我說腿的狀況。";
    t.push({ ...BLANK, id: `c${t.length + 1}`, role: "coach", kind: "chat", text: reply, created_at: new Date().toISOString() });
    m.status = "sent";
  });
  return { message: { ...m } };
}

// =====================================================================================================================
// 群組 / group-race (demo). In memory, like everything above; `page.goto` resets it.
//
// Switches (`window.__mock = { … }`, set before the page loads, e.g. with addInitScript). `share`, `invite`, `shareFail` and the
// variants `judging`, `failed`, `corrected`, `blocked`, `gone` are read on every call; `groups` and the variants that shape the
// people and groups (`solo`, `five`, `many`, `noplan`, `outofrange`, `finished`, `member`) are read once, when the groups are first needed:
//   groups     "none" | "one" (default) | "two" | "three"    how many groups I am in: 富士山組; + 東京 2027; + 跑團組 (three = the limit)
//   share      Partial<ShareSettings>    Sara's switches (default: progress and events on, plan / runs / reviews off); QA: { plan: true, runs: true, reviews: true }
//   variant    one name or several ("five,many"), or an array:
//                solo       富士山組 has only me (no unread, one 加入 event)
//                five       5 members, one of each kind of dashboard row (Sara 範圍內但今天不在課表週, Ken 課表還沒排到, Taro 還沒有課表, Mika 沒有分享進度), the invite icon is dimmed
//                many       40 events (更早的 ›)
//                noplan     Sara has no plan and no runs (her row ends in 最長 —)
//                outofrange Sara's plan ends before the race
//                finished   the race is over (已完賽), nobody's plan covers it
//                member     I am a member, Ken owns the group (no unread)
//                judging    the newest 完成了 event is not judged yet      failed   its judgement failed      corrected   its judgement was corrected
//                blocked    after the 消息中心 was opened Sara's `events` switch goes off: the list still shows her events, opening one answers 404, reloading drops them
//                nomyplan   I have no active plan: GET /plan answers 404 (the 群組 tab dot then comes from GET /groups)
//                gone       every action on the group (invite, remove, leave, disband, picking a member) answers 404, and after that so does reading it: I was removed
//   invite     "ok" (default) | "expired" | "revoked" | "used_up" | "full" | "already_member" | "group_limit" | "not_found"    what /join/<token> says
//   shareFail  true → PUT /me/share answers 500          shareGetFail  true → GET /me/share answers 500
//   myShare    Partial<ShareSettings>    MY switches at the start (default: progress and events on, plan / runs / reviews off = a user from before 2026-11-06); read once.
//              The first time I become a member (建立 / 加入 with `groups: "none"`: I was never in a group) they all go on, like the api's first-join row,
//              unless `myShare` is given or I already switched something (then the row exists and is kept).
//   strava     "none" → GET /me has no Strava (設定 shows 尚未連結, and 設定 › Strava has the one black 連結 button; `false` of the plan-draft switches does the same)
//              "unlink-fail" → 解除 Strava 連結 (after the confirm) answers 500 after 0.6 s: the red line shows, still 已連結. Without it the unlink works: 解除中… then GET /me has no Strava.
//   me         "long" → the longest things 設定 has to fit: a 30-character email, an 8-digit athlete id and a long scope (for the widths 320–390)
// =====================================================================================================================

interface GroupSwitches { groups?: "none" | "one" | "two" | "three"; share?: Partial<ShareSettings>; variant?: string | string[]; invite?: InviteState | "not_found"; shareFail?: boolean; shareGetFail?: boolean; myShare?: Partial<ShareSettings>; strava?: "none" | "unlink-fail"; me?: "long" }
const gsw = (): GroupSwitches => (globalThis as unknown as { __mock?: GroupSwitches }).__mock ?? {};
const variants = (): Set<string> => {
  const v = gsw().variant;
  return new Set((Array.isArray(v) ? v : (v ?? "").split(",")).map((x) => x.trim()).filter(Boolean));
};
const has = (name: string) => variants().has(name);

const DEFAULT_SHARE: ShareSettings = { progress: true, events: true, plan: false, runs: false, reviews: false };
const ALL_SHARED: ShareSettings = { progress: true, events: true, plan: true, runs: true, reviews: true };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const notFound = (what = "group not found") => new ApiError(404, what);
const isRunAct = (a: ApiActivity) => !a.sport_type || ["Run", "TrailRun", "VirtualRun"].includes(a.sport_type);

// ---- the people ---------------------------------------------------------------------------------------------------

/** Someone in a group: a plan (full shape, drawn through the same `buildPlanView` the app uses) or only a list of runs. */
interface Person { key: string; name: string; plan: PlanResponse | null; runs: { date: string; m: number }[]; share: () => ShareSettings }

const MOCK_COMMENTS: Record<string, string> = {
  達成: "（示範）整堂數據都落在課表範圍內，後半沒有掉速，心拍也很穩。",
  達成但有提醒: "（示範）配速和距離都到了，只是前 2 km 比目標快，心拍跟著被拉高。",
  未達成: "（示範）這次配速比目標快很多，心拍也超過上限，這堂的目的（控制強度）沒有做到。",
};

/** A plan and its recordings for a mock friend: the same sessions as the demo plan, runs for the past ones except `skip`. */
function friendPlan(opts: { id: string; userId: string; raceDate: string; raceName: string; lastDate?: string; every?: number; skip?: string[]; withoutWeekOf?: string; verdicts?: Record<string, Verdict> }): PlanResponse {
  const today = todayJst();
  const last = opts.lastDate ?? "9999-12-31";
  let weeks: ApiWeek[] = (seed.weeks ?? []).filter((w) => w.start <= last).map((w) => ({ week_no: w.week_no, week_start: w.start, week_end: opts.lastDate && w.end > opts.lastDate ? opts.lastDate : w.end, phase: w.phase, focus: w.focus }));
  if (opts.withoutWeekOf) weeks = weeks.filter((w) => !(opts.withoutWeekOf! >= w.week_start && opts.withoutWeekOf! <= w.week_end));
  const inWeeks = (d: string) => weeks.some((w) => d >= w.week_start && d <= w.week_end);
  const sessions: ApiSession[] = seed.sessions.filter((x) => x.date <= last && inWeeks(x.date)).map((x) => ({
    id: `${opts.id}-s-${x.date}`, plan_id: `${opts.id}-plan`, scheduled_date: x.date, week_no: x.week_no, phase: x.phase, label: x.label, type: x.type, content: x.content, note: x.note, target: x.target,
    target_distance_m: x.distance_m, target_pace_sec_km: x.pace_sec_km, target_pace_min_sec_km: x.pace_min_sec_km, target_pace_max_sec_km: x.pace_max_sec_km, target_hr_min: x.hr_min, target_hr_max: x.hr_max,
    brief: DEMO_BRIEFS[x.date] ?? null, skipped_at: null, version: 1, superseded: false, moved_to_session_id: null, moved_to_date: null, moved_from_session_id: null, moved_from_date: null, counts_in_week_no: x.week_no,
  }));
  const done = sessions.filter((x) => x.type !== "rest" && x.target_distance_m && x.scheduled_date <= today && !(opts.skip ?? []).includes(x.scheduled_date))
    .filter((_, i) => i % (opts.every ?? 1) === 0);
  const activities: ApiActivity[] = done.map((x, i) => {
    const dist = Math.round((x.target_distance_m ?? 6000) * (0.97 + (i % 5) * 0.015));
    const pace = Math.round((x.target_pace_sec_km ?? 440) + ((i % 3) - 1) * 4);
    const hr = x.target_hr_min && x.target_hr_max ? Math.round((x.target_hr_min + x.target_hr_max) / 2) : 146;
    const moving = Math.round((dist / 1000) * pace);
    const kms = Math.floor(dist / 1000);
    const verdict: Verdict = opts.verdicts?.[x.scheduled_date] ?? "達成";
    const at = new Date(`${x.scheduled_date}T07:00:00+09:00`).toISOString();
    return {
      id: `${opts.id}-a-${x.scheduled_date}`, user_id: opts.userId, strava_activity_id: `${opts.id}${x.scheduled_date.replace(/-/g, "")}`, session_id: x.id, sport_type: "Run", start_time: at,
      distance_m: dist, moving_time_sec: moving, avg_pace_sec_km: pace, avg_hr: hr, max_hr: hr + 12, avg_watts: null, kcal: null, description: null, memo: "（不會被分享）", rpe: 4, memo_updated_at: at,
      device_name: "Apple Watch", gear_name: "Adizero", weather: "晴", details: NO_DETAILS, details_updated_at: null,
      splits: demoSplits(Array.from({ length: kms }, (_, k) => [pace + ((k * 7) % 11) - 5, hr - 6 + Math.round((k / Math.max(1, kms)) * 12)] as [number, number])),
      match_status: "confirmed", elapsed_time_sec: moving + 40, segment: { primary_activity_id: `${opts.id}-a-${x.scheduled_date}`, index: 1, count: 1 },
      review: { verdict, comment: MOCK_COMMENTS[verdict], reminders: verdict === "達成" ? [] : ["前 2 km 用呼吸不用錶", "心拍超過 150 就放慢"], source: "claude", model: null, adjust_hint: null, failed: false, error: null, created_at: new Date(`${x.scheduled_date}T12:30:00+09:00`).toISOString(), corrected_at: null },
    };
  });
  return {
    coach_unread: 0, coach_checkin_open: false, coach_ask_kind: null,
    plan: { id: `${opts.id}-plan`, user_id: opts.userId, race_name: opts.raceName, race_date: opts.raceDate, goal_time_sec: 18000, days_per_week: 4, status: "active" },
    weeks, sessions, activities, unassigned: [], routines: [], constraints: [], groups_unread: 0,
  };
}

const planRuns = (p: PlanResponse): Person["runs"] => p.activities.filter((a) => isRunAct(a) && a.match_status !== "ignored").map((a) => ({ date: toJstDate(a.start_time), m: a.distance_m }));

let people: Record<string, Person> | undefined;
/** Me (the live demo plan), and the friends. Built once; Sara's shape follows the variants at that moment. */
function cast(): Record<string, Person> {
  if (people) return people;
  const v = variants();
  const today = todayJst();
  const sara = v.has("noplan") ? null
    : v.has("outofrange") ? friendPlan({ id: "sara", userId: "u-sara", raceDate: "2026-11-15", raceName: "河口湖ハーフ", lastDate: "2026-11-15" })
    : friendPlan({ id: "sara", userId: "u-sara", raceDate: "2026-12-14", raceName: "富士山マラソン", skip: ["2026-10-21", "2026-10-25"], verdicts: { "2026-10-30": "達成但有提醒", "2026-10-14": "達成但有提醒", "2026-10-28": "未達成" }, withoutWeekOf: v.has("five") ? today : undefined });
  const ken = friendPlan({ id: "ken", userId: "u-ken", raceDate: "2026-11-15", raceName: "河口湖ハーフ", lastDate: "2026-11-15", every: 2 });
  people = {
    me: { key: "me", name: "Wei Wu", plan: null, runs: [], share: () => ALL_SHARED },
    sara: { key: "sara", name: "Sara", plan: sara, runs: sara ? planRuns(sara) : [], share: () => ({ ...DEFAULT_SHARE, ...gsw().share }) },
    ken: { key: "ken", name: "Ken", plan: ken, runs: planRuns(ken), share: () => ({ ...DEFAULT_SHARE, plan: true, runs: true }) },
    taro: { key: "taro", name: "Taro", plan: null, runs: [{ date: addDays(today, -1), m: 6000 }, { date: addDays(today, -4), m: 10000 }, { date: addDays(today, -30), m: 21000 }], share: () => ({ ...DEFAULT_SHARE, plan: true }) },
    mika: { key: "mika", name: "Mika", plan: null, runs: [], share: () => ({ ...DEFAULT_SHARE, progress: false }) },
  };
  return people;
}
/** My own plan is the live one (what I do in the app shows up in the group). */
function personPlan(p: Person): PlanResponse | null { return p.key === "me" ? (has("nomyplan") && !adoptedPlan ? null : mockPlan()) : p.plan; }
function personRuns(p: Person): Person["runs"] {
  if (p.key !== "me") return p.runs;
  return everyActivity().filter((a) => isRunAct(a) && a.match_status !== "ignored").map((a) => ({ date: toJstDate(a.start_time), m: a.distance_m }));
}

// ---- the numbers on the dashboard (01 N; the api's memberProgress) ----------------------------------------------------

const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

function progressOf(p: Person, groupRaceDate: string, today: string): ApiGroupProgress {
  const ws = mondayOf(today);
  const we = addDays(ws, 6);
  const runs = personRuns(p);
  const weekRuns = runs.filter((r) => r.date >= ws && r.date <= we);
  const recent = runs.filter((r) => r.date >= addDays(today, -83) && r.date <= today);
  const longest = recent.reduce<{ date: string; m: number } | null>((best, r) => (!best || r.m > best.m ? r : best), null);
  const base = { week_start: ws, week_actual_m: weekRuns.reduce((t, r) => t + r.m, 0), week_runs: weekRuns.length, longest_m: longest?.m ?? null, longest_date: longest?.date ?? null };
  const plan = personPlan(p);
  if (!plan) return { runs: base, plan_state: "no_plan", plan: null };
  const start = plan.weeks.map((w) => w.week_start).sort()[0] ?? plan.sessions.map((s) => s.scheduled_date).sort()[0];
  if (!(start && groupRaceDate >= start && groupRaceDate <= plan.plan.race_date)) return { runs: base, plan_state: "out_of_range", plan: null };
  const view = buildPlanView(plan, today);
  const w = view.currentWeek;
  const run = (d: { session: ApiSession }) => d.session.type !== "rest";
  return {
    runs: base,
    plan_state: "in_range",
    plan: {
      race_date: plan.plan.race_date,
      week: w ? { week_no: w.week_no, plan_m: w.plan_m, actual_m: w.actual_m, done_count: w.counted.filter((d) => run(d) && d.activity).length, plan_count: w.counted.filter(run).length } : null,
      total: { actual_m: view.totals.actual_m, plan_to_date_m: view.totals.plan_to_date_m, pct: view.totals.pct, done_count: view.totals.done_count, plan_count_to_date: view.days.filter((d) => run(d) && d.session.counts_in_week_no != null && d.session.scheduled_date <= today).length },
    },
  };
}

// ---- groups ---------------------------------------------------------------------------------------------------------

interface MEvent { id: string; kind: ApiGroupEvent["kind"]; by: string; at: string | (() => string); date?: string; label?: string }
interface MGroup { id: string; name: string; race_name: string; race_date: string; created: string; owner: string; members: { id: string; key: string; joined: string }[]; events: MEvent[]; unread: number; invite: { expires_at: string; uses_left: number } | null }

const jst = (d: string, hm: string) => new Date(`${d}T${hm}:00+09:00`).toISOString();
const evToday = (hm: string) => () => jst(todayJst(), hm);
const daysAgoAt = (n: number, hm: string) => () => jst(addDays(todayJst(), -n), hm);
const evAt = (x: MEvent) => (typeof x.at === "function" ? x.at() : x.at);

let groupList: MGroup[] | undefined;
let extraGroups: MGroup[] = []; // created or joined while the page is open
let gone = new Set<string>();   // left, disbanded
let goneNow = false;           // `gone`: once an action was refused, the group is not readable any more either (a removed member gets 404 on everything)
let blockedApplied = false;      // `blocked`: a 404 on an event was served, so the list drops Sara's events from now on
let eventSeq = 100;
let groupSeq = 0;

function makeGroups(): MGroup[] {
  const v = variants();
  const member = v.has("member");
  const solo = v.has("solo");
  const five = v.has("five");
  const finished = v.has("finished");
  const m = (g: string, key: string, joined: string) => ({ id: `m-${g}-${key}`, key, joined });
  const fuji: MGroup = {
    id: "g-fuji", name: "富士山組", race_name: "富士山マラソン", race_date: finished ? "2026-10-05" : seed.race_date, created: "2026-10-28T09:00:00+09:00",
    owner: member ? "ken" : "me",
    members: [
      ...(member ? [m("fuji", "ken", "2026-10-27T09:00:00+09:00")] : []),
      m("fuji", "me", "2026-10-28T09:00:00+09:00"),
      ...(solo ? [] : [m("fuji", "sara", "2026-10-29T20:10:00+09:00")]),
      ...(five ? [m("fuji", "ken", "2026-10-30T08:00:00+09:00"), m("fuji", "taro", "2026-10-31T21:30:00+09:00"), m("fuji", "mika", "2026-11-01T12:00:00+09:00")] : []),
    ].filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i)
      .sort((a, b) => (a.key === "me" ? -1 : b.key === "me" ? 1 : a.joined.localeCompare(b.joined))),
    events: solo
      ? [{ id: "e-1", kind: "joined", by: "me", at: "2026-10-28T09:00:00+09:00" }]
      : [
        { id: "e-1", kind: "session_done", by: "sara", at: evToday("07:41"), date: "2026-11-01", label: "Long 18 km" },
        { id: "e-2", kind: "session_done", by: "me", at: daysAgoAt(1, "19:20"), date: "2026-10-20", label: "Easy 6 km" },
        { id: "e-3", kind: "session_done", by: "sara", at: "2026-11-01T10:12:00+09:00", date: "2026-10-30", label: "Easy 6 km" },
        { id: "e-4", kind: "session_done", by: "me", at: "2026-10-30T09:30:00+09:00", date: "2026-10-08", label: "Easy 6 km" },
        { id: "e-5", kind: "joined", by: "sara", at: "2026-10-29T20:10:00+09:00" },
        { id: "e-6", kind: "joined", by: "me", at: "2026-10-28T09:00:00+09:00" },
      ],
    unread: solo || member ? 0 : 2, invite: null,
  };
  if (five) {
    fuji.events.unshift({ id: "e-7", kind: "session_done", by: "ken", at: daysAgoAt(0, "06:30"), date: "2026-11-02", label: "Easy 7 km" });
    fuji.events.splice(3, 0, { id: "e-8", kind: "joined", by: "mika", at: "2026-11-01T12:00:00+09:00" }, { id: "e-9", kind: "joined", by: "taro", at: "2026-10-31T21:30:00+09:00" });
  }
  if (v.has("many")) {
    const who = ["sara", "me", "sara", "me"];
    for (let i = 0; i < 34; i++) fuji.events.push({ id: `e-m${i}`, kind: "session_done", by: who[i % 4], at: `2026-09-${String(28 - (i % 27)).padStart(2, "0")}T0${(i % 8) + 1}:15:00+09:00`, date: "2026-10-08", label: "Easy 6 km" });
  }
  const tokyo: MGroup = {
    id: "g-tokyo", name: "東京 2027", race_name: "東京マラソン 2027", race_date: "2027-03-07", created: "2026-10-20T09:00:00+09:00", owner: "ken",
    members: [m("tokyo", "me", "2026-10-22T09:00:00+09:00"), m("tokyo", "ken", "2026-10-20T09:00:00+09:00"), m("tokyo", "mika", "2026-10-25T09:00:00+09:00")].sort((a, b) => (a.key === "me" ? -1 : b.key === "me" ? 1 : a.joined.localeCompare(b.joined))),
    events: [
      { id: "t-1", kind: "session_done", by: "ken", at: daysAgoAt(1, "07:05"), date: "2026-10-30", label: "Easy 6 km" },
      { id: "t-2", kind: "joined", by: "mika", at: "2026-10-25T09:00:00+09:00" },
      { id: "t-3", kind: "session_done", by: "ken", at: "2026-10-28T08:20:00+09:00", date: "2026-10-27", label: "Easy 7 km" },
      { id: "t-4", kind: "joined", by: "me", at: "2026-10-22T09:00:00+09:00" },
      { id: "t-5", kind: "joined", by: "ken", at: "2026-10-20T09:00:00+09:00" },
    ],
    unread: 2, invite: null,
  };
  const club: MGroup = {
    id: "g-club", name: "跑團組", race_name: "湘南國際マラソン", race_date: "2026-12-06", created: "2026-10-15T09:00:00+09:00", owner: "taro",
    members: [m("club", "me", "2026-10-16T09:00:00+09:00"), m("club", "taro", "2026-10-15T09:00:00+09:00")],
    events: [{ id: "c-1", kind: "joined", by: "me", at: "2026-10-16T09:00:00+09:00" }, { id: "c-2", kind: "joined", by: "taro", at: "2026-10-15T09:00:00+09:00" }],
    unread: 0, invite: null,
  };
  const n = gsw().groups ?? "one";
  return n === "none" ? [] : n === "one" ? [fuji] : n === "two" ? [fuji, tokyo] : [fuji, tokyo, club];
}

const myGroups = (): MGroup[] => {
  groupList ??= makeGroups();
  return [...groupList, ...extraGroups].filter((g) => !gone.has(g.id));
};
const groupById = (id: string): MGroup => {
  if (goneNow) throw notFound();
  const g = myGroups().find((x) => x.id === id);
  if (!g) throw notFound();
  return g;
};
const person = (key: string) => cast()[key];
const mine = (g: MGroup) => g.members.find((x) => x.key === "me")!;

function toApiGroup(g: MGroup): ApiGroup {
  return { id: g.id, name: g.name, race_name: g.race_name, race_date: g.race_date, created_at: g.created, joined_at: mine(g).joined, my_role: g.owner === "me" ? "owner" : "member", member_count: g.members.length, max_members: 5, unread: g.unread };
}

export function groupsUnreadTotal(): number {
  return myGroups().reduce((t, g) => t + g.unread, 0);
}

export function mockGetGroups(): GroupsResponse {
  return { groups: myGroups().map(toApiGroup), max_groups: 3 };
}

export function mockPostGroup(body: PostGroupRequest): PostGroupResponse {
  const name = body.name.replace(/\s+/g, " ").trim();
  const race = body.race_name.replace(/\s+/g, " ").trim();
  if (!name || name.length > 30 || !race || race.length > 40 || !/^\d{4}-\d{2}-\d{2}$/.test(body.race_date) || body.race_date < todayJst()) throw new ApiError(400, "bad request");
  if (myGroups().length >= 3) throw new ApiError(409, "group limit");
  firstJoin();
  const id = `g-new-${++groupSeq}`;
  const now = new Date().toISOString();
  const g: MGroup = { id, name, race_name: race, race_date: body.race_date, created: now, owner: "me", members: [{ id: `m-${id}-me`, key: "me", joined: now }], events: [{ id: `e-${++eventSeq}`, kind: "joined", by: "me", at: now }], unread: 0, invite: null };
  extraGroups.push(g);
  return { group: toApiGroup(g) };
}

const flagsOf = (key: string): ShareSettings => person(key).share();

export function mockGetGroup(id: string): GroupResponse {
  const g = groupById(id);
  const today = todayJst();
  const members: ApiGroupMember[] = g.members.map((gm) => {
    const p = person(gm.key);
    const shared = p.share();
    return { id: gm.id, display_name: p.name, is_me: gm.key === "me", role: g.owner === gm.key ? "owner" : "member", joined_at: gm.joined, shared, progress: shared.progress ? progressOf(p, g.race_date, today) : null };
  });
  return { group: toApiGroup(g), members, recent_events: visibleEvents(g).slice(0, 3).map((e) => toApiEvent(g, e)), invite: g.owner === "me" && g.invite ? { token: null, expires_at: g.invite.expires_at, uses_left: g.invite.uses_left } : null };
}

// ---- events -------------------------------------------------------------------------------------------------------------

/** The activities of a session of someone's plan, oldest first (a session may hold several recordings). */
function sessionActivities(p: Person, date: string): ApiActivity[] {
  const plan = personPlan(p);
  const s = plan?.sessions.find((x) => x.scheduled_date === date && !x.moved_to_date);
  if (!plan || !s) return [];
  if (p.key === "me") refreshSegments();
  return plan.activities.filter((a) => a.session_id === s.id && a.match_status !== "ignored").sort(byStart);
}

const sharedReview = (a: ApiActivity): ApiSharedReview | null => (a.review ? { verdict: a.review.verdict, reminders: a.review.reminders, comment: a.review.comment, source: a.review.source, failed: a.review.failed, created_at: a.review.created_at, corrected_at: a.review.corrected_at } : null);
const sharedActivity = (a: ApiActivity): ApiSharedActivity => ({
  id: a.id, session_id: a.session_id, sport_type: a.sport_type, start_time: a.start_time, distance_m: a.distance_m, moving_time_sec: a.moving_time_sec, elapsed_time_sec: a.elapsed_time_sec,
  avg_pace_sec_km: a.avg_pace_sec_km, avg_hr: a.avg_hr, max_hr: a.max_hr, splits: a.splits, segment: a.segment,
});

/** The newest 完成了 event of Sara's in the first group: the one the judging / failed / corrected variants act on. */
const flaggedEventId = () => "e-1";

function judgement(e: MEvent): { verdict: Verdict | null; judging: boolean; failed: boolean; corrected: boolean } {
  const acts = sessionActivities(person(e.by), e.date ?? "");
  const r = acts[0]?.review ?? null;
  if (e.id === flaggedEventId()) {
    if (has("judging")) return { verdict: null, judging: true, failed: false, corrected: false };
    if (has("failed")) return { verdict: null, judging: false, failed: true, corrected: false };
    if (has("corrected")) return { verdict: r?.verdict ?? "達成", judging: false, failed: false, corrected: true };
  }
  return { verdict: r?.verdict ?? null, judging: !r, failed: false, corrected: false };
}

function visibleEvents(g: MGroup): MEvent[] {
  const members = new Set(g.members.map((x) => x.key));
  return g.events
    .filter((e) => {
      if (e.kind !== "session_done") return true;
      if (e.by !== "me" && !members.has(e.by)) return false; // he left: his 完成了 lines are gone
      if (e.by === "sara" && blockedApplied) return false;
      return e.by === "me" || flagsOf(e.by).events;
    })
    .sort((a, b) => evAt(b).localeCompare(evAt(a)));
}

function toApiEvent(g: MGroup, e: MEvent): ApiGroupEvent {
  const p = person(e.by);
  const gm = g.members.find((x) => x.key === e.by);
  const j = e.kind === "session_done" ? judgement(e) : null;
  return {
    id: e.id, kind: e.kind, created_at: evAt(e),
    member: { id: gm?.id ?? `m-${g.id}-${e.by}`, display_name: p.name, is_me: e.by === "me" },
    session: e.kind === "session_done" && j ? { label: e.label ?? "", date: e.date ?? "", verdict: j.verdict, judging: j.judging } : null,
  };
}

export function mockGetGroupEvents(id: string, opts: { before?: string; limit?: number } = {}): GroupEventsResponse {
  const g = groupById(id);
  const all = visibleEvents(g);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 30));
  const from = opts.before ? all.findIndex((e) => e.id === opts.before) + 1 : 0;
  const page = all.slice(from, from + limit);
  return { events: page.map((e) => toApiEvent(g, e)), has_more: from + limit < all.length };
}

export function mockGetGroupEvent(id: string, eid: string): GroupEventDetailResponse {
  const g = groupById(id);
  const e = g.events.find((x) => x.id === eid);
  if (!e || e.kind !== "session_done") throw notFound("event not found");
  const members = new Set(g.members.map((x) => x.key));
  if (e.by !== "me" && !members.has(e.by)) throw notFound("event not found");
  if (e.by === "sara" && has("blocked")) { blockedApplied = true; throw notFound("event not found"); }
  const p = person(e.by);
  const shared = p.share();
  if (e.by !== "me" && !shared.events) throw notFound("event not found");
  const flags = e.by === "me" ? ALL_SHARED : shared;
  const acts = sessionActivities(p, e.date ?? "");
  const j = judgement(e);
  const prim = acts[0] ?? null;
  const rv = prim ? sharedReview(prim) : null;
  let review: ApiSharedReview | null = null;
  if (flags.reviews) {
    if (j.failed) review = { verdict: null, reminders: [], comment: null, source: "claude", failed: true, created_at: evAt(e), corrected_at: null };
    else if (!j.judging && rv) review = { ...rv, corrected_at: j.corrected ? evAt(e) : rv.corrected_at };
  }
  return {
    event: toApiEvent(g, e), shared: flags,
    activity: flags.runs && prim ? sharedActivity(prim) : null,
    segments: flags.runs ? acts.map(sharedActivity) : [],
    review,
  };
}

export function mockPutGroupSeen(id: string): GroupOkResponse {
  groupById(id).unread = 0;
  return { ok: true };
}

// ---- someone's plan (大家的課表) ----------------------------------------------------------------------------------------

export function mockGetMemberPlan(id: string, mid: string): MemberPlanResponse {
  goneIf(); // `gone` set while the page is open: picking another member then finds the group gone
  const g = groupById(id);
  const gm = g.members.find((x) => x.id === mid);
  if (!gm) throw notFound("member not found");
  const p = person(gm.key);
  const flags = gm.key === "me" ? ALL_SHARED : p.share();
  const plan = personPlan(p);
  const base = { member: { id: gm.id, display_name: p.name, is_me: gm.key === "me" }, shared: flags };
  if (!flags.plan || !plan) return { ...base, plan: null, weeks: [], sessions: [], activities: [] };
  if (gm.key === "me") refreshSegments();
  return {
    ...base,
    plan: { race_name: plan.plan.race_name, race_date: plan.plan.race_date, goal_time_sec: plan.plan.goal_time_sec },
    weeks: plan.weeks,
    sessions: plan.sessions.map((s) => ({
      id: s.id, scheduled_date: s.scheduled_date, week_no: s.week_no, phase: s.phase, label: s.label, type: s.type, content: s.content, note: s.note, target: s.target, target_distance_m: s.target_distance_m,
      target_pace_sec_km: s.target_pace_sec_km, target_pace_min_sec_km: s.target_pace_min_sec_km, target_pace_max_sec_km: s.target_pace_max_sec_km, target_hr_min: s.target_hr_min, target_hr_max: s.target_hr_max,
      brief: s.brief, skipped_at: s.skipped_at, superseded: s.superseded, moved_to_session_id: s.moved_to_session_id, moved_to_date: s.moved_to_date, moved_from_session_id: s.moved_from_session_id, moved_from_date: s.moved_from_date, counts_in_week_no: s.counts_in_week_no,
    })),
    activities: flags.runs ? plan.activities.filter((a) => a.match_status !== "ignored").map((a) => ({ ...sharedActivity(a), review: flags.reviews ? sharedReview(a) : null })) : [],
  };
}

// ---- membership, invites ----------------------------------------------------------------------------------------------

const goneIf = () => { if (has("gone")) { goneNow = true; throw notFound(); } };

export function mockPostGroupInvite(id: string): PostGroupInviteResponse {
  goneIf();
  const g = groupById(id);
  if (g.members.length >= 5) throw new ApiError(409, "group is full");
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
  g.invite = { expires_at: expires, uses_left: 5 - g.members.length };
  return { invite: { token: MOCK_TOKEN, expires_at: expires, uses_left: g.invite.uses_left } };
}

export function mockDeleteGroupInvite(id: string): GroupOkResponse {
  goneIf();
  groupById(id).invite = null;
  return { ok: true };
}

export function mockPostGroupLeave(id: string): GroupOkResponse {
  goneIf();
  const g = groupById(id);
  if (g.owner === "me") throw new ApiError(409, "owner cannot leave");
  gone.add(g.id);
  return { ok: true };
}

export function mockDeleteGroup(id: string): GroupOkResponse {
  goneIf();
  const g = groupById(id);
  if (g.owner !== "me") throw new ApiError(403, "not owner");
  gone.add(g.id);
  return { ok: true };
}

export function mockPostGroupMemberRemove(id: string, mid: string): GroupOkResponse {
  goneIf();
  const g = groupById(id);
  if (g.owner !== "me") throw new ApiError(403, "not owner");
  const gm = g.members.find((x) => x.id === mid);
  if (!gm) throw notFound("member not found");
  if (gm.key === "me") throw new ApiError(400, "bad request");
  g.members = g.members.filter((x) => x !== gm);
  g.events.unshift({ id: `e-${++eventSeq}`, kind: "left", by: gm.key, at: new Date().toISOString() });
  if (g.invite) g.invite.uses_left = 5 - g.members.length;
  return { ok: true };
}

const MOCK_TOKEN = "mock-invite-token-AbCdEfGhIjKlMnOpQrStUv012"; // 43 characters, like the api's
const INVITE_GROUP = { id: "g-spring", name: "春日組", race_name: "富士山マラソン", race_date: "2026-12-13", member_count: 2, invited_by: "Taro" };

function inviteState(): InviteState | "not_found" {
  return gsw().invite ?? (myGroups().length >= 3 ? "group_limit" : "ok");
}

export function mockGetInvite(_token: string): InvitePreviewResponse {
  const state = inviteState();
  if (state === "not_found") throw notFound("invite not found");
  if (state === "ok") return { state, group: INVITE_GROUP };
  if (state === "full") return { state, group: { ...INVITE_GROUP, member_count: 5 } };
  if (state === "already_member") return { state, group: { ...INVITE_GROUP, id: myGroups()[0]?.id ?? "g-fuji", name: myGroups()[0]?.name ?? "富士山組" } };
  return { state, group: null };
}

export function mockPostInviteAccept(_token: string): AcceptInviteResponse {
  const state = inviteState();
  if (state !== "ok") throw new ApiError(409, state);
  firstJoin();
  const now = new Date().toISOString();
  const g: MGroup = {
    id: INVITE_GROUP.id, name: INVITE_GROUP.name, race_name: INVITE_GROUP.race_name, race_date: INVITE_GROUP.race_date, created: "2026-10-30T09:00:00+09:00", owner: "taro",
    members: [{ id: "m-spring-me", key: "me", joined: now }, { id: "m-spring-taro", key: "taro", joined: "2026-10-30T09:00:00+09:00" }, { id: "m-spring-ken", key: "ken", joined: "2026-10-31T09:00:00+09:00" }],
    events: [{ id: `e-${++eventSeq}`, kind: "joined", by: "me", at: now }, { id: `e-${++eventSeq}`, kind: "joined", by: "ken", at: "2026-10-31T09:00:00+09:00" }, { id: `e-${++eventSeq}`, kind: "joined", by: "taro", at: "2026-10-30T09:00:00+09:00" }],
    unread: 0, invite: null,
  };
  extraGroups = [...extraGroups.filter((x) => x.id !== g.id), g];
  gone.delete(g.id);
  return { group: toApiGroup(g) };
}

// ---- my own switches ----------------------------------------------------------------------------------------------------

let myShareNow: ShareSettings | null = null;
const myShare = (): ShareSettings => (myShareNow ??= { ...DEFAULT_SHARE, ...gsw().myShare });
/** Was I in any group before this page load? (`groups: "none"` = never; the default 富士山組 = a user from before the first-join rule, like Wei and Sara.) */
let everMember: boolean | null = null;
let shareTouched = false;
const wasEverMember = (): boolean => (everMember ??= gsw().groups !== "none");
/** The api writes all five switches on, in the same transaction, the first time someone becomes a member; a row that exists is never touched (mock: a `myShare` knob, or a PUT /me/share, means the row exists). */
function firstJoin() {
  if (wasEverMember()) return;
  everMember = true;
  if (!shareTouched && !gsw().myShare) myShareNow = { ...ALL_SHARED };
}

export function mockGetShare(): ShareResponse {
  if (gsw().shareGetFail) throw new ApiError(500, "伺服器錯誤，稍後再試");
  return { share: { ...myShare() } };
}

export async function mockPutShare(body: PutShareRequest): Promise<ShareResponse> {
  await sleep(250); // long enough to see the switch wait for the answer
  if (gsw().shareFail) throw new ApiError(500, "伺服器錯誤，稍後再試");
  for (const [k, v] of Object.entries(body.share)) {
    if (!(k in DEFAULT_SHARE) || typeof v !== "boolean") throw new ApiError(400, "bad request");
  }
  myShareNow = { ...myShare(), ...body.share };
  shareTouched = true;
  return { share: { ...myShare() } };
}

// =====================================================================================================================
// ai-plan-generation (demo): the draft Woo writes from the intake form. In memory like everything above; `page.goto` resets it.
//
// Switches (`window.__mock = { … }`, set before the page loads, e.g. with addInitScript; the same object as the group switches).
//   draft         the newest draft (read once, when it is first needed):
//                   "none" (default)                        no draft: 今天／課表 show the entry (nomyplan = no plan at all; planFinished = the plan has ended)
//                   "pending-profile" | "pending-skeleton"  generating: reading Strava / the week structure (no thought yet)
//                   "pending-chunk"                         generating: chunk 1 of 3 is in (weeks 1〜4), Woo is on weeks 5〜8; his thought is there
//                   "walk"                                  from the first time the draft page asks: every 4 s profile → skeleton → chunk 1/3 → chunk 2/3 → ready
//                   "slow"                                  pending-chunk for ever (the 3-minute 比較久 line; use a fake clock)
//                   "ready"                                 10 weeks, 6 flags (2 on weeks, 4 on days); his thought has several sentences
//                   "ready-noflags" | "ready-many"          0 flags | 9 flags (8 + the whole-draft line: 還有 n 條 ›, the first line has no place)
//                   "ready-norecord" | "ready-importerr" | "ready-lastrace"     the 依據 line: no runs | Strava unreadable | + 上一場 line and its flag
//                   "ready-norecord-importerr"              no runs and Strava unreadable
//                   "failed"                                chunk 1 in (weeks 1〜4), validation_failed, can_resume
//                   "failed-early"                          the skeleton failed: no weeks, no thought, model_failed, can_resume
//                   "failed-exhausted"                      calls 12, calls_exhausted, no resume   "failed-stalled"   stalled, can_resume
//                   "expired-start"                         ready, but its start day (2 days ago) has passed: GET, latest and adopt all say expired
//                   "expired" | "discarded" | "adopted"     the draft page says so (the entry does not see them: latest answers null)
//                   "notfound"                              GET /plan-drafts/{id} answers 404
//   latestFail    404 (an api from before this) | 500     GET /plan-drafts/latest fails
//   latestDelay   ms: GET /plan-drafts/latest answers that much later (the entry's grey skeleton, before either answer is in)
//   pollFail      n: after the first reading of the draft, the next n readings fail (GET /plan-drafts/{id}); 1 = one failed poll, 3 = enough for the page to say so; then it recovers
//   pollFailError "network" (default: a TypeError like fetch's) | "500"
//   actionDelay   ms: send, adopt, resume and discard answer that much later (送出中… / 採用中… / 丟掉中… can be seen)
//   strava        false → GET /me has no Strava
//   planFinished  true → the demo plan's race_date is yesterday and its sessions end there (今天: 課表已結束，辛苦了。)
//   noRuns        true → GET /activities answers [] (the intake's second step: 最近 12 週沒有跑步紀錄)
//   draftPost     "generating" (409 + latest is that pending draft) | "limit" 429 | "off" 503 plan generation is off | "busy" 503 any other | "active" 409 | "strava" 409 | "fail" 500
//                 | "invalid" (400 distance_m …: back to step 1)       without it: 202, and the new draft walks like `walk`
//   adoptFail     "active" 409 | "busy" 503 | "state" (409 draft is expired, and the draft is expired from then on) | "fail" 500
//   resumeFail    "exhausted" | "limit" | "state" | "generating" | "active" | "expired" (each 409; the api's resume answers calls exhausted, resume limit, draft is <status>)           without it: 202, the draft is pending-chunk
// After 採用 GET /plan is the adopted draft's plan (starts next Monday: 課表還沒開始。) and `variant: "nomyplan"` no longer applies;
// after 不要這份 latest answers null. A draft sent from the form is built from the answers in it (any 4〜20 weeks).
// =====================================================================================================================

type DraftKind = "none" | "pending-profile" | "pending-skeleton" | "pending-chunk" | "walk" | "slow" | "ready" | "ready-noflags" | "ready-many" | "ready-norecord" | "ready-norecord-importerr" | "ready-importerr"
  | "ready-lastrace" | "failed" | "failed-early" | "failed-exhausted" | "failed-stalled" | "expired" | "expired-start" | "discarded" | "adopted" | "notfound";
interface DraftSwitches {
  draft?: DraftKind; latestFail?: 404 | 500; latestDelay?: number; actionDelay?: number; pollFail?: number; pollFailError?: "network" | "500"; strava?: boolean; planFinished?: boolean; noRuns?: boolean;
  draftPost?: "generating" | "limit" | "off" | "busy" | "active" | "strava" | "fail" | "invalid"; adoptFail?: "active" | "busy" | "state" | "fail"; resumeFail?: "exhausted" | "limit" | "state" | "generating" | "active" | "expired";
}
const dsw = (): DraftSwitches => (globalThis as unknown as { __mock?: DraftSwitches }).__mock ?? {};
const SERVER_ERROR_TEXT = "伺服器錯誤，稍後再試";

const f1 = (n: number) => n.toFixed(1);
const sundayOn = (iso: string) => addDays(iso, (7 - new Date(`${iso}T00:00:00Z`).getUTCDay()) % 7);
const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * A plan from an intake, the way Woo would lay it out: weeks cut at Mondays (the first from the start day, the last to the race), the long
 * run on the first of Sunday／Tuesday／Thursday／Saturday／Monday／Friday that is not a fixed rest day, tempo on the third run day, a
 * lighter week every fourth, two weeks of taper, the race on its day. `extraFri`: weeks (1-based) that get one more easy run on a Friday.
 */
const pacetxt = (sec: number) => pace(sec);
function genPlan(intake: PlanIntake, extraFri: number[] = []): { weeks: ApiDraftWeek[]; sessions: ApiDraftSession[] } {
  const g = intake.goals[0];
  const km = g.distance_m / 1000;
  const spans: { week_no: number; week_start: string; week_end: string }[] = [];
  for (let ws = intake.start_date; ws <= g.race_date; ) {
    const we = sundayOn(ws) < g.race_date ? sundayOn(ws) : g.race_date;
    spans.push({ week_no: spans.length + 1, week_start: ws, week_end: we });
    ws = addDays(we, 1);
  }
  const n = spans.length;
  const peak = Math.min(32, Math.max(8, Math.round(km * 0.75)));
  const easy = Math.min(10, Math.max(4, Math.round(peak * 0.4)));
  const tempoKm = Math.min(12, Math.max(4, Math.round(peak * 0.5)));
  const gp = g.target_time_sec ? Math.round(g.target_time_sec / km) : 390; // goal pace, sec/km
  const runDays = [0, 2, 4, 6, 1, 5, 3].filter((d) => !intake.fixed_rest_weekdays.includes(d)).slice(0, intake.days_per_week);
  const hard = (i: number) => i >= 1 && i % 4 !== 3 && i < n - 2;
  const longKm = (i: number) => {
    if (i >= n - 2) return Math.round(peak * 0.6);
    const base = peak * (0.55 + (0.45 * i) / Math.max(1, n - 3));
    return Math.round(i % 4 === 3 ? base * 0.6 : base);
  };
  const mk = (date: string, week_no: number, type: SessionType, label: string, content: string, note: string | null, km_: number | null, pace: [number, number] | null, hr: [number, number] | null): ApiDraftSession => ({
    date, week_no, type, label, content, note, target_distance_m: km_ == null ? null : Math.round(km_ * 1000),
    target_pace_sec_km: pace ? Math.round((pace[0] + pace[1]) / 2) : null, target_pace_min_sec_km: pace?.[0] ?? null, target_pace_max_sec_km: pace?.[1] ?? null,
    target_hr_min: hr?.[0] ?? null, target_hr_max: hr?.[1] ?? null,
    target: pace ? `${pacetxt(pace[0])}〜${pacetxt(pace[1])}${hr ? ` / 心拍 ${hr[0]}〜${hr[1]}` : ""}` : null, flags: [],
  });
  const sessions: ApiDraftSession[] = [];
  for (const w of spans) {
    const i = w.week_no - 1;
    for (let date = w.week_start; date <= w.week_end; date = addDays(date, 1)) {
      const dow = dowOf(date);
      const wk = w.week_no;
      const fixed = intake.fixed_rest_weekdays.includes(dow);
      if (date === g.race_date) {
        sessions.push(mk(date, wk, "race", "比賽", `${g.name} ${f1(km)} km`, g.target_time_sec ? `目標 ${duration(g.target_time_sec)}，前半不要衝。` : "完賽就好，前半不要衝。", km, [gp - 3, gp + 3], null));
      } else if (fixed) {
        sessions.push(mk(date, wk, "rest", "休息", "休息", `你說週${"日一二三四五六"[dow]}固定休息。`, null, null, null));
      } else if (date === addDays(g.race_date, -1) && runDays.includes(dow)) {
        sessions.push(mk(date, wk, "easy", "Easy", "Easy 3 km", "賽前一天，放鬆跑，順便確認裝備。", 3, [gp + 75, gp + 105], [130, 145]));
      } else if (runDays.includes(dow)) {
        const at = runDays.indexOf(dow);
        if (at === 0) {
          const L = longKm(i);
          sessions.push(mk(date, wk, "long", "Long", `Long ${L} km`, "慢慢跑，後段不要加速。", L, [gp + 45, gp + 75], [140, 155]));
        } else if (at === 2 && hard(i)) {
          sessions.push(mk(date, wk, "tempo", "Tempo", `2 km 熱身 + ${tempoKm - 4} km 節奏 + 2 km 緩和`, "節奏段用你的目標配速附近，感覺「有點喘但說得出短句」。", tempoKm, [gp - 10, gp + 5], [160, 172]));
        } else {
          const E = i >= n - 2 ? Math.max(3, easy - 2) : at === 3 ? Math.max(3, Math.round(easy * 0.8)) : easy;
          sessions.push(mk(date, wk, "easy", "Easy", `Easy ${E} km`, "對話配速，結束後還有餘力。", E, [gp + 75, gp + 105], [135, 150]));
        }
      } else if (dow === 5 && extraFri.includes(wk)) {
        sessions.push(mk(date, wk, "easy", "Easy", "Easy 3 km", "多一天輕鬆跑，讓腿熟悉頻率。", 3, [gp + 75, gp + 105], [135, 150]));
      } else if (dow === 1 && wk <= n - 2) {
        sessions.push(mk(date, wk, "rest", "肌力", "肌力", "肌力日：下肢與核心 30 分鐘，做完告訴 Woo。", null, null, null));
      } else {
        sessions.push(mk(date, wk, "rest", "休息", "休息", "完全休息，睡飽一點。", null, null, null));
      }
    }
  }
  const weeks: ApiDraftWeek[] = spans.map((w) => {
    const i = w.week_no - 1;
    const mine = sessions.filter((s) => s.week_no === w.week_no);
    const longest = Math.max(0, ...mine.filter((s) => s.type === "long").map((s) => (s.target_distance_m ?? 0) / 1000));
    const taper = n >= 5 && i >= n - 2;
    return {
      ...w, phase: taper ? "賽前期" : i < n * 0.4 ? "基礎期" : "建立期",
      focus: i === 0 ? "穩定跑量，先找回節奏" : taper ? (i === n - 1 ? "比賽週，保腿" : "賽前減量，強度留著量降下來") : i % 4 === 3 ? "減量週，讓身體吸收" : hard(i) ? "節奏跑 + 長跑漸進" : "輕鬆跑為主",
      km: Math.round(mine.reduce((t, s) => t + (s.target_distance_m ?? 0), 0) / 100) / 10, long_km: longest, key: longest ? `Long ${longest} km` : "比賽", taper, flags: [],
    };
  });
  return { weeks, sessions };
}

/** The few of the api's flags (01b §5.5) the demo can state from the days it laid out; the sentences are the api's. */
function drawFlags(weeks: ApiDraftWeek[], sessions: ApiDraftSession[], intake: PlanIntake, profile: ApiAthleteProfile): string[] {
  const runKm = (no: number) => sessions.filter((s) => s.week_no === no && s.type !== "rest" && s.type !== "race").reduce((t, s) => t + (s.target_distance_m ?? 0), 0) / 1000;
  const days = (no: number) => sessions.filter((s) => s.week_no === no && s.type !== "rest" && s.type !== "race").length;
  const last = weeks[weeks.length - 1]?.week_no;
  let total = 0;
  for (const w of weeks) {
    const prev = runKm(w.week_no - 1);
    if (prev > 0 && runKm(w.week_no) >= prev * 1.15) { w.flags.push(`這週 ${f1(runKm(w.week_no))} km，比上週多 ${Math.round((runKm(w.week_no) / prev - 1) * 100)}%`); total++; }
    if (w.taper && prev > 0 && runKm(w.week_no) > prev) { w.flags.push(`這週是減量週，卻比上週多 ${f1(runKm(w.week_no) - prev)} km`); total++; }
    if (w.week_no !== last && days(w.week_no) !== intake.days_per_week) { w.flags.push(`這週排 ${days(w.week_no)} 天，你說每週 ${intake.days_per_week} 天`); total++; }
  }
  let prevLong: ApiDraftSession | null = null;
  for (const s of sessions) {
    if (s.type !== "long") continue;
    const b = (s.target_distance_m ?? 0) / 1000;
    const a = profile.longest?.km ?? ((prevLong?.target_distance_m ?? 0) / 1000);
    if ((profile.longest || prevLong) && b - a >= 3) { s.flags.push(`比你目前最長多 ${f1(b - a)} km（${f1(a)} → ${f1(b)} km）`); total++; }
    if (prevLong && dayDiff(prevLong.date, s.date) < 6) { s.flags.push(`跟上一次長跑只隔 ${dayDiff(prevLong.date, s.date)} 天`); total++; }
    prevLong = s;
  }
  return total >= 8 ? ["旗標比較多，採用前看一下每週的量"] : [];
}

const DRAFT_PROFILE = (): ApiAthleteProfile => {
  const today = todayJst();
  const mon = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const km = [12, 15, 18, 0, 16, 20, 22, 18, 24, 20, 26, 19];
  return {
    from: addDays(mon, -77), to: today,
    weeks: km.map((k, i) => ({ week_start: addDays(mon, -7 * (11 - i)), runs: k ? Math.max(1, Math.round(k / 7)) : 0, km: k, longest_km: k ? Math.min(8, Math.round(k / 2.5)) : 0 })),
    last4: { runs_per_week: 3, km_per_week: 21.8 }, longest: { date: addDays(today, -20), km: 8, pace_sec_km: 430, avg_hr: 148 },
    avg_pace_sec_km: 425, avg_hr: 147, total_runs: 33, import_error: false,
    hr_zones: { lt140: 0.22, z140_155: 0.51, z155_170: 0.24, gte170: 0.03 }, pace_bands: { lt6: 0.04, p6_7: 0.31, p7_8: 0.52, gte8: 0.13 }, last_race: null,
  };
};

const THOUGHT = "你最近 12 週每週跑 3 次、約 22 km，最長一次 8 km，所以前幾週先把量穩住，不急著加速。第 5 週起長跑拉到 13 km 以上，是這份課表第一個比較硬的地方，其餘的週都在你現在的量上緩緩往上。每四週放一個輕鬆的週，最後兩週降量保腿。週三是你說的固定休息日，全部排休息；你提到的左膝，前幾週不排坡跑。";

function fixtureIntake(): PlanIntake {
  const start = nextMonday(todayJst());
  return {
    goals: [{ kind: "race", priority: "A", name: "新春ハーフ 2027", race_date: addDays(start, 69), distance_m: 21097, target_time_sec: 7140 }],
    days_per_week: 4, fixed_rest_weekdays: [3], experience: "finished", weekday_minutes: 60, notes: "左膝不舒服到月底", start_date: start,
  };
}

interface DraftCell { n: number; kind: DraftKind; intake: PlanIntake; walkAt: number | null; adoptedPlanId: string | null }
let draftCell: DraftCell | null | undefined; // undefined: not read yet; null: no draft
let draftSeq = 0;
let adoptedPlan: PlanResponse | null = null;
const nowIso = () => new Date().toISOString();

function draftCellNow(): DraftCell | null {
  if (draftCell === undefined) {
    const kind = dsw().draft ?? "none";
    const intake = fixtureIntake();
    if (kind === "expired-start") intake.start_date = addDays(todayJst(), -2); // a ready draft whose start day went by while it waited
    draftCell = kind === "none" ? null : { n: ++draftSeq, kind, intake, walkAt: null, adoptedPlanId: null };
  }
  return draftCell;
}

/** The walk's kind at this moment: profile → skeleton → chunk 1/3 → chunk 2/3 → ready, 4 s each. */
function walkKind(c: DraftCell): DraftKind {
  if (c.walkAt == null) return "pending-profile";
  const step = Math.floor((Date.now() - c.walkAt) / 4000);
  return step <= 0 ? "pending-profile" : step === 1 ? "pending-skeleton" : step === 2 ? "pending-chunk" : step === 3 ? "pending-chunk" : "ready";
}

/** The draft the cell stands for right now, shaped like GET /plan-drafts/{id}. */
function draftOf(c: DraftCell): ApiPlanDraft {
  const kind = c.kind === "walk" ? walkKind(c) : c.kind === "slow" ? "pending-chunk" : c.kind;
  const walkStep = c.kind === "walk" && c.walkAt != null ? Math.floor((Date.now() - c.walkAt) / 4000) : 0;
  const plan = genPlan(c.intake, kind === "ready-many" ? [2, 7] : [7]); // week 7 gets a fifth run (a week flag); `ready-many` one in week 2 too
  let profile: ApiAthleteProfile | null = DRAFT_PROFILE();
  if (kind === "ready-norecord" || kind === "ready-norecord-importerr") profile = { ...profile, weeks: profile.weeks.map((w) => ({ ...w, runs: 0, km: 0, longest_km: 0 })), last4: { runs_per_week: 0, km_per_week: 0 }, longest: null, avg_pace_sec_km: null, avg_hr: null, total_runs: 0, hr_zones: null, pace_bands: null };
  if (kind === "ready-importerr" || kind === "ready-norecord-importerr") profile = { ...profile, import_error: true };
  if (kind === "ready-lastrace") profile = { ...profile, last_race: { name: "富士山マラソン", date: addDays(todayJst(), -5), distance_m: 42195, actual_time_sec: 17480, days_ago: 5 } };

  const total = plan.weeks.length;
  const chunksTotal = Math.ceil(total / 4);
  let status: ApiPlanDraft["status"] = "ready", stage: ApiPlanDraft["stage"] = null, done = chunksTotal, withSkeleton = true, sessions = plan.sessions, flagsOn = true;
  let error: string | null = null, canResume = false, calls = chunksTotal + 1;
  if (kind === "pending-profile") { status = "pending"; stage = "profile"; done = 0; withSkeleton = false; profile = null; sessions = []; flagsOn = false; calls = 0; }
  else if (kind === "pending-skeleton") { status = "pending"; stage = "skeleton"; done = 0; withSkeleton = false; sessions = []; flagsOn = false; calls = 0; }
  else if (kind === "pending-chunk") { status = "pending"; stage = "chunk"; done = c.kind === "walk" ? Math.max(1, Math.min(walkStep - 1, chunksTotal - 1)) : 1; sessions = plan.sessions.filter((s) => s.week_no <= done * 4); flagsOn = false; calls = done + 1; }
  else if (kind === "failed") { status = "failed"; done = 1; sessions = plan.sessions.filter((s) => s.week_no <= 4); flagsOn = false; error = "Woo 排的格式沒過檢查"; canResume = true; calls = 5; }
  else if (kind === "failed-early") { status = "failed"; done = 0; withSkeleton = false; sessions = []; flagsOn = false; error = "Woo 這次沒有回完"; canResume = true; calls = 2; }
  else if (kind === "failed-exhausted") { status = "failed"; done = 2; sessions = plan.sessions.filter((s) => s.week_no <= 8); flagsOn = false; error = "這份用掉的次數到上限了"; calls = 12; }
  else if (kind === "failed-stalled") { status = "failed"; done = 1; sessions = plan.sessions.filter((s) => s.week_no <= 4); flagsOn = false; error = "產生中斷了"; canResume = true; calls = 3; }
  else if (kind === "expired" || kind === "expired-start") status = "expired";
  else if (kind === "discarded") status = "discarded";
  else if (kind === "adopted") status = "adopted";

  const weeks = withSkeleton ? plan.weeks : [];
  let flags: string[] = [];
  if (flagsOn && kind !== "ready-noflags") {
    flags = drawFlags(weeks, sessions, c.intake, profile ?? DRAFT_PROFILE());
    if (kind === "ready-lastrace") {
      const first = sessions.find((s) => s.type === "long" || s.type === "tempo");
      if (first) first.flags.unshift(`${mdPlain((profile as ApiAthleteProfile).last_race!.date)} 剛比完全馬，這天就有${first.label}`);
    }
  }
  const from = done * 4 + 1;
  return {
    id: `mock-draft-${c.n}`, mode: "new", status, stage,
    progress: { chunks_done: done, chunks_total: stage === "profile" || stage === "skeleton" ? null : chunksTotal, from_week: stage === "chunk" ? from : null, to_week: stage === "chunk" ? Math.min(from + 3, total) : null },
    intake: c.intake, profile, summary: withSkeleton ? THOUGHT : null, weeks, sessions, flags,
    calls, max_calls: 12, can_resume: canResume, error, adopted_plan_id: kind === "adopted" ? (c.adoptedPlanId ?? "mock-plan-new") : null,
    created_at: nowIso(), updated_at: nowIso(),
  };
}

const MOCK_NEW_PLAN_ID = "mock-plan-new";

export async function mockPostPlanDraft(body: PostPlanDraftRequest): Promise<PlanDraftResponse> {
  if (dsw().actionDelay) await sleep(dsw().actionDelay as number);
  const sw = dsw().draftPost;
  if (sw === "generating") {
    const c = draftCellNow();
    if (!c || !(c.kind.startsWith("pending") || c.kind === "walk" || c.kind === "slow")) draftCell = { n: ++draftSeq, kind: "pending-chunk", intake: fixtureIntake(), walkAt: null, adoptedPlanId: null };
    throw new ApiError(409, "generating");
  }
  if (sw === "limit") throw new ApiError(429, "daily limit");
  if (sw === "off") throw new ApiError(503, SERVER_ERROR_TEXT, "plan generation is off");
  if (sw === "busy") throw new ApiError(503, SERVER_ERROR_TEXT, "database starting, retry shortly");
  if (sw === "active") throw new ApiError(409, "has active plan");
  if (sw === "strava") throw new ApiError(409, "strava not connected");
  if (sw === "fail") throw new ApiError(500, SERVER_ERROR_TEXT);
  if (sw === "invalid") throw new ApiError(400, "distance_m must be 1000-100000");
  draftCell = { n: ++draftSeq, kind: "walk", intake: body.intake, walkAt: Date.now(), adoptedPlanId: null };
  return { draft: draftOf(draftCell) };
}

export async function mockGetLatestPlanDraft(): Promise<LatestPlanDraftResponse> {
  if (dsw().latestDelay) await sleep(dsw().latestDelay as number);
  if (dsw().latestFail === 404) throw new ApiError(404, "not found");
  if (dsw().latestFail === 500) throw new ApiError(500, SERVER_ERROR_TEXT);
  const c = draftCellNow();
  if (!c || ["expired", "expired-start", "discarded", "adopted", "notfound"].includes(c.kind)) return { draft: null };
  return { draft: draftOf(c) };
}

let draftReads = 0;
export function mockGetPlanDraft(id: string): PlanDraftResponse {
  draftReads += 1;
  if (dsw().pollFail && draftReads > 1 && draftReads <= 1 + dsw().pollFail!) {
    if (dsw().pollFailError === "500") throw new ApiError(500, SERVER_ERROR_TEXT);
    throw new TypeError("Failed to fetch");
  }
  const c = draftCellNow();
  if (!c || c.kind === "notfound" || id !== `mock-draft-${c.n}`) throw new ApiError(404, "draft not found");
  if (c.kind === "walk" && c.walkAt == null) c.walkAt = Date.now(); // the walk starts when the draft page first asks
  return { draft: draftOf(c) };
}

export async function mockAdoptPlanDraft(id: string): Promise<AdoptPlanDraftResponse> {
  if (dsw().actionDelay) await sleep(dsw().actionDelay as number);
  const c = draftCellNow();
  if (!c || id !== `mock-draft-${c.n}`) throw new ApiError(404, "draft not found");
  if (c.kind === "adopted" && adoptedPlan) return { plan_id: MOCK_NEW_PLAN_ID };
  const sw = dsw().adoptFail;
  if (sw === "active") throw new ApiError(409, "has active plan");
  if (sw === "busy") throw new ApiError(503, SERVER_ERROR_TEXT, "busy");
  if (sw === "fail") throw new ApiError(500, SERVER_ERROR_TEXT);
  if (sw === "state") { c.kind = "expired"; throw new ApiError(409, "draft is expired"); }
  const d = draftOf(c);
  if (d.status !== "ready") throw new ApiError(409, `draft is ${d.status}`);
  const p = draftToPlanResponse(d);
  adoptedPlan = {
    ...p,
    plan: { ...p.plan, id: MOCK_NEW_PLAN_ID, user_id: MOCK_USER_ID, status: "active" },
    sessions: p.sessions.map((s) => ({ ...s, id: `s-new-${s.scheduled_date}`, plan_id: MOCK_NEW_PLAN_ID })),
  };
  c.kind = "adopted";
  c.adoptedPlanId = MOCK_NEW_PLAN_ID;
  return { plan_id: MOCK_NEW_PLAN_ID };
}

export async function mockResumePlanDraft(id: string): Promise<PlanDraftResponse> {
  if (dsw().actionDelay) await sleep(dsw().actionDelay as number);
  const c = draftCellNow();
  if (!c || id !== `mock-draft-${c.n}`) throw new ApiError(404, "draft not found");
  const sw = dsw().resumeFail;
  if (sw === "exhausted") throw new ApiError(409, "calls exhausted");
  if (sw === "limit") throw new ApiError(409, "resume limit");
  if (sw === "state") throw new ApiError(409, "draft is pending");
  if (sw === "generating") throw new ApiError(409, "generating");
  if (sw === "active") throw new ApiError(409, "has active plan");
  if (sw === "expired") throw new ApiError(409, "draft is expired");
  if (!c.kind.startsWith("failed")) throw new ApiError(409, `draft is ${draftOf(c).status}`);
  c.kind = "pending-chunk";
  return { draft: draftOf(c) };
}

export async function mockDiscardPlanDraft(id: string): Promise<PlanDraftOkResponse> {
  if (dsw().actionDelay) await sleep(dsw().actionDelay as number);
  const c = draftCellNow();
  if (!c || id !== `mock-draft-${c.n}`) throw new ApiError(404, "draft not found");
  if (c.kind === "adopted") throw new ApiError(409, "draft is adopted");
  c.kind = "discarded";
  return { ok: true };
}
