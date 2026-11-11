// One planned session can hold up to five Strava recordings (the watch was stopped by mistake, a second one was
// started). Everything that used to read "the activity of this session" reads the group instead: this file groups
// them and adds them up. Same rules and the same arithmetic as training-api src/lib/session-group.ts (combineGroup);
// keep the two in sync.
//
//   group      = the session's activities that are not ignored, oldest start first; the first is the primary one
//   distance   = sum;  moving time = sum (the pauses between recordings do not count)
//   pace       = total moving time / total distance (runs only)
//   heart rate = average weighted by moving time; max = the highest; kcal = sum; watts weighted like heart rate
//   splits     = each recording's whole km in order, renumbered (see mergeSplits)
//   gap        = start_i − (start_{i−1} + elapsed_{i−1}), minutes; elapsed = `elapsed_time_sec` ?? moving time
//
// A session with one activity combines to that activity's own numbers, untouched.

import type { ApiActivity, ApiSession, ApiSplit } from "../types/api";
import { ApiError } from "./api";
import { toJstDate } from "./date";
import { sportName } from "./labels";
import type { PlanView } from "./plan";
import { fullSplits, mergeSplits } from "./segments";

/** One session holds at most this many recordings (the api answers 409 for a sixth). */
export const MAX_PER_SESSION = 5;

const RUN_SPORTS = new Set(["Run", "TrailRun", "VirtualRun"]);
/** Same kind = both runs or both not runs; a missing sport counts as a run (the api's rule). */
const isRunKind = (sport: string | null | undefined) => !sport || RUN_SPORTS.has(sport);

const byStart = (x: ApiActivity, y: ApiActivity) => x.start_time.localeCompare(y.start_time) || x.id.localeCompare(y.id);

/** Every session's group: its activities that are not ignored, oldest start first. */
export function groupBySession(activities: readonly ApiActivity[]): Map<string, ApiActivity[]> {
  const groups = new Map<string, ApiActivity[]>();
  for (const a of activities) {
    if (!a.session_id || a.match_status === "ignored") continue;
    const g = groups.get(a.session_id);
    if (g) g.push(a);
    else groups.set(a.session_id, [a]);
  }
  for (const g of groups.values()) g.sort(byStart);
  return groups;
}

/** The group `a` belongs to (with `a` itself in it, as given: it may be newer than the list); an activity without a session is a group of one. */
export function groupOf(all: readonly ApiActivity[], a: ApiActivity): ApiActivity[] {
  if (!a.session_id || a.match_status === "ignored") return [a];
  const others = all.filter((x) => x.id !== a.id && x.session_id === a.session_id && x.match_status !== "ignored");
  return [...others, a].sort(byStart);
}

/** The primary activity of a group: the one the api names, else (an older api sends no `segment`) the first. */
export function primaryOf(group: readonly ApiActivity[]): ApiActivity {
  const id = group[0]?.segment?.primary_activity_id;
  return (id ? group.find((x) => x.id === id) : null) ?? group[0];
}

const elapsed = (a: Pick<ApiActivity, "elapsed_time_sec" | "moving_time_sec">) => a.elapsed_time_sec ?? a.moving_time_sec;

/** Do the two recordings cover a common stretch of time? (The same run recorded twice: a watch and a phone.) */
export function overlaps(a: Pick<ApiActivity, "start_time" | "elapsed_time_sec" | "moving_time_sec">, b: Pick<ApiActivity, "start_time" | "elapsed_time_sec" | "moving_time_sec">): boolean {
  const as = Date.parse(a.start_time), bs = Date.parse(b.start_time);
  return bs < as + elapsed(a) * 1000 && as < bs + elapsed(b) * 1000;
}

/** Minutes of pause between a recording and the one before it (never negative). */
function gapMin(prev: ApiActivity, cur: ApiActivity): number {
  const seconds = (Date.parse(cur.start_time) - Date.parse(prev.start_time)) / 1000 - elapsed(prev);
  return Math.max(0, Math.round(seconds / 60));
}

/** Average weighted by moving time over the recordings that have a value; null when none has. */
function weighted(group: readonly ApiActivity[], pick: (a: ApiActivity) => number | null): number | null {
  let sum = 0, weight = 0;
  for (const a of group) {
    const v = pick(a);
    if (v == null) continue;
    sum += v * a.moving_time_sec;
    weight += a.moving_time_sec;
  }
  return weight > 0 ? Math.round(sum / weight) : null;
}

const maxOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
};
const sumOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((t, x) => t + x, 0) : null;
};

export interface Combined {
  /** The group, oldest start first. */
  group: ApiActivity[];
  /** The first of the group: carries the review, the memo and the report's address. */
  primary: ApiActivity;
  count: number;
  sport_type: string | null;
  distance_m: number;
  moving_time_sec: number;
  avg_pace_sec_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_watts: number | null;
  kcal: number | null;
  /** The joined whole kilometres (null when no recording has any); a group of one passes the activity's own list through. */
  splits: ApiSplit[] | null;
  /** The renumbered km where a later recording starts (第 N 段 lines on the report). */
  boundaries: number[];
  /** The same places with the recording's own number (a middle recording without splits leaves a gap in the numbers): what the 第 N 段 line says. */
  breaks: { split: number; segment: number }[];
  /** Minutes of pause before each recording; the first is null. */
  gaps: (number | null)[];
}

