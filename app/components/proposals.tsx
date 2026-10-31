import { useState } from "react";
import { Link } from "react-router";
import type { ApiAdjustment, ApiConstraint, ApiProposal, ApiProposalChange, ApiSession, ApiWeek, ApiWeeklyReview, ProposalField } from "../types/api";
import { ApiError, postAdjustment, postConstraint, postProposal } from "../lib/api";
import { periodLabel } from "../lib/constraints";
import { md, mdDow } from "../lib/date";
import { kmPlan, pace } from "../lib/format";
import { rowName, shortName, typeName } from "../lib/labels";
import { MdText } from "./md-text";
import { Avatar } from "./ui";

const FIELD_NAMES: Record<ProposalField, string> = {
  type: "課型", target_distance_m: "距離", target_pace_sec_km: "配速", scheduled_date: "日期", note: "備註", skip: "整堂",
};

const DECIDED: Record<ApiAdjustment["status"], string> = { pending: "", applied: "✓ 已採用", dismissed: "已略過", superseded: "已作廢" };

function fmt(field: ProposalField, v: string | number | null): string {
  if (v == null || v === "") return "—";
  if (field === "target_distance_m" && typeof v === "number") return `${kmPlan(v)} km`;
  if (field === "target_pace_sec_km" && typeof v === "number") return `${pace(v)} /km`;
  if (field === "type") return typeName(v);
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
        <MdText text={review.summary} className={`summary${open ? "" : " clamp"}`} onClick={() => setOpen((v) => !v)} />
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
 * label up before falling back to the type). An added session has no row yet: its own type.
 */
function changeSession(c: ApiProposalChange, sessions: ApiSession[]): ApiSession | Pick<ApiSession, "label" | "type"> | null {
  if (c.new_session) return { label: c.new_session.label, type: c.new_session.type };
  const s = sessions.find((x) => x.id === c.session_id || x.id === c.applied_session_id);
  if (s) return s;
  return c.label ? { label: c.label.replace(/\s*[\d.]+\s*km$/, ""), type: "easy" } : null;
}

/** One change line: "日期 → 10/24 週六" stays short; everything else is "欄位：舊 → 新". A 補課 says which week it counts in once that is decided (after 採用). */
function ChangeLine({ c }: { c: ApiProposalChange }) {
  if (!c.field) return null;
  if (c.field === "skip") return <div className="change">整堂改成休息</div>;
  if (c.field === "scheduled_date") return <div className="change">日期 → <b>{fmt(c.field, c.new)}</b>{c.makeup && c.counts_in_week_no != null ? <span className="counts"> · 算第 {c.counts_in_week_no} 週</span> : null}</div>;
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

type Status = ApiProposal["status"];
const op = (c: ApiProposalChange): NonNullable<ApiProposalChange["op"]> => c.op ?? "change"; // cards stored before ops existed

/** The date a change belongs to (an added session: the day it lands on). */
const changeDate = (c: ApiProposalChange) => c.date ?? c.new_session?.scheduled_date ?? null;
/** The date a row is grouped under: a 補課 goes with the week it moves to (its own week is over), the rest with their own date. */
const rowDate = (r: { changes: ApiProposalChange[] }) => {
  const mk = r.changes.find((c) => c.makeup && c.field === "scheduled_date" && typeof c.new === "string");
  return mk ? (mk.new as string) : changeDate(r.changes[0]);
};
const weekNoOf = (date: string | null, weeks: ApiWeek[]) => (date ? weeks.find((w) => date >= w.week_start && date <= w.week_end)?.week_no ?? null : null);

/** Several changes to one session (a move plus a distance) read as one row. */
interface Row { op: ApiProposalChange["op"]; changes: ApiProposalChange[] }
function toRows(changes: ApiProposalChange[]): Row[] {
  const rows: Row[] = [];
  for (const c of changes) {
    const prev = op(c) === "change" && c.session_id ? rows.find((r) => r.op === "change" && r.changes[0].session_id === c.session_id) : undefined;
    if (prev) prev.changes.push(c);
    else rows.push({ op: op(c), changes: [c] });
  }
  return rows;
}

/** "休息 · 出國", "Easy · 6 km · 7:30 /km": what an added session is. */
function addedText(c: ApiProposalChange): string {
  const n = c.new_session;
  if (!n) return c.label ?? "";
  return [n.label, n.target_distance_m ? `${kmPlan(n.target_distance_m)} km` : null, n.target_pace_sec_km ? `${pace(n.target_pace_sec_km)} /km` : null, n.note].filter(Boolean).join(" · ");
}

/** "輕鬆跑 7 km · 7:15〜7:45": the session a removal takes out of the plan. */
function removedText(c: ApiProposalChange, s: ReturnType<typeof changeSession>): string {
  if (s && "content" in s) return [rowName(s), s.target?.split(" / ")[0]].filter(Boolean).join(" · ");
  return c.label ?? "這堂課";
}

function ChangeRow({ row, sessions }: { row: Row; sessions: ApiSession[] }) {
  const first = row.changes[0];
  const s = changeSession(first, sessions);
  const date = changeDate(first); // a 補課 is titled with the day it was missed
  const makeup = row.op === "change" && row.changes.some((c) => c.makeup);
  const title = row.op === "add" ? date && mdDow(date) : [date ? mdDow(date) : null, first.label ?? (s && "target_distance_m" in s ? shortName(s) : null)].filter(Boolean).join(" · ") || "課表上的一堂課";
  const flags = row.changes.flatMap((c) => c.flags ?? []);
  const reasons = row.changes.map((c) => c.reason).filter(Boolean);
  return (
    <div className={`proposal${row.op === "remove" ? " removed" : ""}`}>
      <div className="who">
        <Avatar session={s} />
        <div className="txt">
          <div className="t">{title}{row.op !== "change" ? <span className="op">{row.op === "add" ? "新增" : "刪除"}</span> : makeup ? <span className="op">補課</span> : null}</div>
          {row.op === "add" ? <div className="change">{addedText(first)}</div>
            : row.op === "remove" ? <div className="change"><s>{removedText(first, s)}</s></div>
            : row.changes.map((c, i) => <ChangeLine key={i} c={c} />)}
          {flags.map((f, i) => <div key={i} className="flag">{f}</div>)}
          {reasons.map((r, i) => <div key={i} className="reason">{r}</div>)}
        </div>
      </div>
    </div>
  );
}

/** Height (and opacity) transition for a block that comes and goes; closed means inert and hidden. */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return <div className={`collapse${open ? " open" : ""}`} inert={!open}><div>{children}</div></div>;
}

