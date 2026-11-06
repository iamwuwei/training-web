// ai-plan-generation, the web side: the fixed sentences (02-設計 §9, word for word), the pure functions the entry, the intake form
// and the draft page share, and the one hook that reads the newest draft. Nothing here sends anything except `useLatestDraft`
// (GET /me and GET /plan-drafts/latest, once each, no polling).

import { useEffect, useState } from "react";
import type { ApiAthleteProfile, ApiPlanDraft, ApiSession, MeResponse, PlanGoalInput, PlanIntake, PlanResponse } from "../types/api";
import { ApiError, getLatestPlanDraft, getMe } from "./api";
import { addDays, dayDiff } from "./date";
import { duration, km, pace } from "./format";
import { mdDowPlain, mdPlain, SEND_FAILED } from "./groups";

// ---- the sentences ----------------------------------------------------------------------------------------------------------

export const DRAFT_TEXT = {
  entry: {
    noneTitle: "還沒有課表",
    noneSub: "回答幾個問題（約一分鐘），Woo 會看你 Strava 最近 12 週，排一份到比賽日的課表。先給你看，你採用才生效。",
    noneCta: "請 Woo 幫我排課表",
    noneHint: "比賽日要在 4〜20 週後；一天最多排 3 份。",
    stravaSub: "先在設定頁連結 Strava，Woo 要看你最近的跑步",
    stravaCta: "去設定",
    pendingTitle: "Woo 在排你的課表",
    pendingSub: "一般 1〜3 分鐘，可以先離開，排好會在這裡。",
    pendingCta: "看進度",
    readyTitle: "Woo 排好了",
    readySub: (name: string, weeks: number) => `${name} · ${weeks} 週。看過覺得可以再採用，7 天內有效。`,
    readyCta: "去看",
    failedTitle: "上次沒排成功",
    failedSub: "排好的週還在，可以從斷掉的地方繼續。",
    failedSubNoResume: "這份不能再繼續了，重新開始一份。",
    failedCta: "看看",
    apiMissing: "還沒有課表。",
  },
  finished: {
    next: "排下一份課表 ›",
    pending: "Woo 在排下一份 · 看進度 ›",
    ready: "Woo 排好了 · 去看 ›",
    failed: "上次沒排成功 · 看看 ›",
  },
  form: {
    title: "請 Woo 排課表",
    carried: "帶著上一份的答案。改完按「下一步」，會排一份新的（算今天的一份）。",
    next: "下一步",
    namePlaceholder: "例如 東京マラソン 2027",
    otherUnit: "km",
    daysHint: "這是你的偏好，Woo 會盡量照；不合的週會標出來給你看。",
    fixedHint: "沒有就不用勾。勾了的那天一定排休息。",
    minutesHint: "週末的長跑不受這個限制。",
    notesPlaceholder: "例如：左膝不舒服到月底；長跑想排週六",
    notesHint: "傷痛、時間限制、喜歡的排法都可以寫。Woo 會照你的狀況調整。",
    anyMinutes: "不限",
  },
  summary: {
    title: "Woo 會看到的你",
    woo: "排之前我會看這些。數字不對的話，先到 Strava 確認紀錄有同步。",
    histTitle: "Strava 最近 12 週",
    histFoot: "這是 app 裡目前有的紀錄。按「產生課表」後 Woo 會再讀一次 Strava 最近 12 週，以那時的為準。",
    noneTitle: "最近 12 週沒有跑步紀錄",
    noneSub: "這是 app 裡目前有的。產生時 Woo 會再讀一次 Strava；還是沒有的話，Woo 會從零開始排、第一週保守。",
    answers: "你的答案",
    edit: "改答案",
    go: "產生課表",
    sending: "送出中…",
    foot: "一般 1〜3 分鐘。一天最多排 3 份。",
  },
  wait: {
    profile: "Woo 在看你的 Strava",
    skeleton: "Woo 在排整體架構",
    fallback: "Woo 在排你的課表",
    slow: "比較久，再等一下或稍後回來",
    note: "一般 1〜3 分鐘。可以先離開，回來會接著顯示。",
    again: "再看一次",
    discard: "不要這份",
  },
  preview: {
    whyK: "Woo 的思路",
    full: "全文 ›",
    none: "0 條提醒",
    noneSub: "沒有特別要看的地方。",
    note: "琥珀色是 Woo 排得比平常硬、或跟你說的不一樣的地方——只是提醒，不擋採用。採用後想改，跟 Woo 說就好。",
    adopt: "採用這份",
    adopting: "採用中…",
    edit: "改答案再排",
  },
  discard: {
    title: "不要這份課表？",
    text: "丟掉就找不回來了。這份仍算在今天的 3 份裡。",
    action: "丟掉",
    busy: "丟掉中…",
  },
  end: {
    failedTitle: "這次沒排成功",
    resumeNote: "「繼續」不算新的一份；一份最多繼續 2 次。",
    restart: "重新開始",
    resume: "繼續",
    resumeBusy: "送出中…",
    resumeDenied: "這份不能再繼續了，重新開始一份",
    noResume: "這份不能再繼續了，重新開始一份。",
    exhausted: "重新開始一份，答案會帶過去。",
    expiredTitle: "這份已經過期了",
    expiredSub: "排好 7 天沒採用就失效。重新開始一份，Woo 會用最新的紀錄排。",
    discardedTitle: "這份已經丟掉了",
    discardedSub: "要的話重新排一份。",
    goToday: "回今天 ›",
    notFoundTitle: "找不到這份課表",
    notFoundSub: "可能已經被丟掉，或網址不完整。",
  },
} as const;

