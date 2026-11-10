import { useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { postCoachMessage } from "../lib/api";
import { addDays, md } from "../lib/date";
import type { PlanView } from "../lib/plan";
import { refreshWeekly, weekOfReview } from "../lib/use-weekly";
import { patchProposalStatus, useWeeklyMessage } from "../lib/use-weekly-message";
import type { ApiProposal, ApiWeeklyReview } from "../types/api";
import { CoachProposals } from "./proposals";
import { MdText } from "./md-text";
import { BottomSheet } from "./sheet";
import { WeeklyReviewBody, type WeeklyCardHandlers } from "./weekly-review";

/**
 * The weekly-review sheet of 課表 and 今天: the review of one week, drawn by the same `WeeklyReviewBody` as in Woo's thread (so a card
 * is the same card there). The message with the card and the question is looked for in the thread; the summary and the old-style
 * suggestions come from /weekly and show even when the thread cannot be read. Questions are only read here: answering one rewrites the
 * review, and that wait is drawn in the thread. `review` null = closed.
 */
export function WeeklyReviewSheet({ review, view, onClose }: { review: ApiWeeklyReview | null; view: PlanView; onClose: () => void }) {
  const revalidator = useRevalidator();
  const { message, state, refresh } = useWeeklyMessage(review);
  // What this sheet just did to a card: shown at once; once the stored status is anything but pending, the stored one wins (same rule as the thread).
  const [decisions, setDecisions] = useState<Record<string, ApiProposal["status"]>>({});
  const justDecided = useRef(false);

  const weeks = view.data.weeks;
  const sessions = view.data.sessions;
  const week = review ? weekOfReview(review, weeks) : null;
  const from = week?.week_start ?? review?.week_start ?? "";
  const to = week?.week_end ?? (review ? addDays(review.week_start, 6) : "");
  const threadTo = message ? `/coach?message=${encodeURIComponent(message.id)}` : "/coach";

  // An old-style suggestion was decided (or turned out to be): the plan behind and the reviews are read again.
  const onAdjusted = () => { void revalidator.revalidate(); void refreshWeekly(); };

  const cards: WeeklyCardHandlers = {
    statusOf: (p) => (p.status !== "pending" ? p.status : decisions[p.id] ?? "pending"),
    onStatus: (id, status) => {
      justDecided.current = true;
      setDecisions((d) => ({ ...d, [id]: status }));
      patchProposalStatus(id, status);
    },
    // The plan behind is read again, and the review and its message with it: a 409 turned the card stale (or someone decided it elsewhere).
    // After our own decision the cached card already says it, so the message is not read again.
    onAdjusted,
    onChanged: () => {
      onAdjusted();
      if (justDecided.current) justDecided.current = false;
      else refresh({ silent: true });
    },
    // 請 Woo 重看: the same line the thread sends; his new card arrives in the thread (the card says so itself).
    onRepropose: async (p) => { await postCoachMessage({ text: "課表變了，這張重看一次", re_propose: p.id }); },
  };

  const title = week ? `第 ${week.week_no} 週回顧` : "週回顧";
  return (
    <BottomSheet open={!!review} onClose={onClose} label="週回顧" className="review-sheet">
      {review ? (
        <>
          <div className="wr-head st">
            <div className="sheet-title">{title}</div>
            <div className="wr-sub">{md(from)}–{md(to)} · Woo</div>
          </div>
          {state === "ready" && message ? (
            <WeeklyReviewBody m={message} review={review} view={view} sessions={sessions} weeks={weeks} busy={false} cards={cards} threadTo={threadTo} />
          ) : state === "loading" || state === "idle" ? (
            <div className="wr-sk" aria-busy="true" aria-label="載入中"><div className="sk" /><div className="sk" /><div className="sk" /></div>
          ) : (
            <div className="weekly-body">
              {review.summary ? <MdText text={review.summary} /> : null}
              <CoachProposals review={review} sessions={sessions} embedded onChanged={onAdjusted} />
              {state === "error" ? (
                <div className="wr-error" role="alert">
                  <span>讀不到這週的提案和問句</span>
                  <button type="button" className="chip" onClick={() => refresh()}>再試一次</button>
                </div>
              ) : null}
            </div>
          )}
          {state === "ready" ? <div className="wr-foot"><Link className="wr-thread" to={threadTo}>在對話裡看 ›</Link></div>
            : state === "missing" ? <div className="wr-foot"><p className="cancelled">對話裡找不到這則</p></div> : null}
        </>
      ) : null}
    </BottomSheet>
  );
}