/** Add a (non-empty) group up. One recording: its own numbers, as they are. */
export function combine(group: readonly ApiActivity[]): Combined {
  const g = [...group];
  const primary = primaryOf(g);
  if (g.length === 1) {
    const a = g[0];
    return { group: g, primary, count: 1, sport_type: a.sport_type, distance_m: a.distance_m, moving_time_sec: a.moving_time_sec, avg_pace_sec_km: a.avg_pace_sec_km,
      avg_hr: a.avg_hr, max_hr: a.max_hr, avg_watts: a.avg_watts, kcal: a.kcal, splits: a.splits, boundaries: [], breaks: [], gaps: [null] };
  }
  const distance_m = g.reduce((t, a) => t + a.distance_m, 0);
  const moving_time_sec = g.reduce((t, a) => t + a.moving_time_sec, 0);
  const merged = mergeSplits(g.map((a) => a.splits));
  const breaks: Combined["breaks"] = [];
  let kms = 0;
  g.forEach((a, i) => {
    const n = fullSplits(a.splits).length;
    if (n && i > 0) breaks.push({ split: kms + 1, segment: i + 1 });
    kms += n;
  });
  return {
    group: g,
    primary,
    count: g.length,
    sport_type: g[0].sport_type,
    distance_m,
    moving_time_sec,
    avg_pace_sec_km: isRunKind(g[0].sport_type) && distance_m > 0 ? Math.round(moving_time_sec / (distance_m / 1000)) : null,
    avg_hr: weighted(g, (a) => a.avg_hr),
    max_hr: maxOf(g.map((a) => a.max_hr)),
    avg_watts: weighted(g, (a) => a.avg_watts),
    kcal: sumOf(g.map((a) => a.kcal)),
    splits: merged.splits.length ? merged.splits : null,
    boundaries: merged.boundaries,
    breaks,
    gaps: g.map((a, i) => (i === 0 ? null : gapMin(g[i - 1], a))),
  };
}

/**
 * An activity that sits in another session which has other recordings too. Moving it here would leave that session
 * without one of its segments (and its review stale), so the api refuses (409) and no entry offers it: take it out of
 * that session first, on its own report. An activity in a session of its own, or with no session, can still be moved.
 */
export const inOtherMultiSession = (x: Pick<ApiActivity, "session_id" | "segment">, sessionId: string | null): boolean =>
  !!x.session_id && x.session_id !== sessionId && (x.segment?.count ?? 1) > 1;

/**
 * The session today's 「也算今天的課」 would add `a` to: today's session when it already has a recording, the
 * group has room, `a` is the same kind of activity, on the same day, and overlaps none of them. Otherwise null
 * (the plain 「算成 … 的課」 chip, or nothing).
 */
export function appendTargetFor(view: PlanView, a: ApiActivity): ApiSession | null {
  const day = view.todayDay;
  const c = day?.combined;
  if (!day || !c) return null;
  if (c.count >= MAX_PER_SESSION) return null;
  if (inOtherMultiSession(a, day.session.id)) return null;
  if (toJstDate(a.start_time) !== day.session.scheduled_date) return null;
  if (isRunKind(a.sport_type) !== isRunKind(c.sport_type)) return null;
  if (c.group.some((g) => overlaps(g, a))) return null;
  return day.session;
}

/**
 * What to say when a pick, 加進這堂, 移除 or 換成這趟 fails. The api's 409s are English; none of them reaches the screen:
 * the four it sends for a session with several recordings (overlap, kind, too many, already confirmed) have a fixed
 * Chinese sentence, any other 409 means the session changed under us. 503 and every other error read as before.
 */
export function assignErrorText(e: unknown, a: Pick<ApiActivity, "sport_type"> | null, holders: readonly Pick<ApiActivity, "sport_type">[], where: "report" | "coach" = "report"): string {
  if (!(e instanceof ApiError)) return "送出失敗，再試一次";
  if (e.status === 503) return "資料庫還在啟動，幾秒後再按一次";
  if (e.status !== 409) return e.message;
  if (/source session has other segments/i.test(e.message)) return "這筆活動在別堂有多段，請先到那堂移除";
  if (/overlap/i.test(e.message)) return "這兩筆時間重疊，應該是同一趟被記了兩次；用「換成這趟」留一筆就好";
  if (/same kind/i.test(e.message)) {
    const names = [...new Set(holders.map((h) => sportName(h.sport_type)))].join("、") || "運動";
    return `這筆是${sportName(a?.sport_type)}，不能跟${names}併成同一堂`;
  }
  if (/too many/i.test(e.message)) return "一堂最多 5 筆";
  // 加進這堂 only exists on the report page: the coach page says something that works where the athlete is
  if (/already confirmed/i.test(e.message)) return where === "coach" ? "這堂已經有紀錄了，重新整理後再選一次" : "這堂已經有紀錄了，要併進去按「加進這堂」";
  return "這堂的紀錄剛被改過，關掉再打開一次";
}

/**
 * What the 算成哪一堂 sheet says when binding fails (02 §5-2). Only Chinese reaches the screen: 404 (the session was changed, or is gone)
 * and 409 (taken by another activity, or changed under us) have their own sentence, 503 the database one, everything else the plain retry.
 * (`assignErrorText` is not used: it hands the api's English message back for the statuses it does not know.)
 */
export function linkErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) return "這堂課剛被改過，重新選一次";
  if (e instanceof ApiError && e.status === 409) return /already confirmed/i.test(e.message) ? "這堂剛有了紀錄，選別堂" : "這堂課剛被改過，重新選一次";
  if (e instanceof ApiError && e.status === 503) return "資料庫還在啟動，幾秒後再按一次";
  return "送出失敗，再試一次";
}
