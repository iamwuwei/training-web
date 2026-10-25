// Trend series shared by the report page (same-type trend) and the today dashboard
// (進步): aerobic efficiency, longest run, MP pace, and the cumulative totals.
// Pace is seconds per km: smaller is faster, a negative delta is good news.

import type { ApiActivity, ApiSession } from "../types/api";
import { dayDiff } from "./date";
import { labelStyle } from "./labels";
import { activityDate, isRunSport, type PlanView } from "./plan";
import { comparablePace, focusStats, fullSplits, planFor, sessionBand, type Band } from "./segments";

export interface TrendPoint {
  a: ApiActivity;
  /** Pace (sec/km) or, for the long-run series, distance in metres. */
  v: number;
}

/** Pace of the km splits run inside the session's HR band (aerobic efficiency); null without enough of them. */
export function paceInBand(a: ApiActivity, lo: number, hi: number): number | null {
  const inBand = fullSplits(a.splits).filter((sp) => sp.average_heartrate != null && sp.average_heartrate >= lo && sp.average_heartrate <= hi && sp.distance > 500);
  if (inBand.length < 2) return null;
  const dist = inBand.reduce((n, sp) => n + sp.distance, 0);
  const time = inBand.reduce((n, sp) => n + sp.moving_time, 0);
  return Math.round(time / (dist / 1000));
}

/** The in-band pace of one run, falling back to the whole-run average only when the average HR itself sat in the band. */
function aerobicPace(a: ApiActivity, lo: number, hi: number): number | null {
  return paceInBand(a, lo, hi) ?? (a.avg_hr != null && a.avg_hr >= lo && a.avg_hr <= hi ? a.avg_pace_sec_km : null);
}

const byTime = (x: TrendPoint, y: TrendPoint) => x.a.start_time.localeCompare(y.a.start_time);

/**
 * The report's trend: every run of the same kind as `session`, oldest first. For
 * Easy / Recovery (with an HR band) the pace while the heart rate sat in the band
 * — fitness, not effort; for MP and the rest the focus-block pace.
 */
export function kindSeries(session: ApiSession, all: ApiActivity[], sessions: ApiSession[]): { points: TrendPoint[]; aerobic: boolean; lo: number; hi: number } {
  const kind = labelStyle(session);
  const aerobic = kind.kind === "easy" && session.target_hr_min != null && session.target_hr_max != null;
  const lo = session.target_hr_min ?? 0, hi = session.target_hr_max ?? 0;
  const points = all
    .map((a) => {
      const s = sessions.find((x) => x.id === a.session_id) ?? null;
      if (!s || labelStyle(s).name !== kind.name) return null;
      const v = aerobic ? aerobicPace(a, lo, hi) : comparablePace(a, s)?.pace ?? null;
      return v ? { a, v } : null;
    })
    .filter((x): x is TrendPoint => !!x)
    .sort(byTime);
  return { points, aerobic, lo, hi };
}

const MAX_POINTS = 10;
const BASELINE_DAYS = 28;
const MARATHON_M = 42_195;

export type Tone = "good" | "flat" | "worse";

export interface AerobicTrend {
  /** Last 10 points, oldest first; the chart. */
  points: TrendPoint[];
  /** The HR band the paces were measured in (from the latest Easy session that has one). */
  lo: number | null;
  hi: number | null;
  /** Latest − baseline, sec/km; null with fewer than two points. */
  delta: number | null;
  /** Weeks between baseline and latest (≥ 1). */
  weeks: number;
  latest: TrendPoint | null;
}

/** Assigned runs up to today, with their session; the dashboard never looks past today. */
function runsToDate(view: PlanView): { a: ApiActivity; s: ApiSession }[] {
  const byId = new Map(view.data.sessions.map((s) => [s.id, s]));
  return view.data.activities
    .filter((a) => isRunSport(a.sport_type) && activityDate(a) <= view.today)
    .map((a) => ({ a, s: a.session_id ? byId.get(a.session_id) ?? null : null }))
    .filter((x): x is { a: ApiActivity; s: ApiSession } => !!x.s);
}

