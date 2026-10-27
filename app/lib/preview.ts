// The plan as it would be after a proposal: the local plan with the card's changes laid over
// it (no API call). The same steps the api takes on apply, so the preview and the result agree.

import type { ApiProposal, ApiProposalChange, ApiSession, PlanResponse, SessionType } from "../types/api";
import { md } from "./date";
import { kmPlan, pace } from "./format";
import { rowName, shortName, typeLabel, typeName } from "./labels";

export interface Preview {
  /** The plan after the card; build the usual PlanView from it. */
  data: PlanResponse;
  /** Session id → "原本：…" for every row the card touches (an added session: "原本：沒有這堂"). */
  was: Map<string, string>;
  /** Weeks with a changed session or description. */
  changedWeeks: Set<number>;
  /** Planned metres per week before the card. */
  beforeM: Map<number, number>;
  /** Week description before the card, for the weeks the card rewrites. */
  focusWas: Map<number, string | null>;
}

const TYPES = { easy: 1, long: 1, tempo: 1, interval: 1, rest: 1, race: 1 };
const FIELD_K: Partial<Record<NonNullable<ApiProposalChange["field"]>, string>> = { target_distance_m: "距離", target_pace_sec_km: "配速", type: "課型", note: "備註" };
const op = (c: ApiProposalChange) => c.op ?? "change";
const firstSentence = (t: string | null) => (t ? /^[^。！？!?；;]+/.exec(t.trim())?.[0] ?? t : "");

/** The old value of a change, as the "原本：" line says it. */
function oldText(c: ApiProposalChange, before: ApiSession): string {
  switch (c.field) {
    case "target_distance_m": return `${kmPlan(typeof c.old === "number" ? c.old : before.target_distance_m)} km`;
    case "target_pace_sec_km": return typeof c.old === "number" ? `${pace(c.old)} /km` : String(c.old ?? before.target?.split(" / ")[0] ?? "—");
    case "type": return typeName(c.old ?? before.type);
    case "note": return firstSentence(typeof c.old === "string" ? c.old : before.note) || "（沒有備註）";
    case "skip": return shortName(before);
    default: return String(c.old ?? shortName(before));
  }
}

