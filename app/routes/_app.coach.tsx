import { Fragment, useEffect, useState } from "react";
import { Link, redirect, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/_app.coach";
import { SendIcon } from "../components/icons";
import { CoachProposals } from "../components/proposals";
import { CoachAvatar, VerdictTag } from "../components/ui";
import { ApiError, getActivities, getCoach, getWeekly, postCoachMessage, putCoachSeen } from "../lib/api";
import { hasSession } from "../lib/auth";
import { md, mdDow, timeJst, toJstDate } from "../lib/date";
import { km, pace } from "../lib/format";
import { useReviewPolling } from "../lib/use-review-polling";
import { usePlan } from "../lib/use-plan";
import type { ApiActivity, ApiCoachMessage } from "../types/api";

// Woo's thread: weekly reviews (with their proposals), each run's verdict, and the
// conversation. The athlete writes at the bottom; the reply is polled for.

const MAX_CHARS = 500;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  if (!hasSession()) throw redirect("/login");
  const quoteId = new URL(request.url).searchParams.get("quote");
  try {
    const [coach, weekly, quoted] = await Promise.all([
      getCoach(),
      getWeekly().catch(() => ({ reviews: [] })),
      quoteId ? getActivities().then((r) => r.activities.find((a) => a.id === quoteId) ?? null).catch(() => null) : Promise.resolve(null),
    ]);
    putCoachSeen().catch(() => { /* the badge just stays until next time */ });
    return { ...coach, reviews: weekly.reviews, quoted };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    throw e;
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "教練 Woo · 富士山マラソン 2026" }];
}

function DayRule({ date }: { date: string }) {
  return <div className="day-rule"><span />{mdDow(date)}<span /></div>;
}

function CoachMessage({ m, children }: { m: ApiCoachMessage; children: React.ReactNode }) {
  return (
    <article className="msg coach">
      <CoachAvatar />
      <div className="body">
        <div className="meta"><b>Woo</b><span className="grey">· {timeJst(m.created_at)}</span></div>
        {children}
      </div>
    </article>
  );
}

function AthleteMessage({ m, onRetry }: { m: ApiCoachMessage; onRetry?: () => void }) {
  return (
    <div className="msg me">
      <div className="bubble">
        {m.quote ? <div className="quote">{m.quote}</div> : null}
        {m.text}
      </div>
      <span className="when">
        {m.status === "failed" ? <>Woo 沒收到{m.error ? `（${m.error}）` : ""} · <button type="button" onClick={onRetry}>再送一次</button></> : timeJst(m.created_at)}
      </span>
    </div>
  );
}

function quoteLine(a: ApiActivity): string {
  const run = !a.sport_type || ["Run", "TrailRun", "VirtualRun"].includes(a.sport_type);
  return [`${md(toJstDate(a.start_time))} ${km(a.distance_m)} km`, run ? `${pace(a.avg_pace_sec_km)}/km` : null, a.avg_hr != null ? `心拍 ${a.avg_hr}` : null, a.review?.verdict ?? null].filter(Boolean).join(" · ");
}

export default function Coach({ loaderData }: Route.ComponentProps) {
  const { messages, reviews, quoted } = loaderData;
  const view = usePlan();
  const revalidator = useRevalidator();
  const [, setSearch] = useSearchParams();

  const [text, setText] = useState("");
  const [quote, setQuote] = useState<ApiActivity | null>(quoted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The reply is on its way while the newest athlete message is still pending.
  const last = messages[messages.length - 1];
  const waiting = !!last && last.role === "athlete" && last.status === "pending";
  const { timedOut, restart } = useReviewPolling(waiting);

    const count = messages.length;
  useEffect(() => { window.scrollTo({ top: document.documentElement.scrollHeight }); }, [count, waiting]);

  async function send(body: string, activityId?: string) {
    const t = body.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postCoachMessage({ text: t, activity_id: activityId });
      setText("");
      setQuote(null);
      setSearch({}, { replace: true });
      await revalidator.revalidate();
      restart();
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 429 ? "今天的額度用完了，明天再聊。" : e.message) : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  // The layout's plan still says "unread" from before this page marked the thread
  // seen; reload it once so the tab's dot is gone when the athlete leaves.
  const unread = view?.data.coach_unread ?? 0;
  useEffect(() => { if (unread > 0) void revalidator.revalidate(); }, [unread, revalidator]);

  const sessions = view?.data.sessions ?? [];

  return (
    <>
      <header className="topbar coach-head">
        <CoachAvatar />
        <div><h1>Woo</h1><div className="sub">你的教練 · 只聊跑步和課表</div></div>
      </header>
      <main className="thread">
        {messages.length === 0 ? (
          <p className="empty">Woo 還沒說話。跑完第一堂課、或每週日的回顧之後，這裡會出現他的訊息。你也可以先問他。</p>
        ) : null}
        {messages.map((m, i) => {
          const day = toJstDate(m.created_at);
          const rule = i === 0 || toJstDate(messages[i - 1].created_at) !== day ? <DayRule date={day} /> : null;
          let node: React.ReactNode;
          if (m.role === "athlete") {
            node = <AthleteMessage m={m} onRetry={() => void send(m.text, m.activity_id ?? undefined)} />;
          } else if (m.kind === "weekly") {
            const w = reviews.find((r) => r.id === m.weekly_review_id) ?? null;
            node = (
              <CoachMessage m={m}>
                <p className="text">{m.text}</p>
                {w ? <CoachProposals review={w} sessions={sessions} embedded onChanged={() => void revalidator.revalidate()} /> : null}
              </CoachMessage>
            );
          } else if (m.kind === "review") {
            node = (
              <CoachMessage m={m}>
                <div className="head"><b>{m.review?.label}</b><VerdictTag verdict={m.review?.verdict} /></div>
                <p className="text">{m.text}</p>
                {m.review?.reminder ? <p className="next">→ {m.review.reminder}</p> : null}
                {m.activity_id ? <Link to={`/activities/${m.activity_id}`} className="chip" style={{ marginTop: 8 }}>看報告</Link> : null}
              </CoachMessage>
            );
          } else {
            node = <CoachMessage m={m}><p className="text">{m.text}</p></CoachMessage>;
          }
          return <Fragment key={m.id}>{rule}{node}</Fragment>;
        })}
        {waiting ? (
          <article className="msg coach typing">
            <CoachAvatar />
            <div className="body">{timedOut ? "Woo 回得比較慢，稍後再回來看。" : <><span className="typing-dots"><i /><i /><i /></span>Woo 輸入中…</>}</div>
          </article>
        ) : null}
      </main>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(text, quote?.id); }}>
        {quote ? (
          <div className="quote-chip">
            <span>引用 {quoteLine(quote)}</span>
            <button type="button" aria-label="移除引用" onClick={() => { setQuote(null); setSearch({}, { replace: true }); }}>×</button>
          </div>
        ) : null}
        <div className="row">
          <textarea
            id="coach-text"
            rows={1}
            value={text}
            maxLength={MAX_CHARS}
            placeholder="跟 Woo 聊跑步、課表…"
            aria-label="問 Woo"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text, quote?.id); } }}
          />
          <button type="submit" className="send" aria-label="送出" disabled={busy || !text.trim()}><SendIcon /></button>
        </div>
        {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
      </form>
    </>
  );
}