/** The api's four fixed lines for a failed draft (`ApiPlanDraft.error`), as web needs to recognise one: calls_exhausted changes the follow-up. */
export const ERROR_CALLS_EXHAUSTED = "這份用掉的次數到上限了";

// ---- api codes → sentences (02 §9 送出被拒／採用被拒／失敗) ------------------------------------------------------------------------

/** A rejected `POST /plan-drafts`. The api's 503 is "plan generation is off" (request() drops a 5xx body, the status is what is left). */
export function submitErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return SEND_FAILED;
  if (e.status === 503) return "這個功能目前沒開放";
  switch (e.message) {
    case "generating": return "Woo 正在排一份了，先看那份";
    case "daily limit": return "今天已經排了 3 次，明天再來";
    case "has active plan": return "你現在的課表還在進行，整份重排的功能之後開放";
    case "strava not connected": return "先在設定頁連結 Strava，Woo 要看你最近的跑步";
    default: return SEND_FAILED;
  }
}

/** The link that goes with a rejection, if one does. */
export function submitErrorLink(e: unknown): "draft" | "settings" | null {
  if (!(e instanceof ApiError) || e.status === 503) return null;
  return e.message === "generating" ? "draft" : e.message === "strava not connected" ? "settings" : null;
}

/** The field a 400 of POST /plan-drafts belongs to (the other 400s say nothing about a field: 送出失敗，再試一次). */
export function fieldOfCode(code: string): keyof IntakeForm | null {
  if (code === "name is empty or too long") return "name";
  if (code === "race_date must be YYYY-MM-DD") return "race_date";
  if (code === "distance_m must be 1000-100000") return "otherKm";
  if (code === "target_time_sec must give 2:30-12:00 per km") return "hasTarget";
  if (code === "race is less than 4 weeks away" || code === "race is more than 20 weeks away" || code === "start_date must be today to today + 14") return "start_date";
  if (code.startsWith("fixed_rest_weekdays must be")) return "fixed_rest_weekdays";
  return null;
}

/** A rejected adopt. `draft is …` is not a sentence: the page reads the draft again and draws that state. */
export function adoptErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503) return "現在比較忙，再按一次";
    if (e.message === "has active plan") return "你已經有一份進行中的課表，這份沒有採用";
  }
  return SEND_FAILED;
}
export const isDraftStateError = (e: unknown) => e instanceof ApiError && e.status === 409 && e.message.startsWith("draft is ");

/** A rejected 繼續 (409 `calls exhausted` | `resume limit` | `draft is …`). */
export function resumeErrorText(e: unknown): string {
  return e instanceof ApiError && e.status === 409 ? DRAFT_TEXT.end.resumeDenied : SEND_FAILED;
}

// ---- the intake form -------------------------------------------------------------------------------------------------------

export type DistanceChoice = "42195" | "21097" | "10000" | "5000" | "other";

/** The form as strings (what the inputs hold); `toIntake` turns it into the api's PlanIntake. */
export interface IntakeForm {
  name: string;
  race_date: string;
  distance: DistanceChoice;
  otherKm: string;
  hasTarget: boolean;
  h: string; m: string; s: string;
  days_per_week: number;
  fixed_rest_weekdays: number[];
  weekday_minutes: PlanIntake["weekday_minutes"];
  start_date: string;
  experience: PlanIntake["experience"];
  notes: string;
}

