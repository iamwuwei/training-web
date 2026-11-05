import { timeJst, toJstDate } from "../lib/date";
import { mdPlain } from "../lib/groups";
import { verdictKind } from "../lib/labels";
import type { ApiSharedReview } from "../types/api";
import { CoachAvatar, Reminders, verdictBadge } from "./ui";

/**
 * Woo's verdict on someone else's run, the same block as the report page (verdict word, comment, 下次 band, reminders,
 * "Woo · time", 已更正) without the buttons. In the 群組 sheets the word is ink with the colour on the dot (CSS: `.event-sheet .verdict-block`).
 */
export function WooVerdict({ review }: { review: Pick<ApiSharedReview, "verdict" | "reminders" | "comment" | "source" | "failed" | "created_at" | "corrected_at"> }) {
  if (review.failed || !review.verdict) {
    return (
      <section className="verdict-block">
        <h2 className="pending-h">Woo 這次沒有判定</h2>
      </section>
    );
  }
  const vk = verdictKind(review.verdict);
  const when = `${mdPlain(toJstDate(review.created_at))} ${timeJst(review.created_at)}`;
  return (
    <section className={`verdict-block ${vk ?? ""}`}>
      <h2>{review.verdict}</h2>
      {review.comment ? <p className="comment">{review.comment}</p> : null}
      {review.reminders[0] ? <div className="next-band"><b>下次：</b>{review.reminders[0]}</div> : null}
      {review.reminders.length > 1 ? <Reminders items={review.reminders.slice(1)} /> : null}
      <div className="src">
        <span className="who">
          {review.source === "claude" ? <><CoachAvatar size={20} badge={verdictBadge(review.verdict)} />Woo · {when}{review.corrected_at ? <>{" "}<span className="corrected">· 已更正</span></> : null}</> : "教練判定 · 手動"}
        </span>
      </div>
    </section>
  );
}

/** Woo has not judged it yet: the row says 分析中, the sheet says to come back. */
export function WooPending() {
  return (
    <section className="verdict-block">
      <h2 className="pending-h">Woo 分析中</h2>
      <p className="fixed">判定出來之後，重新打開就看得到。</p>
    </section>
  );
}