/** The new week description(s), "描述：舊 → 新"; the old one is only struck out while it differs (after apply the plan already has the new one). */
function weekDescs(w: ApiProposal["weeks"][number] | undefined, plan: ApiWeek | undefined): { k: string; was: string | null; now: string }[] {
  if (!w) return [];
  const out: { k: string; was: string | null; now: string }[] = [];
  if (w.focus) out.push({ k: "描述", was: plan?.focus && plan.focus !== w.focus ? plan.focus : null, now: w.focus });
  if (w.phase) out.push({ k: "階段", was: plan?.phase && plan.phase !== w.phase ? plan.phase : null, now: w.phase });
  return out;
}

function Impact({ impact }: { impact: ApiProposal["impact"] }) {
  return (
    <div className="impact">
      <h4>影響</h4>
      {([["不調整", impact.keep], ["調整後", impact.change], ["風險", impact.risk]] as const).map(([k, v]) => (
        <div key={k} className="row"><span className="k">{k}</span><span>{v}</span></div>
      ))}
    </div>
  );
}

/**
 * Woo's proposal card under a chat reply: one or more changes applied together (across weeks,
 * with added and removed sessions and new week descriptions), what happens if you do and don't,
 * the numbers he looked at, and amber flags for unusual changes. 採用 applies the whole card;
 * the thread is reloaded afterwards for his confirmation line. A single change in one week keeps
 * the narrow layout; anything bigger (or an A／B option) is full width and grouped by week.
 * `status` is what the page knows now (it just applied it, or a sibling was applied).
 */
