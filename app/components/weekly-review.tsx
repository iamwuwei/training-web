import { Link } from "react-router";
import { md, mdDow } from "../lib/date";
import { movedCountsIn, type PlanView } from "../lib/plan";
import type { ApiCoachMessage, ApiProposal, ApiSession, ApiWeek, ApiWeeklyAsk, ApiWeeklyReview } from "../types/api";
import { MdText } from "./md-text";
import { ConstraintCard, CoachProposals, ProposalCard } from "./proposals";
import { WooStatus } from "./woo-status";

// Woo's weekly review as the thread draws it: the text, the question about a session with no record, the old-style
// suggestions, the proposal card. The thread and the weekly-review sheet (課表、今天) both draw it with `WeeklyReviewBody`,
// so a card is the same card in both places.

/** Woo's cards failed the api's check: only his text stays. */
export function Rejected() {
  return <p className="cancelled">Woo 的提案沒過格式檢查，再問他一次</p>;
}

/**
 * The weekly review's question about a key session with no record: the question itself in
 * a quote block (the api builds it; the review text only says what it can see), the two
 * answers under it, then what the review is waiting for. After 沒跑 the review is rewritten
 * in place — `rerun` is that wait ("Woo 在重寫…"), or that we gave up polling for it.
 * Without `onAnswer` (the sheet) the question is only read: an open one points to the thread.
 */
export function WeeklyAskBlock({ ask, busy, rerun, stage, madeUp, onAnswer, threadTo }: { ask: ApiWeeklyAsk; busy: boolean; rerun: "pending" | "gave-up" | null; stage: string | null; /** A 補課 closed this question ("已改期，補到 10/30 週五"), not the athlete's 沒跑. */ madeUp: string | null; onAnswer?: (answer: "synced" | "skipped") => void; threadTo?: string }) {
  return (
    <div className="ask">
      <div className="ask-block"><div className="q">{ask.question}</div></div>
      {ask.state === "open" ? (
        onAnswer ? (
          <div className="chips-row" role="group" aria-label={`${md(ask.date)} 的${ask.label}有沒有跑`}>
            <button type="button" className="chip" disabled={busy} onClick={() => onAnswer("synced")}>還沒同步</button>
            <button type="button" className="chip" disabled={busy} onClick={() => onAnswer("skipped")}>沒跑</button>
          </div>
        ) : <div className="said">還沒回答，{threadTo ? <Link to={threadTo}>到對話裡回 ›</Link> : "到對話裡回"}</div>
      ) : (
        <div className="said">{madeUp && ask.state === "skipped" ? madeUp : `你說：${ask.state === "synced" ? "還沒同步" : "沒跑"}`}</div>
      )}
      {rerun === "pending" ? <div className="said"><WooStatus stage={stage} fallback="Woo 在重寫這週的回顧" /></div>
        : rerun === "gave-up" ? <div className="said">回顧還在重寫，稍後再回來看</div>
        : ask.state !== "skipped" ? <div className="said">{ask.label} 確定之後我再給下週的建議。</div>
        : null}
    </div>
  );
}

/** The weekly question for a session a 補課 has since moved: "已改期，補到 10/30 週五" (· 算第 N 週 when it counts in another week). */
function madeUpText(ask: ApiWeeklyAsk, view: PlanView | null): string | null {
  const s = view?.data.sessions.find((x) => x.id === ask.session_id);
  if (!view || !s?.moved_to_date) return null;
  const n = movedCountsIn(view, s);
  return `已改期，補到 ${mdDow(s.moved_to_date)}${n != null && n !== s.week_no ? ` · 算第 ${n} 週` : ""}`;
}

/** What a card does on this page: its status (the stored one wins over what this page just did), and what happens after it was pressed. */
export interface WeeklyCardHandlers {
  statusOf: (p: ApiProposal) => ApiProposal["status"];
  onStatus: (id: string, status: ApiProposal["status"]) => void;
  onChanged: () => void;
  /** An old-style suggestion was decided; `onChanged` when not given. */
  onAdjusted?: () => void;
  onRepropose: (p: ApiProposal) => Promise<void>;
}

/**
 * One weekly review message (everything under Woo's name line): the 「已更新」 pill, the text, the 補課 lines, the questions,
 * the old-style suggestions of `review`, the card, the grey lines. `onAnswerAsk` and `rerun` are the thread's (answering a question rewrites
 * the review, and the wait for that is drawn there); the sheet leaves them out and passes `threadTo`, where an open question is answered.
 */
export function WeeklyReviewBody({ m, review, view, sessions, weeks, busy, rerun, cards, onAnswerAsk, threadTo }: {
  m: ApiCoachMessage; review: ApiWeeklyReview | null; view: PlanView | null; sessions: ApiSession[]; weeks: ApiWeek[]; busy: boolean;
  rerun?: "pending" | "gave-up" | null; cards: WeeklyCardHandlers;
  onAnswerAsk?: (ask: ApiWeeklyAsk, answer: "synced" | "skipped") => void; threadTo?: string;
}) {
  const wm = m.weekly;
  return (
    <div className="weekly-body">
      {wm?.updated ? <div className="updated"><span aria-hidden="true">⟳</span> 已更新 · {wm.updated.reason}</div> : null}
      <MdText text={m.text} />
      {wm?.makeups?.length ? <div className="makeups">{wm.makeups.map((x, i) => <div key={i}>這週有補課：{md(x.from)} 的 {x.label} 補到 {md(x.to)}（{x.done ? "已完成" : "待跑"}）</div>)}</div> : null}
      {wm?.asks.map((ask) => <WeeklyAskBlock key={ask.session_id} ask={ask} busy={busy} madeUp={madeUpText(ask, view)} rerun={rerun && ask.state === "skipped" ? rerun : null} stage={m.stage} onAnswer={onAnswerAsk ? (answer) => onAnswerAsk(ask, answer) : undefined} threadTo={threadTo} />)}
      {review ? <CoachProposals review={review} sessions={sessions} embedded onChanged={cards.onAdjusted ?? cards.onChanged} /> : null}
      {m.proposal ? <ProposalCard proposal={m.proposal} status={cards.statusOf(m.proposal)} sessions={sessions} weeks={weeks} chosen={null} onStatus={cards.onStatus} onChanged={cards.onChanged} onRepropose={cards.onRepropose} /> : null}
      {m.constraint ? <ConstraintCard constraint={m.constraint} onChanged={cards.onChanged} /> : null}
      {m.proposal_rejected ? <Rejected /> : null}
      {wm?.cancelled.length ? <p className="cancelled">{wm.cancelled.map((c) => `原本「${c}」的建議已取消`).join("；")}</p> : null}
    </div>
  );
}
