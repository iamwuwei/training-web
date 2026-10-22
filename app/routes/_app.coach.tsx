import { Fragment, useEffect, useState } from "react";
import { Link, redirect, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/_app.coach";
import { SendIcon } from "../components/icons";
import { CoachProposals } from "../components/proposals";
import { CoachAvatar, VerdictTag, verdictBadge } from "../components/ui";
import { ApiError, getActivities, getCoach, getWeekly, postCheckinPick, postCheckinReset, postCoachMessage, putCoachSeen } from "../lib/api";
import { hasSession } from "../lib/auth";
import { md, mdDow, timeJst, toJstDate } from "../lib/date";
import { km, pace } from "../lib/format";
import { useReviewPolling } from "../lib/use-review-polling";
import { usePlan } from "../lib/use-plan";
import type { ApiActivity, ApiCoachMessage } from "../types/api";

// Woo's thread: weekly reviews (with their proposals), each run's verdict, his
// post-run check-in (which activity → how did it feel → verdict), and the
// conversation. The athlete writes at the bottom; replies are polled for.

const MAX_CHARS = 500;
const RPE_WORDS = ["", "很輕鬆", "輕鬆", "輕鬆", "適中", "適中", "適中", "有點累", "累", "很累", "極限"];

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

function CoachMessage({ m, children, badge }: { m: ApiCoachMessage; children: React.ReactNode; badge?: "check" | "warn" | null }) {
  return (
    <article className="msg coach">
      <CoachAvatar badge={badge} />
      <div className="body">
        <div className="meta"><b>Woo</b><span className="grey">· {timeJst(m.created_at)}</span></div>
        {children}
      </div>
    </article>
  );
}

function AthleteMessage({ m, onRetry, onReset, busy }: { m: ApiCoachMessage; onRetry?: () => void; onReset?: () => void; busy?: boolean }) {
  return (
    <div className="msg me">
      <div className={`bubble${m.kind === "pick" ? " pick" : ""}`}>
        {m.quote ? <div className="quote">{m.quote}</div> : null}
        {m.kind === "pick" && m.text !== "都不是" ? <i className="strava-dot" aria-hidden="true" /> : null}
        {m.text}
        {m.rpe ? <span className="rpe-tag">RPE {m.rpe}</span> : null}
      </div>
      <span className="when">
        {m.status === "failed" ? <>Woo 沒收到{m.error ? `（${m.error}）` : ""} · {onRetry ? <button type="button" onClick={onRetry}>再送一次</button> : null}</> : timeJst(m.created_at)}
        {onReset ? <> · <button type="button" onClick={onReset} disabled={busy}>選錯了 ›</button></> : null}
      </span>
    </div>
  );
}

/** Woo's "which activity was today's session?" with the candidates as a scrolling chip row. */
function CheckinChips({ m, busy, onPick }: { m: ApiCoachMessage; busy: boolean; onPick: (body: { activity_id?: string; session_id?: string; none?: boolean }) => void }) {
  const c = m.checkin;
  if (!c || c.state !== "open") return null;
  return (
    <div className="chips-scroll" role="group" aria-label="選擇">
      {c.candidates.map((cand, i) => (
        <div key={cand.activity_id ?? cand.session_id ?? i} className="chip-col">
          <span className={`tag${i === 0 ? "" : " blank"}`}>{i === 0 ? "Woo 猜這個" : "·"}</span>
          <button type="button" className={`chip tall${i === 0 ? " primary" : ""}`} disabled={busy} onClick={() => onPick(cand.activity_id ? { activity_id: cand.activity_id } : { session_id: cand.session_id })}>
            {cand.activity_id ? <i className="strava-dot" aria-hidden="true" /> : null}{cand.label}
          </button>
        </div>
      ))}
      <div className="chip-col">
        <span className="tag blank">·</span>
        <button type="button" className="chip tall muted" disabled={busy} onClick={() => onPick({ none: true })}>{c.mode === "activity" ? "都不是 ›" : "不算課表"}</button>
      </div>
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
  const [rpe, setRpe] = useState<number | null>(null);
  const [quote, setQuote] = useState<ApiActivity | null>(quoted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The reply is on its way while the newest athlete message is still pending
  // (a chat reply, Woo's question after a pick, or the verdict after an answer).
  const last = messages[messages.length - 1];
  const waiting = !!last && last.role === "athlete" && last.status === "pending";
  const { timedOut, restart } = useReviewPolling(waiting);

  // Woo's open question (the last message) turns the composer into the answer box.
  const openAsk = last && last.kind === "ask" && last.ask?.state === "open" ? last : null;

  const count = messages.length;
  useEffect(() => { window.scrollTo({ top: document.documentElement.scrollHeight }); }, [count, waiting]);

  // The layout's plan still says "unread" from before this page marked the thread
  // seen; reload it once so the tab's dot is gone when the athlete leaves.
  const unread = view?.data.coach_unread ?? 0;
  useEffect(() => { if (unread > 0) void revalidator.revalidate(); }, [unread, revalidator]);

  async function send(body: string, activityId?: string) {
    const t = body.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postCoachMessage(openAsk ? { text: t, answer_to: openAsk.id, rpe: rpe ?? undefined } : { text: t, activity_id: activityId });
      setText("");
      setRpe(null);
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

  // 選錯了 / 重新選: only the newest check-in can be undone.
  const lastCheckinIdx = messages.map((m) => m.kind).lastIndexOf("checkin");
  const lastCheckin = lastCheckinIdx >= 0 ? messages[lastCheckinIdx] : null;
  const lastPickIdx = messages.map((m) => m.kind).lastIndexOf("pick");
  async function reset() {
    if (!lastCheckin || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postCheckinReset(lastCheckin.id);
      await revalidator.revalidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  async function pick(checkinId: string, body: { activity_id?: string; session_id?: string; none?: boolean }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await postCheckinPick(checkinId, body);
      await revalidator.revalidate();
      restart();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  const sessions = view?.data.sessions ?? [];

  // A long run farther than any run before it is worth a line of its own.
  const allRuns = (view ? [...view.data.activities, ...view.data.unassigned] : []).filter((a) => !a.sport_type || ["Run", "TrailRun", "VirtualRun"].includes(a.sport_type));
  function firstTime(activityId: string | null): number | null {
    if (!activityId) return null;
    const a = allRuns.find((x) => x.id === activityId);
    if (!a || a.distance_m < 10_000) return null;
    const before = allRuns.filter((x) => x.start_time < a.start_time);
    if (before.some((x) => x.distance_m >= a.distance_m)) return null;
    return Math.round(a.distance_m / 1000);
  }

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
            const resettable = m.kind === "pick" && i === lastPickIdx && i > lastCheckinIdx && lastCheckin?.checkin?.state === "picked";
            node = <AthleteMessage m={m} busy={busy} onReset={resettable ? () => void reset() : undefined} onRetry={m.kind === "chat" && !m.rpe ? () => void send(m.text, m.activity_id ?? undefined) : undefined} />;
          } else if (m.kind === "weekly") {
            const w = reviews.find((r) => r.id === m.weekly_review_id) ?? null;
            node = (
              <CoachMessage m={m}>
                <p className="text">{m.text}</p>
                {w ? <CoachProposals review={w} sessions={sessions} embedded onChanged={() => void revalidator.revalidate()} /> : null}
              </CoachMessage>
            );
          } else if (m.kind === "review") {
            const first = firstTime(m.activity_id);
            node = (
              <CoachMessage m={m} badge={verdictBadge(m.review?.verdict)}>
                <div className="head"><b>{m.review?.label}</b><VerdictTag verdict={m.review?.verdict} /></div>
                {first ? <div className="celebrate"><div className="k">第一次</div><div className="v"><span className="num">{first}</span><span>km 長跑</span></div></div> : null}
                <p className="text">{m.text}</p>
                {m.review?.reminder ? <p className="next">→ {m.review.reminder}</p> : null}
                {m.activity_id ? <Link to={`/activities/${m.activity_id}`} className="chip" style={{ marginTop: 8 }}>看報告</Link> : null}
              </CoachMessage>
            );
          } else if (m.kind === "checkin") {
            node = (
              <CoachMessage m={m}>
                <p className="text">{m.text}</p>
                <CheckinChips m={m} busy={busy} onPick={(body) => void pick(m.id, body)} />
                {i === lastCheckinIdx && m.checkin?.state === "dismissed" ? <button type="button" className="relink" onClick={() => void reset()} disabled={busy}>重新選 ›</button> : null}
              </CoachMessage>
            );
          } else {
            node = <CoachMessage m={m}><p className="text">{m.text}</p></CoachMessage>;
          }
          return <Fragment key={m.id}>{rule}{node}</Fragment>;
        })}
        {waiting ? (
          <article className="msg coach typing">
            <CoachAvatar badge="typing" />
            <div className="body">{timedOut ? "Woo 回得比較慢，稍後再回來看。" : <><span className="typing-dots"><i /><i /><i /></span>Woo 輸入中…</>}</div>
          </article>
        ) : null}
      </main>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(text, quote?.id); }}>
        {quote && !openAsk ? (
          <div className="quote-chip">
            <span>引用 {quoteLine(quote)}</span>
            <button type="button" aria-label="移除引用" onClick={() => { setQuote(null); setSearch({}, { replace: true }); }}>×</button>
          </div>
        ) : null}
        {openAsk ? (
          <div className="rpe-row" role="radiogroup" aria-label="累的程度 1 到 10">
            <span className="k">RPE</span>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rpe === n} className={`rpe${rpe === n ? " on" : ""}`} onClick={() => setRpe(rpe === n ? null : n)} title={RPE_WORDS[n]}>{n}</button>
            ))}
          </div>
        ) : null}
        <div className="row">
          <textarea
            id="coach-text"
            rows={1}
            value={text}
            maxLength={MAX_CHARS}
            placeholder={openAsk ? "回 Woo：感覺怎麼樣…" : "跟 Woo 聊跑步、課表…"}
            aria-label={openAsk ? "回 Woo" : "問 Woo"}
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