export type FormErrors = Partial<Record<keyof IntakeForm, string>>;

/** Fields in the order they are on the page: the first with an error is the one scrolled to. */
export const FIELD_ORDER: (keyof IntakeForm)[] = ["name", "race_date", "otherKm", "hasTarget", "fixed_rest_weekdays", "start_date"];

export const DISTANCES: { value: DistanceChoice; label: string }[] = [
  { value: "5000", label: "5 km" }, { value: "10000", label: "10 km" }, { value: "21097", label: "半馬" }, { value: "42195", label: "全馬" }, { value: "other", label: "其他" },
];

/** Monday first, as the week is read in Japan; the values are `Date.getDay()` (0 = Sunday). */
export const WEEKDAYS: { value: number; label: string; aria: string }[] = [1, 2, 3, 4, 5, 6, 0].map((value) => ({ value, label: "日一二三四五六"[value], aria: `週${"日一二三四五六"[value]}` }));
export const MINUTES: { value: PlanIntake["weekday_minutes"]; label: string }[] = [
  { value: 30, label: "30 分" }, { value: 45, label: "45 分" }, { value: 60, label: "60 分" }, { value: 90, label: "90 分" }, { value: null, label: "不限" },
];
export const EXPERIENCES: { value: PlanIntake["experience"]; label: string }[] = [
  { value: "first", label: "第一次跑" }, { value: "finished", label: "完賽過" }, { value: "several", label: "跑過好幾場" },
];

/** The first Monday after `today` ('YYYY-MM-DD'); a Monday gives the next one. */
export function nextMonday(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (8 - dow) % 7 || 7);
}

export function defaultForm(today: string): IntakeForm {
  return { name: "", race_date: "", distance: "42195", otherKm: "", hasTarget: false, h: "", m: "", s: "", days_per_week: 4, fixed_rest_weekdays: [], weekday_minutes: null, start_date: nextMonday(today), experience: "finished", notes: "" };
}

/** The distance in metres the form holds, or null when it is not one the api takes. */
export function formDistanceM(f: Pick<IntakeForm, "distance" | "otherKm">): number | null {
  if (f.distance !== "other") return Number(f.distance);
  const km = Number(f.otherKm);
  const m = Math.round(km * 1000);
  return f.otherKm.trim() !== "" && Number.isFinite(km) && m >= 1000 && m <= 100_000 ? m : null;
}

const wholeNumber = (t: string) => /^\d{1,3}$/.test(t.trim());

/** Seconds of the target time the form holds; null when 時 or 分 is empty or not a number, or the total is 0 (秒 may stay empty). */
export function formTargetSec(f: Pick<IntakeForm, "h" | "m" | "s">): number | null {
  if (!wholeNumber(f.h) || !wholeNumber(f.m) || (f.s.trim() !== "" && !wholeNumber(f.s))) return null;
  const sec = Number(f.h) * 3600 + Number(f.m) * 60 + (f.s.trim() === "" ? 0 : Number(f.s));
  return sec > 0 ? sec : null;
}

/** Weeks from start to race the way the form says it (`ceil((race − start + 1) / 7)`); only a hint, the api cuts weeks at Mondays. */
export function weeksBetween(start: string, race: string): number {
  return Math.ceil((dayDiff(start, race) + 1) / 7);
}

/** 6:38 for a target of 4:40:00 over 42.195 km. */
export function targetPace(sec: number, distanceM: number): number {
  return Math.round(sec / (distanceM / 1000));
}

