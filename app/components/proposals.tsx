import { useState } from "react";
import type { ApiAdjustment, ApiProposal, ApiProposalChange, ApiSession, ApiWeeklyReview, ProposalField } from "../types/api";
import { ApiError, postAdjustment, postProposal } from "../lib/api";
import { md, mdDow } from "../lib/date";
import { kmPlan, pace } from "../lib/format";
import { shortName } from "../lib/labels";
import { Avatar } from "./ui";

const FIELD_NAMES: Record<ProposalField, string> = {
  type: "課型", target_distance_m: "距離", target_pace_sec_km: "配速", scheduled_date: "日期", note: "備註", skip: "整堂",
};

const DECIDED: Record<ApiAdjustment["status"], string> = { pending: "", applied: "✓ 已採用", dismissed: "已略過", superseded: "已作廢" };

function fmt(field: ProposalField, v: string | number | null): string {
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
export function CoachProposals({ review, sessions, onChanged, embedded }: { review: ApiWeeklyReview; sessions: ApiSession[]; onChanged: () => void; embedded?: boolean }) {
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
      // 409: the server already decided or superseded it — reload so the buttons go away.
      if (e instanceof ApiError && e.status === 409) onChanged();
    } finally {
      setBusy(null);
    }
  }

  if (!review.summary && !pending.length) return null;

  // Inside Woo's weekly message every proposal shows with what was decided, except the ones a
  // regeneration cancelled: those are the "原本「…」的建議已取消" line under the message.
  const shown = embedded ? review.adjustments.filter((a) => (state[a.index] ?? a.status) !== "superseded") : pending;
  if (embedded && !shown.length) return null;

  return (
    <section className={embedded ? "coach embedded" : "coach"}>
      {embedded ? null : (
        <div className="head">
          <h2 className="section-h" style={{ margin: 0 }}>教練回顧 · {md(review.week_start)} 那週</h2>
          {pending.length ? <span className="count">{pending.length} 個建議</span> : decided ? <span className="count muted">已處理</span> : null}
        </div>
      )}
      {!embedded && review.summary ? (
        <p className={`summary${open ? "" : " clamp"}`} onClick={() => setOpen((v) => !v)}>{review.summary}</p>
      ) : null}
      {shown.map((a) => {
        const status = state[a.index] ?? a.status;
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
              {status === "pending" ? (
                <>
                  <button type="button" className="chip primary" disabled={busy != null} onClick={() => void decide(a, "apply")}>{busy === a.index ? "…" : "採用"}</button>
                  <button type="button" className="chip" disabled={busy != null} onClick={() => void decide(a, "dismiss")}>略過</button>
                </>
              ) : (
                <span className={`decided ${status}`}>{DECIDED[status]}</span>
              )}
            </div>
          </div>
        );
      })}
      {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
    </section>
  );
}

/**
 * The session a change points at; after apply the old row is superseded, so try the new one
 * too. A card about a session no longer in the plan still gets its type disc from the label
 * the api wrote ("Long 16 km" = the session label plus the distance; labelStyle looks the
 * label up before falling back to the type).
 */
function changeSession(c: ApiProposalChange, sessions: ApiSession[]): ApiSession | Pick<ApiSession, "label" | "type"> | null {
  const s = sessions.find((x) => x.id === c.session_id || x.id === c.applied_session_id);
  if (s) return s;
  return c.label ? { label: c.label.replace(/\s*[\d.]+\s*km$/, ""), type: "easy" } : null;
}

/** One change line: "日期 → 10/24 週六" stays short; everything else is "欄位：舊 → 新". */
function ChangeLine({ c }: { c: ApiProposalChange }) {
  if (c.field === "skip") return <div className="change">整堂改成休息</div>;
  if (c.field === "scheduled_date") return <div className="change">日期 → <b>{fmt(c.field, c.new)}</b></div>;
  if (c.field === "note") {
    return (
      <>
        <div className="change">備註改成：<b>{fmt(c.field, c.new)}</b></div>
        {c.old ? <div className="old">原本：{fmt(c.field, c.old)}</div> : null}
      </>
    );
  }
  return <div className="change">{FIELD_NAMES[c.field]}：<s>{fmt(c.field, c.old)}</s> → <b>{fmt(c.field, c.new)}</b></div>;
}

/**
 * Woo's proposal card under a chat reply: one or more changes applied together, one
 * line of why, the numbers he looked at, and amber flags for unusual changes. 採用
 * applies the whole card; the thread is reloaded afterwards for his confirmation line.
 */
export function ProposalCard({ proposal, sessions, onChanged }: { proposal: ApiProposal; sessions: ApiSession[]; onChanged: () => void }) {
  const [status, setStatus] = useState<ApiProposal["status"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = status ?? proposal.status;

  async function decide(action: "apply" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      const r = await postProposal(proposal.id, action);
      setStatus(r.proposal.status);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 409 ? "課表在這之後改過了，這張提案不再適用" : e.message) : "送出失敗，再試一次");
      // 409: already decided, or a session changed since — reload so the server's status replaces the buttons.
      if (e instanceof ApiError && e.status === 409) onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`proposal-card${st !== "pending" ? ` ${st}` : ""}`}>
      {st === "applied" ? <span className="decided applied">已採用</span> : st === "dismissed" ? <span className="decided dismissed">不採用</span> : null}
      {proposal.changes.map((c, i) => {
        const s = changeSession(c, sessions);
        const head = [c.date ? mdDow(c.date) : null, c.label ?? (s && "target_distance_m" in s ? shortName(s) : null)].filter(Boolean).join(" · ") || "課表上的一堂課";
        return (
          <div key={i} className="proposal">
            <div className="who">
              <Avatar session={s} />
              <div className="txt">
                <div className="t">{head}</div>
                <ChangeLine c={c} />
              </div>
            </div>
          </div>
        );
      })}
      {proposal.flags.length ? <div className="flags">{proposal.flags.join(" · ")}</div> : null}
      {proposal.why ? <div className="why">{proposal.why}</div> : null}
      {proposal.basis.length ? <div className="basis"><b>依據</b>{proposal.basis.map((b, i) => <span key={i}> · {b}</span>)}</div> : null}
      {st === "pending" ? (
        <div className="actions">
          <button type="button" className="chip primary" disabled={busy} onClick={() => void decide("apply")}>{busy ? "…" : "採用"}</button>
          <button type="button" className="chip" disabled={busy} onClick={() => void decide("dismiss")}>不採用</button>
        </div>
      ) : null}
      {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
    </div>
  );
}
