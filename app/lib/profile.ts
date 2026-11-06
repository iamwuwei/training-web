// "Woo 會看到的你" on the second step of the intake form: the last 12 weeks of running as far as the app already has them
// (GET /activities, which carries the newest 200). Pure arithmetic, no request, no model call. When the draft is made the
// api reads Strava again and counts for itself (01b §2.5); this is only what the athlete is shown before pressing 產生課表.
//
// A "run" is counted the way the api counts it: a session with several recordings is one run (`combine`), an ignored
// recording is not one, and a recording without a sport counts as a run.

import type { ApiActivity } from "../types/api";
import { combine, groupBySession } from "./combine";
import { addDays, dayDiff, toJstDate } from "./date";
import { isRunSport } from "./plan";

export interface LocalProfile {
  /** 12 weeks, Monday first, the last one is the week of `today`; no run = 0. */
  weeks: { week_start: string; km: number }[];
  last4: { runs_per_week: number; km_per_week: number };
  longest: { date: string; km: number } | null;
  avg_pace_sec_km: number | null;
  avg_hr: number | null;
  total_runs: number;
  from: string;
  to: string;
}

export const HISTORY_DAYS = 84;

/** The Monday on or before `iso`. */
export function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

const one = (n: number) => Math.round(n * 10) / 10;

interface Trip { date: string; m: number; sec: number; hr: number | null }

/** One trip per session (its recordings added up) or per recording not in a session, within the last 84 days, oldest first. */
function trips(activities: readonly ApiActivity[], today: string): Trip[] {
  const from = addDays(today, -(HISTORY_DAYS - 1));
  const runs = activities.filter((a) => a.match_status !== "ignored" && (!a.sport_type || isRunSport(a.sport_type)));
  const out: Trip[] = [];
  for (const group of groupBySession(runs).values()) {
    const c = combine(group);
    out.push({ date: toJstDate(c.primary.start_time), m: c.distance_m, sec: c.moving_time_sec, hr: c.avg_hr });
  }
  for (const a of runs) if (!a.session_id) out.push({ date: toJstDate(a.start_time), m: a.distance_m, sec: a.moving_time_sec, hr: a.avg_hr });
  return out.filter((t) => t.date >= from && t.date <= today).sort((a, b) => a.date.localeCompare(b.date));
}

export function localProfile(activities: readonly ApiActivity[], today: string): LocalProfile {
  const all = trips(activities, today);
  const last = mondayOf(today);
  const starts = Array.from({ length: 12 }, (_, i) => addDays(last, -7 * (11 - i)));
  const weeks = starts.map((week_start) => ({ week_start, km: 0, runs: 0 }));
  for (const t of all) {
    const i = Math.floor(dayDiff(starts[0], t.date) / 7);
    if (i >= 0 && i < 12) { weeks[i].km += t.m / 1000; weeks[i].runs += 1; }
  }
  const tail = weeks.slice(-4);
  const metres = all.reduce((s, t) => s + t.m, 0);
  const seconds = all.reduce((s, t) => s + t.sec, 0);
  const withHr = all.filter((t) => t.hr != null && t.sec > 0);
  const hrSec = withHr.reduce((s, t) => s + t.sec, 0);
  let best: Trip | null = null;
  for (const t of all) if (!best || t.m > best.m) best = t;
  return {
    weeks: weeks.map((w) => ({ week_start: w.week_start, km: w.km })),
    last4: { runs_per_week: one(tail.reduce((s, w) => s + w.runs, 0) / 4), km_per_week: one(tail.reduce((s, w) => s + w.km, 0) / 4) },
    longest: best ? { date: best.date, km: one(best.m / 1000) } : null,
    avg_pace_sec_km: metres > 0 ? Math.round(seconds / (metres / 1000)) : null,
    avg_hr: hrSec > 0 ? Math.round(withHr.reduce((s, t) => s + (t.hr ?? 0) * t.sec, 0) / hrSec) : null,
    total_runs: all.length,
    from: starts[0],
    to: today,
  };
}