/** Check the form before it is sent (02 §9 表單驗證). One sentence per field; the api checks the same again. */
export function validateForm(f: IntakeForm, today: string): FormErrors {
  const e: FormErrors = {};
  if (!f.name.trim()) e.name = "請寫比賽名稱";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.race_date)) e.race_date = "請選比賽日";
  const dist = formDistanceM(f);
  if (dist == null) e.otherKm = "距離請填 1〜100 km";
  if (f.hasTarget) {
    const sec = formTargetSec(f);
    if (sec == null) e.hasTarget = "請填目標時間（時、分；秒可以不填）";
    else if (dist != null) {
      const p = targetPace(sec, dist);
      // the api checks `target_time_sec / km` unrounded; a rounded 150 or 720 would let through what it refuses
      const exact = sec / (dist / 1000);
      if (exact < 150 || exact > 720) e.hasTarget = `這個目標換算配速 ${pace(p)} /km，要在 2:30〜12:00 之間`;
    }
  }
  if (f.fixed_rest_weekdays.length > 7 - f.days_per_week) e.fixed_rest_weekdays = `每週練 ${f.days_per_week} 天，固定不能練的最多勾 ${7 - f.days_per_week} 天`;
  const last = addDays(today, 14);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start_date) || f.start_date < today || f.start_date > last) {
    e.start_date = `開始日要在今天到 ${mdPlain(last)} 之間`;
  } else if (!e.race_date) {
    const days = dayDiff(f.start_date, f.race_date);
    if (days < 28) e.start_date = "離比賽不到 4 週，Woo 一次排 4 到 20 週的課表";
    else if (days > 140) {
      // moving the start day is enough when it can still be today + 14 at the latest
      e.start_date = addDays(f.race_date, -140) <= last
        ? `離比賽超過 20 週，開始日要選 ${mdPlain(addDays(f.race_date, -140))} 以後`
        : `離比賽超過 20 週，${mdPlain(addDays(f.race_date, -154))} 以後再來排`;
    }
  }
  return e;
}

export function toIntake(f: IntakeForm): PlanIntake {
  const goal: PlanGoalInput = {
    kind: "race", priority: "A", name: f.name.trim(), race_date: f.race_date,
    distance_m: formDistanceM(f) ?? 0,
    target_time_sec: f.hasTarget ? formTargetSec(f) : null,
  };
  return {
    goals: [goal], days_per_week: f.days_per_week, fixed_rest_weekdays: [...f.fixed_rest_weekdays].sort((a, b) => a - b),
    experience: f.experience, weekday_minutes: f.weekday_minutes, notes: f.notes.trim(), start_date: f.start_date,
  };
}

/** An intake the api accepted before (the draft's, or the one kept for 改答案再排) back into form strings. */
export function fromIntake(i: PlanIntake): IntakeForm {
  const g = i.goals[0];
  const known = [42195, 21097, 10000, 5000].find((d) => d === g.distance_m);
  const t = g.target_time_sec;
  return {
    name: g.name, race_date: g.race_date,
    distance: known ? (String(known) as DistanceChoice) : "other", otherKm: known ? "" : String(g.distance_m / 1000),
    hasTarget: t != null, h: t != null ? String(Math.floor(t / 3600)) : "", m: t != null ? String(Math.floor((t % 3600) / 60)) : "", s: t != null && t % 60 ? String(t % 60) : "",
    days_per_week: i.days_per_week, fixed_rest_weekdays: [...i.fixed_rest_weekdays], weekday_minutes: i.weekday_minutes,
    start_date: i.start_date, experience: i.experience, notes: i.notes,
  };
}

/** The race the page's address asks for (`?race_name=&race_date=&distance_m=`); only what is valid is taken. */
export function formFromParams(params: URLSearchParams, today: string): IntakeForm | null {
  const name = params.get("race_name"), date = params.get("race_date"), dist = Number(params.get("distance_m"));
  if (!name && !date && !params.get("distance_m")) return null;
  const f = defaultForm(today);
  if (name) f.name = [...name].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").trim().slice(0, 40);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) f.race_date = date;
  if (Number.isInteger(dist) && dist >= 1000 && dist <= 100_000) {
    if ([42195, 21097, 10000, 5000].includes(dist)) f.distance = String(dist) as DistanceChoice;
    else { f.distance = "other"; f.otherKm = String(dist / 1000); }
  }
  return f;
}

// ---- the answers to come back to (改答案再排, 重新開始): sessionStorage, read once ------------------------------------------------------

const INTAKE_KEY = "training-web.intake";

export function saveIntake(i: PlanIntake): void {
  try { sessionStorage.setItem(INTAKE_KEY, JSON.stringify(i)); } catch { /* storage blocked: the form just starts with its defaults */ }
}

/** The kept answers; a broken value is nothing. The page calls `clearIntake` once it has them (reading twice, as React may in development, must give the same). */
export function loadIntake(): PlanIntake | null {
  try {
    const raw = sessionStorage.getItem(INTAKE_KEY);
    if (raw == null) return null;
    const i = JSON.parse(raw) as PlanIntake;
    return Array.isArray(i?.goals) && i.goals[0] && typeof i.goals[0].name === "string" && Array.isArray(i.fixed_rest_weekdays) ? i : null;
  } catch {
    return null;
  }
}