/** Easy / Recovery runs: pace while the heart rate sat in the session's band, against ~4 weeks ago (or the first one). */
export function aerobicTrend(view: PlanView): AerobicTrend {
  const runs = runsToDate(view).filter(({ s }) => labelStyle(s).kind === "easy" && s.target_hr_min != null && s.target_hr_max != null);
  const series = runs
    .map(({ a, s }) => {
      const v = aerobicPace(a, s.target_hr_min as number, s.target_hr_max as number);
      return v ? { a, v } : null;
    })
    .filter((x): x is TrendPoint => !!x)
    .sort(byTime);
  const band = [...runs].sort((x, y) => y.s.scheduled_date.localeCompare(x.s.scheduled_date))[0]?.s
    ?? [...view.data.sessions].reverse().find((s) => labelStyle(s).kind === "easy" && s.target_hr_min != null && s.target_hr_max != null);
  const lo = band?.target_hr_min ?? null, hi = band?.target_hr_max ?? null;
  const latest = series[series.length - 1] ?? null;
  if (series.length < 2 || !latest) return { points: series, lo, hi, delta: null, weeks: 0, latest };
  // Baseline: the newest point at least 28 days old, else the first point.
  const old = series.filter((p) => dayDiff(activityDate(p.a), view.today) >= BASELINE_DAYS);
  const base = old[old.length - 1] ?? series[0];
  const weeks = Math.max(1, Math.round(dayDiff(activityDate(base.a), activityDate(latest.a)) / 7));
  return { points: series.slice(-MAX_POINTS), lo, hi, delta: latest.v - base.v, weeks, latest };
}

export interface LongTrend {
  /** Last 10 long runs, oldest first; v = distance in metres. */
  points: TrendPoint[];
  /** Longest so far, metres; null without any. */
  max_m: number | null;
  /** 42.195 km − longest, metres. */
  remain_m: number | null;
}

/** Long runs (label contains Long): distance per run, the longest so far, and how far that is from the marathon. */
export function longTrend(view: PlanView): LongTrend {
  const series = runsToDate(view)
    .filter(({ s }) => /Long/.test(labelStyle(s).name))
    .map(({ a }) => ({ a, v: a.distance_m }))
    .filter((p) => p.v > 0)
    .sort(byTime);
  if (!series.length) return { points: [], max_m: null, remain_m: null };
  const max_m = Math.max(...series.map((p) => p.v));
  return { points: series.slice(-MAX_POINTS), max_m, remain_m: Math.max(0, MARATHON_M - max_m) };
}

export interface MpTrend {
  /** Last 10 MP sessions, oldest first; v = MP-block pace. */
  points: TrendPoint[];
  latest: TrendPoint | null;
  /** Highest per-km average HR in the latest MP block. */
  hrTop: number | null;
  /** The latest session's MP band. */
  band: Band | null;
  /** Latest pace against the band: 0 inside, +N seconds slower than the top, −N faster than the bottom. */
  off: number | null;
}

/** MP sessions: the MP-block pace per run, and whether the latest one sat in its target band. */
export function mpTrend(view: PlanView): MpTrend {
  const runs = runsToDate(view).filter(({ s }) => labelStyle(s).name === "MP");
  const series = runs
    .map(({ a, s }) => {
      const v = comparablePace(a, s)?.pace ?? null;
      return v ? { a, v } : null;
    })
    .filter((x): x is TrendPoint => !!x)
    .sort(byTime);
  const latest = series[series.length - 1] ?? null;
  if (!latest) return { points: [], latest: null, hrTop: null, band: null, off: null };
  const s = runs.find((r) => r.a.id === latest.a.id)!.s;
  const band = sessionBand(s);
  const hrTop = focusStats(planFor(s), latest.a.splits)?.hrTop ?? latest.a.max_hr ?? null;
  const off = band ? (latest.v > band.hi ? latest.v - band.hi : latest.v < band.lo ? latest.v - band.lo : 0) : null;
  return { points: series.slice(-MAX_POINTS), latest, hrTop, band, off };
}

export interface Totals {
  actual_m: number;
  plan_to_date_m: number;
  /** actual / plan-to-date, 0–100+ */
  pct: number;
  done: number;
  /** Non-rest sessions up to and including today. */
  planned: number;
  /** Weeks in a row that hit their planned km, counted back from this week (an unfinished current week is skipped, not a break). */
  streak: number;
}

export function totals(view: PlanView): Totals {
  const { actual_m, plan_to_date_m, pct, done_count } = view.totals;
  const planned = view.days.filter((d) => d.session.scheduled_date <= view.today && d.session.type !== "rest").length;
  let streak = 0;
  for (const w of [...view.weeks].reverse()) {
    if (w.isFuture) continue;
    if (w.isCurrent) { if (w.isComplete) streak++; continue; }
    if (w.isComplete) streak++;
    else break;
  }
  return { actual_m, plan_to_date_m, pct, done: done_count, planned, streak };
}

/** Colour for a pace delta: faster is good, slower is worse. */
export const paceTone = (delta: number): Tone => (delta < 0 ? "good" : delta > 0 ? "worse" : "flat");
