import { useState } from "react";
import type { ApiAdjustment, ApiSession, ApiWeeklyReview } from "../types/api";
import { ApiError, postAdjustment } from "../lib/api";
import { md, mdDow } from "../lib/date";
import { kmPlan, pace } from "../lib/format";
import { shortName } from "../lib/labels";
import { Avatar } from "./ui";

const FIELD_NAMES: Record<ApiAdjustment["field"], string> = {
  type: "課型", target_distance_m: "距離", target_pace_sec_km: "配速", scheduled_date: "日期", note: "備註",
};

function fmt(field: ApiAdjustment["field"], v: string | number | null): string {
  if (v == null || v === "") return "—";
  if (field === "target_distance_m" && typeof v === "number") return `${kmPlan(v)} km`;
  if (field === "target_pace_sec_km" && typeof v === "number") return `${pace(v)} /km`;
  if (field === "scheduled_date" && typeof v === "string") return mdDow(v);
  return String(v);
}

/**
 * 教練建議: the latest weekly review's summary and its adjustment proposals. Nothing
 * changes until the athlete taps 採用; 略過 just records the decision.
 */
export function CoachProposals({ review, sessions, onChanged }: { review: ApiWeeklyReview; sessions: ApiSession[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<number, ApiAdjustment["status"]>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = review.adjustments.filter((a) => (state[a.index] ?? a.status) === "pending");
  const decided = review.adjustments.length - pending.length;

  async function decide(a: ApiAdjustment, action: "apply" | "dismiss") {
    setBusy(a.index);
    setError(null);
    try {
      await postAdjustment(review.id, a.index, { action });
      setState((s) => ({ ...s, [a.index]: action === "apply" ? "applied" : "dismissed" }));
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 409 ? "這堂課已經改過了，建議不再適用" : e.message) : "送出失敗，再試一次");
    } finally {
      setBusy(null);
    }
  }

  if (!review.summary && !pending.length) return null;

  return (
    <section className="coach">
      <div className="head">
        <h2 className="section-h" style={{ margin: 0 }}>教練回顧 · {md(review.week_start)} 那週</h2>
        {pending.length ? <span className="count">{pending.length} 個建議</span> : decided ? <span className="count muted">已處理</span> : null}
      </div>
      {review.summary ? (
        <p className={`summary${open ? "" : " clamp"}`} onClick={() => setOpen((v) => !v)}>{review.summary}</p>
      ) : null}
      {pending.map((a) => {
        const s = sessions.find((x) => x.id === a.session_id || x.id === a.applied_session_id) ?? null;
        return (
          <div key={a.index} className="proposal">
            <div className="who">
              <Avatar session={s} />
              <div className="txt">
                <div className="t">{s ? `${mdDow(s.scheduled_date)} · ${shortName(s)}` : "課表上的一堂課"}</div>
                {a.field === "note" ? (
                  <>
                    <div className="change">備註改成：<b>{fmt(a.field, a.new)}</b></div>
                    {a.old ? <div className="old">原本：{fmt(a.field, a.old)}</div> : null}
                  </>
                ) : (
                  <div className="change">{FIELD_NAMES[a.field]}：<s>{fmt(a.field, a.old)}</s> → <b>{fmt(a.field, a.new)}</b></div>
                )}
                <div className="why">{a.reason}</div>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="chip primary" disabled={busy != null} onClick={() => void decide(a, "apply")}>{busy === a.index ? "…" : "採用"}</button>
              <button type="button" className="chip" disabled={busy != null} onClick={() => void decide(a, "dismiss")}>略過</button>
            </div>
          </div>
        );
      })}
      {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
    </section>
  );
}