export function clearIntake(): void {
  try { sessionStorage.removeItem(INTAKE_KEY); } catch { /* storage blocked */ }
}

// ---- the draft ---------------------------------------------------------------------------------------------------------------

/** How many weeks the draft will have: the skeleton's, until it is in the form's own count. */
export function planWeeksCount(intake: PlanIntake): number {
  return Math.max(1, weeksBetween(intake.start_date, intake.goals[0].race_date));
}
export const draftWeeks = (d: ApiPlanDraft) => d.weeks.length || planWeeksCount(d.intake);
export const draftName = (d: ApiPlanDraft) => d.intake.goals[0].name;

/**
 * The draft as the plan page's own shape, so `buildPlanView`, `WeekBars` and `DayRow` can draw it. READ-ONLY PROJECTION like
 * member-plan.ts: the result is never sent anywhere (ids are made up, `status` is "draft").
 */
export function draftToPlanResponse(d: ApiPlanDraft): PlanResponse {
  const g = d.intake.goals[0];
  const phase = new Map(d.weeks.map((w) => [w.week_no, w.phase]));
  const sessions: ApiSession[] = d.sessions.map((s) => ({
    id: `draft-${s.date}`, plan_id: d.id, scheduled_date: s.date, week_no: s.week_no, phase: phase.get(s.week_no) ?? null,
    label: s.label, type: s.type, content: s.content, note: s.note, target: s.target, target_distance_m: s.target_distance_m,
    target_pace_sec_km: s.target_pace_sec_km, target_pace_min_sec_km: s.target_pace_min_sec_km, target_pace_max_sec_km: s.target_pace_max_sec_km,
    target_hr_min: s.target_hr_min, target_hr_max: s.target_hr_max, brief: null, skipped_at: null, version: 1, superseded: false,
    moved_to_session_id: null, moved_to_date: null, moved_from_session_id: null, moved_from_date: null, counts_in_week_no: s.week_no,
  }));
  return {
    coach_unread: 0, coach_checkin_open: false, coach_ask_kind: null,
    plan: { id: d.id, user_id: "", race_name: g.name, race_date: g.race_date, goal_time_sec: g.target_time_sec, days_per_week: d.intake.days_per_week, status: "draft" },
    weeks: d.weeks.map(({ week_no, week_start, week_end, phase: p, focus }) => ({ week_no, week_start, week_end, phase: p, focus })),
    sessions, activities: [], unassigned: [], routines: [], constraints: [], groups_unread: 0,
  };
}

/** The first line while the draft is made (02 §4). */
export function stageText(d: ApiPlanDraft): string {
  if (d.stage === "profile") return DRAFT_TEXT.wait.profile;
  if (d.stage === "skeleton") return DRAFT_TEXT.wait.skeleton;
  if (d.stage === "chunk") {
    const total = draftWeeks(d);
    const from = d.progress.from_week ?? Math.min(d.progress.chunks_done * 4 + 1, total);
    const to = d.progress.to_week ?? Math.min(from + 3, total);
    return `Woo 在排第 ${from}〜${to} 週`;
  }
  return DRAFT_TEXT.wait.fallback;
}

/** The bar while the draft is made: profile 5, skeleton 15, then 20 + 80 × chunks done / chunks. */
export function progressPct(d: ApiPlanDraft): number {
  if (d.stage === "profile") return 5;
  if (d.stage === "skeleton") return 15;
  if (d.stage === "chunk") {
    const { chunks_done: done, chunks_total: total } = d.progress;
    return Math.round(20 + 80 * (total ? Math.min(1, done / total) : 0));
  }
  return 5;
}

/** 「共 N 週」 and, once chunks are in, 「 · 第 1〜k 週排好了」. */
export function weeksLine(d: ApiPlanDraft): string {
  const n = draftWeeks(d);
  const k = Math.min(d.progress.chunks_done * 4, n);
  return `共 ${n} 週${k > 0 ? ` · 第 1〜${k} 週排好了` : ""}`;
}

/** What a draft that stopped has behind it: weeks 1〜k are in (k is 0 before the first chunk). */
export function weeksDone(d: ApiPlanDraft): number {
  return Math.min(d.progress.chunks_done * 4, d.weeks.length);
}

export interface FlagItem { text: string; week_no: number | null; date: string | null }

