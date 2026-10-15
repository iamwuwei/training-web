// Which kilometres of a session have which pace target, read from the plan's own text.
//
//   "2 km Easy + 3 km @ MP + 2 km Easy"   → km 3–5 carry the session's MP band
//   "3 km Easy + 5 km @ 6:40 + 1 km Easy" → km 4–8 carry the session's band
//   "長跑 18 km，最後 4 km @ 6:45"         → km 1–14 the session band, km 15–18 6:40–6:50
//   "輕鬆跑 6 km"                          → every km the session band (a single-pace session)
//
// Anything else (seconds-based reps, three-part long runs, the race) is "unknown": the
// report then draws splits without target bands and leaves the pace bar out.

import type { ApiActivity, ApiSession, ApiSplit } from "../types/api";

export interface Band { lo: number; hi: number }

export interface KmTarget {
  band: Band | null;
  /** The part the session is about (the MP block, the fast finish; every km of a single-pace run). */
  focus: boolean;
}

export interface SessionPlan {
  /** One entry per planned km, or null when the text can't be read. */
  kms: KmTarget[] | null;
  /** One pace for the whole run: compare the whole-run averages. */
  single: boolean;
}

const toSec = (mmss: string) => {
  const [m, s] = mmss.split(":").map(Number);
  return m * 60 + s;
};

/** '6:45' → 6:40–6:50, '6:40〜7:00' → as written. */
function bandFromText(text: string): Band | null {
  const m = /(\d{1,2}:\d{2})\s*(?:[〜~\-–]\s*(\d{1,2}:\d{2}))?/.exec(text);
  if (!m) return null;
  const a = toSec(m[1]);
  if (!m[2]) return { lo: a - 5, hi: a + 5 };
  const b = toSec(m[2]);
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/** The session's own pace range. '7:45+' (min only) means "this or slower". */
export function sessionBand(s: Pick<ApiSession, "target_pace_min_sec_km" | "target_pace_max_sec_km">): Band | null {
  const lo = s.target_pace_min_sec_km, hi = s.target_pace_max_sec_km;
  if (lo && hi) return { lo, hi };
  if (lo) return { lo, hi: lo + 60 };
  if (hi) return { lo: hi - 60, hi };
  return null;
}

function expand(segs: { n: number; band: Band | null; focus: boolean }[]): KmTarget[] {
  const out: KmTarget[] = [];
  for (const seg of segs) for (let i = 0; i < Math.round(seg.n); i++) out.push({ band: seg.band, focus: seg.focus });
  return out;
}

export function planFor(s: ApiSession): SessionPlan {
  const content = s.content ?? "";
  const target = s.target ?? "";
  const main = sessionBand(s);
  const total = s.target_distance_m ? Math.round(s.target_distance_m / 1000) : 0;

  // "2 km Easy + 3 km @ MP + 2 km Easy"
  if (content.includes("+")) {
    const segs: { n: number; band: Band | null; focus: boolean }[] = [];
    for (const part of content.split("+").map((p) => p.trim())) {
      const m = /^(\d+(?:\.\d+)?)\s*km\s*(.*)$/i.exec(part);
      if (!m) return { kms: null, single: false };
      const rest = m[2];
      if (/easy/i.test(rest)) segs.push({ n: Number(m[1]), band: null, focus: false });
      else if (rest.includes("@")) segs.push({ n: Number(m[1]), band: main ?? bandFromText(rest), focus: true });
      else return { kms: null, single: false };
    }
    return { kms: expand(segs), single: false };
  }

  // "長跑 18 km，最後 4 km @ 6:45" — but not the three-part peak long run / race targets.
  const last = /最後\s*(\d+)\s*km\s*@\s*([^，,（(★]+)/.exec(content);
  if (last) {
    const parts = target.split("/").filter((p) => /km/.test(p));
    if (parts.length >= 3 || !total) return { kms: null, single: false };
    const n = Number(last[1]);
    return { kms: expand([{ n: total - n, band: main, focus: false }, { n, band: bandFromText(last[2]), focus: true }]), single: false };
  }

  if (/最後|前\s*\d+\s*km|×|秒/.test(content + target) || !total) return { kms: null, single: false };
  return { kms: expand([{ n: total, band: main, focus: true }]), single: true };
}

/** Whole kilometres only; a trailing 30 m stub has no meaningful pace. */
export function fullSplits(splits: ApiSplit[] | null): ApiSplit[] {
  return (splits ?? []).filter((sp) => sp.distance >= 500 && sp.average_speed > 0);
}

export const splitPace = (sp: ApiSplit) => Math.round(1000 / sp.average_speed);

export interface FocusStats {
  from: number; // 1-based km
  to: number;
  pace: number; // sec/km over those km
  hrTop: number | null; // highest per-km average HR in those km
}

/** Average pace over the focus kilometres (the MP block, the fast finish), from the splits. */
export function focusStats(plan: SessionPlan, splits: ApiSplit[] | null): FocusStats | null {
  if (!plan.kms) return null;
  const sps = fullSplits(splits);
  const picked = sps.filter((sp) => plan.kms![sp.split - 1]?.focus);
  if (!picked.length) return null;
  const dist = picked.reduce((t, sp) => t + sp.distance, 0);
  const time = picked.reduce((t, sp) => t + sp.moving_time, 0);
  const hrs = picked.map((sp) => sp.average_heartrate).filter((h): h is number => h != null);
  return {
    from: picked[0].split,
    to: picked[picked.length - 1].split,
    pace: Math.round(time / (dist / 1000)),
    hrTop: hrs.length ? Math.round(Math.max(...hrs)) : null,
  };
}

/** The pace to compare across sessions of the same kind: whole run, or the focus block for a composite. */
export function comparablePace(a: ApiActivity, s: ApiSession): { pace: number; hr: number | null } | null {
  const plan = planFor(s);
  if (plan.single) return a.avg_pace_sec_km ? { pace: a.avg_pace_sec_km, hr: a.avg_hr } : null;
  const f = focusStats(plan, a.splits);
  return f ? { pace: f.pace, hr: f.hrTop } : null;
}

/** What to call the focus block: 'MP 段' for MP work, '最後 4 km' for a fast finish. */
export function focusLabel(s: ApiSession): string {
  const content = s.content ?? "";
  const last = /最後\s*(\d+)\s*km/.exec(content);
  if (last && !content.includes("+")) return `最後 ${last[1]} km`;
  return /MP/.test(`${s.label ?? ""} ${content} ${s.target ?? ""}`) ? "MP 段" : "重點段";
}
