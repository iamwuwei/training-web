import { Fragment, useEffect, useState } from "react";
import { Link, redirect, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/_app.coach";
import { SendIcon } from "../components/icons";
import { CoachProposals, ProposalCard } from "../components/proposals";
import { CoachAvatar, VerdictTag, verdictBadge } from "../components/ui";
import { ApiError, getActivities, getCoach, getWeekly, postCheckinPick, postCheckinReset, postCoachMessage, postWeeklyAsk, putCoachSeen } from "../lib/api";
import { hasSession } from "../lib/auth";
import { md, mdDow, timeJst, toJstDate } from "../lib/date";
import { km, pace } from "../lib/format";
import { useReviewPolling } from "../lib/use-review-polling";
import { usePlan } from "../lib/use-plan";
import type { ApiActivity, ApiCoachMessage, ApiWeeklyAsk } from "../types/api";

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

function CoachMessage({ m, children, badge }: { m: ApiCoachMessage; children: React.ReactNode; badge?: "check" | "warn" | "typing" | null }) {
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
        {m.status === "failed" ? <>這則沒送出，再試一次{onRetry ? <> · <button type="button" onClick={onRetry}>再送一次</button></> : null}</> : timeJst(m.created_at)}
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

/**
 * The weekly review's question about a key session with no record: the question itself in
 * a quote block (the api builds it; the review text only says what it can see), the two
 * answers under it, then what the review is waiting for. After 沒跑 the review is rewritten
 * in place — `rerun` is that wait ("Woo 在重寫…"), or that we gave up polling for it.
 */
function WeeklyAskBlock({ ask, busy, rerun, onAnswer }: { ask: ApiWeeklyAsk; busy: boolean; rerun: "pending" | "gave-up" | null; onAnswer: (answer: "synced" | "skipped") => void }) {
  return (
    <div className="ask">
      <div className="ask-block"><div className="q">{ask.question}</div></div>
      {ask.state === "open" ? (
        <div className="chips-row" role="group" aria-label={`${md(ask.date)} 的${ask.label}有沒有跑`}>
          <button type="button" className="chip" disabled={busy} onClick={() => onAnswer("synced")}>還沒同步</button>
          <button type="button" className="chip" disabled={busy} onClick={() => onAnswer("skipped")}>沒跑</button>
        </div>
      ) : (
        <div className="said">你說：{ask.state === "synced" ? "還沒同步" : "沒跑"}</div>
      )}
      {rerun === "pending" ? <div className="said"><span className="typing-dots"><i /><i /><i /></span>Woo 在重寫這週的回顧…</div>
        : rerun === "gave-up" ? <div className="said">回顧還在重寫，稍後再回來看</div>
        : ask.state !== "skipped" ? <div className="said">{ask.label} 確定之後我再給下週的建議。</div>
        : null}
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

  // After 沒跑 the weekly review is regenerated in place a few seconds later: keep
  // reloading until that message's `updated` stamp moves (or the polling gives up).
  const [rerun, setRerun] = useState<{ id: string; at: string | null } | null>(null);
  const rerunPending = !!rerun && (messages.find((m) => m.id === rerun.id)?.weekly?.updated?.at ?? null) === rerun.at;

  // After 是，就是這趟 the athlete's line is stored as sent and Woo's next message (the feel
  // question, or the verdict for a report-page pick) comes from the worker: keep reloading
  // while that line is still the newest one.
  const [expect, setExpect] = useState<string | null>(null);
  const expectPending = !!expect && last?.id === expect;

  // 不是這堂 on a report-page pick only unassigns the activity; say so once.
  const [unlinked, setUnlinked] = useState<string | null>(null);

  const { timedOut, restart } = useReviewPolling(waiting || rerunPending || expectPending);
  const typing = waiting || expectPending;

  // Woo's open "how did it feel?" (the last message) turns the composer into the answer
  // box. A mismatch question is answered with its own chips instead — while it is open,
  // 不是，重選 is the one way to undo the pick (選錯了 on the pick bubble is hidden).
  const openAsk = last && last.kind === "ask" && last.ask?.state === "open" && last.ask.kind !== "mismatch" ? last : null;
  const mismatchOpen = !!last && last.kind === "ask" && last.ask?.kind === "mismatch" && last.ask.state === "open";

  const count = messages.length;
  useEffect(() => { window.scrollTo({ top: document.documentElement.scrollHeight }); }, [count, typing]);

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

  // 還沒同步 / 沒跑 on the weekly review's question.
  async function answerWeeklyAsk(m: ApiCoachMessage, ask: ApiWeeklyAsk, answer: "synced" | "skipped") {
    if (!m.weekly_review_id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postWeeklyAsk(m.weekly_review_id, ask.session_id, { answer });
      if (answer === "skipped") setRerun({ id: m.id, at: m.weekly?.updated?.at ?? null });
      await revalidator.revalidate();
      restart();
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 409 ? "這個已經回過了" : e.message) : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  // 是，就是這趟 / 不是 on Woo's mismatch question. 是 → his feel question (or, for a
  // report-page pick, the verdict) follows from the worker: wait for it. 不是 → after a chip
  // the pick is undone and a fresh check-in is posted at once; after a report-page pick the
  // activity is only unassigned and the athlete picks again on the report page.
  async function confirmMatch(m: ApiCoachMessage, yes: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postCoachMessage({ text: yes ? "是" : "不是", answer_to: m.id, confirm_match: yes });
      if (yes) setExpect(r.message.id);
      else if (m.ask?.from === "report") setUnlinked(m.id);
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
            // No 選錯了 while the mismatch question is open, nor while Woo's next line (after 是) is on its way.
            const resettable = m.kind === "pick" && i === lastPickIdx && i > lastCheckinIdx && lastCheckin?.checkin?.state === "picked" && !mismatchOpen && !expectPending;
            node = <AthleteMessage m={m} busy={busy} onReset={resettable ? () => void reset() : undefined} onRetry={m.kind === "chat" && !m.rpe ? () => void send(m.text, m.activity_id ?? undefined) : undefined} />;
          } else if (m.kind === "weekly") {
            const w = reviews.find((r) => r.id === m.weekly_review_id) ?? null;
            const wm = m.weekly;
            const rewriting = rerunPending && rerun?.id === m.id;
            node = (
              <CoachMessage m={m} badge={rewriting && !timedOut ? "typing" : wm?.updated ? "check" : null}>
                {wm?.updated ? <div className="updated"><span aria-hidden="true">⟳</span> 已更新 · {wm.updated.reason}</div> : null}
                <p className="text">{m.text}</p>
                {wm?.asks.map((ask) => <WeeklyAskBlock key={ask.session_id} ask={ask} busy={busy} rerun={rewriting && ask.state === "skipped" ? (timedOut ? "gave-up" : "pending") : null} onAnswer={(answer) => void answerWeeklyAsk(m, ask, answer)} />)}
                {w ? <CoachProposals review={w} sessions={sessions} embedded onChanged={() => void revalidator.revalidate()} /> : null}
                {wm?.cancelled.length ? <p className="cancelled">{wm.cancelled.map((c) => `原本「${c}」的建議已取消`).join("；")}</p> : null}
              </CoachMessage>
            );
          } else if (m.kind === "ask" && m.ask?.kind === "mismatch") {
            node = (
              <CoachMessage m={m}>
                <p className="text">{m.text}</p>
                {m.ask.state === "open" ? (
                  <div className="chips-row" role="group" aria-label="是不是這趟">
                    <button type="button" className="chip" disabled={busy} onClick={() => void confirmMatch(m, true)}>是，就是這趟</button>
                    <button type="button" className="chip primary" disabled={busy} onClick={() => void confirmMatch(m, false)}>{m.ask.from === "report" ? "不是這堂" : "不是，重選"}</button>
                  </div>
                ) : unlinked === m.id ? (
                  <div className="said">已解除配對，<Link to={`/activities/${m.ask.activity_id}`}>到報告頁重選 ›</Link></div>
                ) : null}
              </CoachMessage>
            );
          } else if (m.kind === "chat" && m.proposal) {
            node = (
              <CoachMessage m={m}>
                <p className="text">{m.text}</p>
                <ProposalCard proposal={m.proposal} sessions={sessions} onChanged={() => void revalidator.revalidate()} />
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
        {typing ? (
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