export function buildPreview(plan: PlanResponse, p: ApiProposal): Preview {
  const before = new Map(plan.sessions.map((s) => [s.id, s]));
  const beforeByDate = new Map(plan.sessions.map((s) => [s.scheduled_date, s]));
  const weekNo = (date: string) => plan.weeks.find((w) => date >= w.week_start && date <= w.week_end)?.week_no ?? null;
  const sumM = (sessions: ApiSession[]) => {
    const m = new Map<number, number>();
    for (const w of plan.weeks) m.set(w.week_no, sessions.filter((s) => s.scheduled_date >= w.week_start && s.scheduled_date <= w.week_end).reduce((a, s) => a + (s.target_distance_m ?? 0), 0));
    return m;
  };

  const removed = new Set(p.changes.filter((c) => op(c) === "remove" && c.session_id).map((c) => c.session_id as string));
  const sessions = plan.sessions.filter((s) => !removed.has(s.id)).map((s) => ({ ...s }));
  // per session: the old value of each field the card changes, and where a moved one came from
  const was = new Map<string, { k: string | null; v: string }[]>();
  const note = (id: string, v: string, k: string | null = null) => was.set(id, [...(was.get(id) ?? []), { k, v }]);
  const moves = new Map<string, { there: ApiSession | undefined; from: string }>();
  const changedWeeks = new Set<number>();
  const touch = (date: string | null) => { const n = date ? weekNo(date) : null; if (n != null) changedWeeks.add(n); };

  for (const c of p.changes) {
    touch(c.date);
    if (op(c) === "remove") continue;
    if (op(c) === "add") { if (c.new_session) touch(c.new_session.scheduled_date); continue; }
    const s = sessions.find((x) => x.id === c.session_id);
    const b = c.session_id ? before.get(c.session_id) : undefined;
    if (!s || !b || !c.field) continue;
    if (c.field === "skip") { s.type = "rest"; s.label = "休息"; s.content = "休息"; s.target_distance_m = 0; s.target = null; s.target_pace_sec_km = null; s.note = null; }
    else if (c.field === "scheduled_date" && typeof c.new === "string") {
      s.scheduled_date = c.new; s.week_no = weekNo(c.new);
      touch(c.new);
    } else if (c.field === "target_distance_m" && typeof c.new === "number") {
      s.target_distance_m = c.new;
      s.content = s.content?.replace(/\d+(?:〜\d+)?\s*km/, `${kmPlan(c.new)} km`) ?? s.content;
    } else if (c.field === "target_pace_sec_km") {
      if (typeof c.new === "number") {
        // what the row's right side says: the first part of `target` is the pace; min / max move by the same seconds (as the api does)
        const by = c.new - (s.target_pace_sec_km ?? c.new);
        s.target = [pace(c.new), ...(s.target?.split(" / ").slice(1) ?? [])].join(" / ");
        if (s.target_pace_min_sec_km != null) s.target_pace_min_sec_km += by;
        if (s.target_pace_max_sec_km != null) s.target_pace_max_sec_km += by;
        s.target_pace_sec_km = c.new;
      }
    } else if (c.field === "type" && typeof c.new === "string" && c.new in TYPES) {
      // the api's enum: the row becomes that kind of session (distance stays unless the card also changes it)
      s.type = c.new as SessionType; s.label = typeLabel(s.type); s.content = null;
      if (s.type === "rest") { s.target_distance_m = 0; s.target = null; s.note = null; }
    }
    if (c.field === "note") s.note = String(c.new ?? "") || null;

    if (c.field === "scheduled_date" && typeof c.new === "string") moves.set(s.id, { there: beforeByDate.get(c.new), from: b.scheduled_date });
    else note(s.id, oldText(c, b), FIELD_K[c.field] ?? null);
  }
  p.changes.forEach((c, i) => {
    const n = c.new_session;
    if (op(c) !== "add" || !n) return;
    const id = `preview-add-${i}`;
    sessions.push({ id, plan_id: plan.plan.id, scheduled_date: n.scheduled_date, week_no: weekNo(n.scheduled_date), phase: null, label: n.label, type: n.type, content: n.label, note: n.note,
      target: null, target_distance_m: n.target_distance_m, target_pace_sec_km: n.target_pace_sec_km, target_pace_min_sec_km: null, target_pace_max_sec_km: null,
      target_hr_min: null, target_hr_max: null, brief: null, skipped_at: null, version: 1, superseded: false });
    note(id, "沒有這堂");
  });
  sessions.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));

  const focusWas = new Map<number, string | null>();
  const weeks = plan.weeks.map((w) => {
    const d = p.weeks?.find((x) => x.week_no === w.week_no);
    if (!d) return w;
    if ((d.focus != null && d.focus !== w.focus) || (d.phase != null && d.phase !== w.phase)) { changedWeeks.add(w.week_no); focusWas.set(w.week_no, w.focus); }
    return { ...w, focus: d.focus ?? w.focus, phase: d.phase ?? w.phase };
  });

  return {
    data: { ...plan, sessions, weeks },
    was: new Map([...new Set([...moves.keys(), ...was.keys()])].map((id) => {
      // a moved session reads "原本：<what was on that day> · <its distance> 從 11/22 移來"; with other fields changed too, those are labelled (距離 32 km)
      const m = moves.get(id), s = sessions.find((x) => x.id === id), f = was.get(id) ?? [];
      const parts = [...(m && s ? [[m.there && m.there.id !== id ? rowName(m.there) : null, `${s.target_distance_m ? `${kmPlan(s.target_distance_m)} km` : rowName(s)} 從 ${md(m.from)} 移來`].filter(Boolean).join(" · ")] : []), ...f.map((x) => (m || f.length > 1) && x.k ? `${x.k} ${x.v}` : x.v)];
      return [id, `原本：${parts.join(" · ")}`] as const;
    })),
    changedWeeks,
    beforeM: sumM(plan.sessions),
    focusWas,
  };
}