/** Every flag in the order the list shows: the whole draft's, then week by week (the week's own lines, then its days' by date). */
export function flagList(d: ApiPlanDraft): FlagItem[] {
  const out: FlagItem[] = d.flags.map((text) => ({ text, week_no: null, date: null }));
  const weekNos = [...new Set([...d.weeks.map((w) => w.week_no), ...d.sessions.map((s) => s.week_no)])].sort((a, b) => a - b);
  for (const n of weekNos) {
    for (const text of d.weeks.find((w) => w.week_no === n)?.flags ?? []) out.push({ text, week_no: n, date: null });
    for (const s of d.sessions.filter((x) => x.week_no === n).sort((a, b) => a.date.localeCompare(b.date))) {
      for (const text of s.flags ?? []) out.push({ text, week_no: n, date: s.date });
    }
  }
  return out;
}

/** Weeks that carry a flag of their own or on one of their days (the amber week numbers). */
export function flaggedWeeks(d: ApiPlanDraft): Set<number> {
  return new Set(flagList(d).filter((f) => f.week_no != null).map((f) => f.week_no as number));
}

/** The text right of a flag: 「第 N 週」 for a week's line, 「m/d」 for a day's, nothing for the whole draft's. */
export function flagWhere(f: FlagItem): string | null {
  return f.date ? mdPlain(f.date) : f.week_no != null ? `第 ${f.week_no} 週` : null;
}

/** 「依據 · …」 under Woo's thought, and 「上一場：…」 when the plan opens with a race behind it (02 §5.1). */
export function basisLines(p: ApiAthleteProfile): string[] {
  const one = (n: number) => String(Math.round(n * 10) / 10);
  const lines: string[] = [];
  if (p.total_runs === 0) {
    lines.push("依據 · 最近 12 週沒有跑步紀錄，從你填的經驗起步、第一週保守");
  } else {
    const head = p.import_error ? "依據 · Strava 讀不到，用的是已經在 app 裡的紀錄：" : "依據 · Strava 最近 12 週：";
    lines.push(`${head}每週 ${one(p.last4.runs_per_week)} 次、${one(p.last4.km_per_week)} km${p.longest ? `，最長 ${one(p.longest.km)} km（${mdPlain(p.longest.date)}）` : ""}`);
  }
  const r = p.last_race;
  if (r) lines.push(`上一場：${r.name} ${mdPlain(r.date)} · ${km(r.distance_m)} km${r.actual_time_sec != null ? ` · 實跑 ${duration(r.actual_time_sec)}` : ""}`);
  return lines;
}

/** Woo's thought up to the first 。 (the card shows this, 全文 › shows the rest). */
export function firstSentence(text: string): string {
  const m = /^[^。]*。?/.exec(text.trim());
  return m && m[0] ? m[0] : text.trim();
}

/** 「還沒生效 · 採用後 m/d 開始」 */
export const startLine = (d: ApiPlanDraft) => `還沒生效 · 採用後 ${mdPlain(d.intake.start_date)} 開始`;

/** 「12/21 週一 · 共 11 週」 on the answers list. */
export const startWithWeeks = (i: PlanIntake) => `${mdDowPlain(i.start_date)} · 共 ${planWeeksCount(i)} 週`;

// ---- the newest draft, for the entry and for the line under 課表已結束 -----------------------------------------------------------------

export interface LatestDraft {
  /** null: GET /me did not come back. The entry then goes on with the draft (the api answers a missing Strava itself on send). */
  me: MeResponse | null;
  draft: ApiPlanDraft | null;
  /** GET /plan-drafts/latest answered 404: an api from before this. */
  latestNotFound: boolean;
  loading: boolean;
}

/** GET /me and GET /plan-drafts/latest, once each when the page is shown; no polling. Any failure of latest but 404 is "no draft". */
export function useLatestDraft(): LatestDraft {
  const [state, setState] = useState<LatestDraft>({ me: null, draft: null, latestNotFound: false, loading: true });
  useEffect(() => {
    let live = true;
    void Promise.all([
      getMe().catch(() => null),
      getLatestPlanDraft().then(
        (r) => ({ draft: r.draft, notFound: false }),
        (e: unknown) => ({ draft: null, notFound: e instanceof ApiError && e.status === 404 }),
      ),
    ]).then(([me, latest]) => {
      if (live) setState({ me, draft: latest.draft, latestNotFound: latest.notFound, loading: false });
    });
    return () => { live = false; };
  }, []);
  return state;
}
