import { eventTime, mdPlain } from "../lib/groups";
import type { ApiGroupEvent } from "../types/api";
import { verdictKind } from "../lib/labels";

/** The verdict word of a session_done row: the colour is on the dot, the word stays ink. Nothing when the analysis failed. */
function EventVerdict({ session }: { session: NonNullable<ApiGroupEvent["session"]> }) {
  if (session.judging) return <span className="ev-verdict judging">Woo 分析中</span>;
  const kind = verdictKind(session.verdict);
  return kind ? <span className={`ev-verdict ${kind}`}>{session.verdict}</span> : null;
}

/**
 * One line of 消息中心 (72 px). 完成了 lines open the detail sheet (the whole row); 加入／離開 are plain facts.
 * `isNew`: an ink dot, for the newest events that were unseen when the page opened.
 */
export function GroupEventRow({ event: e, today, isNew, onOpen }: { event: ApiGroupEvent; today: string; isNew: boolean; onOpen: (e: ApiGroupEvent) => void }) {
  const who = e.member.is_me ? "你" : e.member.display_name;
  const time = eventTime(e.created_at, today);
  const avatar = <div className="avatar member" aria-hidden="true">{e.member.display_name.slice(0, 1)}</div>;
  const dot = isNew ? <i className="new" role="img" aria-label="新的" /> : null;
  if (e.kind === "session_done" && e.session) {
    const tag = <EventVerdict session={e.session} />;
    return (
      <button type="button" className="event-row" onClick={() => onOpen(e)}>
        {avatar}
        <div className="body">
          <div className="l1"><span className="t"><b>{who}</b> 完成了 {mdPlain(e.session.date)} 的 {e.session.label}</span>{dot}</div>
          <div className="l2">{tag}{tag ? <span aria-hidden="true">·</span> : null}<span>{time}</span><span className="open">看詳細 ›</span></div>
        </div>
      </button>
    );
  }
  return (
    <div className="event-row fact">
      {avatar}
      <div className="body">
        <div className="l1"><span className="t"><b>{who}</b> {e.kind === "joined" ? "加入了" : "離開了"}</span>{dot}</div>
        <div className="l2"><span>{time}</span></div>
      </div>
    </div>
  );
}