export function ProposalCard({ proposal, status: st, sessions, weeks, chosen, onStatus, onChanged, onRepropose }: {
  proposal: ApiProposal; status: Status; sessions: ApiSession[]; weeks: ApiWeek[];
  /** A／B: the letter of the card that was applied, for the superseded one's "你選了 A". */
  chosen?: string | null;
  onStatus: (id: string, status: Status) => void; onChanged: () => void; onRepropose: (p: ApiProposal) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [basisOpen, setBasisOpen] = useState(false); // pending: the 依據 line
  const [foldOpen, setFoldOpen] = useState(false);   // decided: 依據 · 影響
  const [asked, setAsked] = useState(false);         // stale: 請 Woo 重看 was sent

  const changes = proposal.changes;
  const rows = toRows(changes);
  const weekNos = new Set(rows.map((r) => weekNoOf(rowDate(r), weeks)));
  const multi = !!proposal.option || changes.some((c) => op(c) !== "change") || weekNos.size > 1 || (proposal.weeks?.length ?? 0) > 0;
  const pending = st === "pending";
  const opt = proposal.option;
  const impact = proposal.impact?.keep ? proposal.impact : null;
  const text = proposal.basis_text || null;

  async function decide(action: "apply" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      const r = await postProposal(proposal.id, action);
      onStatus(proposal.id, r.proposal.status);
      for (const id of r.superseded ?? []) onStatus(id, "superseded");
      onChanged();
    } catch (e) {
      // 409: the plan changed since (the card is stale now), or it was already decided — reload so the server's word replaces the buttons.
      // 400: the card breaks a hard rule (race day, a day the athlete said is fixed); the api's sentence is English, so a fixed line.
      if (e instanceof ApiError && e.status === 409) onChanged();
      else setError(e instanceof ApiError ? (e.status === 400 ? "這張卡不能照用了（撞到比賽日、固定日，或同一天兩堂）" : e.message) : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  async function askAgain() {
    setBusy(true);
    setError(null);
    try {
      await onRepropose(proposal);
      setAsked(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  const decided = st === "applied" ? "已採用" : st === "dismissed" ? (multi ? "不用" : "不採用") : st === "stale" ? "課表已變" : st === "superseded" ? "已作廢" : null;
  const weekNosAll = [...new Set([...weekNos, ...(proposal.weeks ?? []).map((w) => w.week_no)])].sort((a, b) => (a ?? 0) - (b ?? 0));

  const rowEls = multi ? weekNosAll.map((n) => {
    const plan = weeks.find((w) => w.week_no === n);
    const inWeek = rows.filter((r) => weekNoOf(rowDate(r), weeks) === n);
    return (
      <div key={n ?? "none"} className="wk">
        {plan ? <div className="wk-h">第 {plan.week_no} 週 <span>· {md(plan.week_start)}–{md(plan.week_end)}</span></div> : null}
        {weekDescs(proposal.weeks?.find((w) => w.week_no === n), plan).map((d) => (
          <div key={d.k} className="wk-focus">{d.k}：{d.was ? <><s>{d.was}</s> → </> : null}<b>{d.now}</b></div>
        ))}
        <div className="rows">{inWeek.map((r, i) => <ChangeRow key={i} row={r} sessions={sessions} />)}</div>
      </div>
    );
  }) : rows.map((r, i) => <ChangeRow key={i} row={r} sessions={sessions} />);

  const body = (
    <>
      {rowEls}
      {proposal.flags.length ? <div className="flags">{proposal.flags.join(" · ")}</div> : null}
      {proposal.why ? <div className="why">{proposal.why}</div> : null}
      {impact || text ? (
        <>
          <Collapse open={pending}>
            {impact ? <Impact impact={impact} /> : null}
            {text ? (
              <div className={`basis ${basisOpen ? "open" : "folded"}`}>
                <button type="button" className="toggle" aria-expanded={basisOpen} onClick={() => setBasisOpen((v) => !v)}>
                  <span className="what"><b>依據</b>{basisOpen ? null : proposal.basis.map((b, i) => <span key={i}> · {b}</span>)}</span>
                  <span className="more">{basisOpen ? "收合 ⌃" : "展開 ›"}</span>
                </button>
                <Collapse open={basisOpen}><p>{text}</p></Collapse>
              </div>
            ) : null}
          </Collapse>
          {!pending ? (
            <div className="fold-wrap">
              <button type="button" className="fold" aria-expanded={foldOpen} onClick={() => setFoldOpen((v) => !v)}>
                <span><b>{text && impact ? "依據 · 影響" : text ? "依據" : "影響"}</b></span><span className="more">{foldOpen ? "收合 ⌃" : "展開 ›"}</span>
              </button>
              <Collapse open={foldOpen}>
                {impact ? <Impact impact={impact} /> : null}
                {text ? <div className="basis open"><p>{text}</p></div> : null}
              </Collapse>
            </div>
          ) : null}
        </>
      ) : proposal.basis.length ? <div className="basis"><b>依據</b>{proposal.basis.map((b, i) => <span key={i}> · {b}</span>)}</div> : null}
      {st === "stale" ? (
        <div className="conflict">
          <div>課表已變，請 Woo 重看</div>
          {proposal.stale_reason ? <div className="why-stale">{proposal.stale_reason}</div> : null}
        </div>
      ) : null}
      <Collapse open={pending || (st === "stale" && !asked)}>
        <div className="actions">
          {st === "stale" ? (
            <>
              <button type="button" className="chip primary" disabled={busy} onClick={() => void askAgain()}>{busy ? "…" : "請 Woo 重看"}</button>
              <button type="button" className="chip" disabled={busy} onClick={() => void decide("dismiss")}>算了</button>
            </>
          ) : (
            <>
              <button type="button" className="chip primary" disabled={busy} onClick={() => void decide("apply")}>{busy ? "…" : opt ? `採用 ${opt.letter}` : multi ? "採用整張" : "採用"}</button>
              <button type="button" className="chip" disabled={busy} onClick={() => void decide("dismiss")}>{multi ? "不用" : "不採用"}</button>
              {multi ? <Link to={`/plan?proposal=${encodeURIComponent(proposal.id)}`} className="preview">在課表上看 ›</Link> : null}
            </>
          )}
        </div>
      </Collapse>
      {st === "stale" && asked ? <p className="hint">已請 Woo 重看，他會用現在的課表重發一張。</p> : null}
      {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
    </>
  );

  return (
    <div className={`proposal-card${multi ? " multi" : ""}${st !== "pending" ? ` ${st}` : ""}`}>
      {decided && st !== "superseded" ? <span className={`decided ${st}`}>{decided}</span> : null}
      {opt ? (
        <div className="opt-head">
          <span className="letter">{opt.letter}</span>
          <span className="title">{opt.title}</span>
          {opt.recommended && st !== "superseded" ? <span className="rec">Woo 偏這個</span> : null}
          {st === "superseded" ? <span className="gone">已作廢</span> : null}
        </div>
      ) : null}
      {st === "superseded" ? <SupersededNote count={rows.length} chosen={chosen ?? null} open={foldOpen} onToggle={() => setFoldOpen((v) => !v)} /> : null}
      {opt ? <Collapse open={st !== "superseded" || foldOpen}>{body}</Collapse> : body}
    </div>
  );
}

/** The two-line form of an A／B card the other option replaced: "你選了 A · 4 個改動 · 展開 ›". */
function SupersededNote({ count, chosen, open, onToggle }: { count: number; chosen: string | null; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="folded-note" aria-expanded={open} onClick={onToggle}>
      {chosen ? `你選了 ${chosen}` : "你選了另一張"} · {count} 個改動 · {open ? "收合 ⌃" : "展開 ›"}
    </button>
  );
}

/**
 * Woo's 記下來 card: a limit the athlete mentioned (a trip, an injury, a fixed day), saved
 * only when accepted — it is not part of any proposal. Deciding twice is a 409 (the thread
 * reloads and shows the stored state).
 */
export function ConstraintCard({ constraint, onChanged }: { constraint: ApiConstraint; onChanged: () => void }) {
  const [status, setStatus] = useState<ApiConstraint["status"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = status ?? constraint.status;

  async function decide(action: "accept" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      const r = await postConstraint(constraint.id, action);
      setStatus(r.constraint.status);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) onChanged();
      else setError(e instanceof ApiError ? e.message : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`memo-card${st === "dismissed" ? " dismissed" : ""}`}>
      {st === "active" ? <span className="decided">已記下</span> : null}
      <div className="who">
        <div className="avatar rest cjk" aria-hidden="true">記</div>
        <div className="txt">
          <div className="t">記下來：{constraint.text}</div>
          <div className="s">{periodLabel(constraint)} · {st === "active" ? "設定頁可以刪" : "之後排課會照這條"}</div>
        </div>
      </div>
      <Collapse open={st === "proposed"}>
        <div className="actions">
          <button type="button" className="chip primary" disabled={busy} onClick={() => void decide("accept")}>{busy ? "…" : "記下來"}</button>
          <button type="button" className="chip" disabled={busy} onClick={() => void decide("dismiss")}>不用</button>
        </div>
      </Collapse>
      {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
    </div>
  );
}
