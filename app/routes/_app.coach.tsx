import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, redirect, useLocation, useNavigate, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/_app.coach";
import { CloseIcon, SendIcon } from "../components/icons";
import { GlassButton, NavBar } from "../components/nav-bar";
import { ConstraintCard, ProposalCard } from "../components/proposals";
import { Rejected, WeeklyReviewBody } from "../components/weekly-review";
import { CoachAvatar, VerdictTag, verdictBadge } from "../components/ui";
import { ApiError, getActivities, getCoach, getWeekly, postCheckinPick, postCheckinReset, postCoachMessage, postWeeklyAsk, putCoachSeen } from "../lib/api";
import { hasSession } from "../lib/auth";
import { leaveModal } from "../lib/motion";
import { assignErrorText, groupBySession, inOtherMultiSession } from "../lib/combine";
import { md, mdDow, timeJst, toJstDate } from "../lib/date";
import { km, pace } from "../lib/format";
import { MdText } from "../components/md-text";
import { WooStatus } from "../components/woo-status";
import { useReviewPolling } from "../lib/use-review-polling";
import { usePlan } from "../lib/use-plan";
import { JUMP_MAX_PAGES, JUMP_PAGE, resetWeeklyCaches } from "../lib/use-weekly-message";
import type { ApiActivity, ApiCoachMessage, ApiProposal, ApiSession, ApiWeeklyAsk, ApiWeeklyReview } from "../types/api";
import { pageTitle } from "../lib/meta";

// Woo's thread: weekly reviews (with their proposals), each run's verdict, his
// post-run check-in (which activity → how did it feel → verdict), and the
// conversation. The athlete writes at the bottom; replies are polled for.

const MAX_CHARS = 500;
/** What `?message=` may be (the api's ids are uuids, the demo's are short words); it is only ever compared with the ids of loaded messages. */
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Messages per page: the first visit loads the newest 10, reaching the top loads 10 older ones. */
const PAGE = 10;
const RPE_WORDS = ["", "很輕鬆", "輕鬆", "輕鬆", "適中", "適中", "適中", "有點累", "累", "很累", "極限"];

// While a chat reply / the verdict is on its way (polled every 2 s) nothing in the weekly reviews changes,
// so those polls reuse the last /weekly answer instead of asking again; everything else (first visit,
// after an action, while a review is being rewritten) fetches it. The component sets the flag.
let reuseWeekly = false;
let lastWeekly: ApiWeeklyReview[] | null = null;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  if (!hasSession()) throw redirect("/login");
  const quoteId = new URL(request.url).searchParams.get("quote");
  try {
    const [coach, weekly, quoted] = await Promise.all([
      getCoach({ limit: PAGE }),
      reuseWeekly && lastWeekly ? Promise.resolve({ reviews: lastWeekly }) : getWeekly().then((w) => { lastWeekly = w.reviews; return w; }).catch(() => ({ reviews: lastWeekly ?? [] })),
      quoteId ? getActivities().then((r) => r.activities.find((a) => a.id === quoteId) ?? null).catch(() => null) : Promise.resolve(null),
    ]);
    putCoachSeen().catch(() => { /* the badge just stays until next time */ });
    return { ...coach, reviews: weekly.reviews, quoted };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    throw e;
  }
}

/** The layout draws no tab bar under this page and gives the shell the `modal` class (AppLayout reads it with useMatches). */
// oxlint-disable-next-line react/only-export-components -- a route export, like the others in this file (meta, clientLoader)
export const handle = { modal: true } as const;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("教練 Woo", matches);
}

/** Why Woo could not redo a verdict he agreed to redo: fixed words, the api only sends the enum. 做不到的原因不同，後面接的話不同：次數用完、手動判定、正在重判時按「重新分析」不會有用，所以不叫他去按。 */
function rejectedText(why: NonNullable<ApiCoachMessage["correction"]>["why"] | undefined): string {
  switch (why) {
    case "limit": return "這堂現在不能重判：今天已更正 2 次；可以到報告頁按「重新分析」";
    case "daily": return "這堂現在不能重判：今天重新分析的次數用完了（每天 20 次）；明天再試";
    case "manual": return "這堂現在不能重判：這堂是手動判定";
    case "queued": return "這堂現在不能重判：正在重判中，好了這裡和報告頁會一起更新";
    default: return "這堂現在不能重判：找不到那堂；可以到報告頁按「重新分析」"; // unknown, null, or a value a newer api sends
  }
}

/**
 * Under Woo's reply in which he agreed to redo a verdict (coach-correct-review): the wait (his stage, or "Woo 在重判 10/31 的 Long 18 km"),
 * the line when it took too long or did not work, or why he could not. `done` draws nothing: the new verdict message follows in the thread.
 */
function CorrectionLine({ m, timedOut }: { m: ApiCoachMessage; timedOut: boolean }) {
  const c = m.correction;
  if (!c) return null;
  const what = `${md(c.date)} 的${/^[A-Za-z0-9]/.test(c.label) ? " " : ""}${c.label}`;
  if (c.state === "queued") return <div className="said">{timedOut ? "重判比較慢，稍後再回來看；報告頁也會更新" : <WooStatus stage={m.stage} fallback={`Woo 在重判 ${what}`} />}</div>;
  if (c.state === "failed") return <div className="said">重判沒成功，<Link to={`/activities/${c.activity_id}`}>到報告頁按「重新分析」›</Link></div>;
  if (c.state === "rejected") return <p className="cancelled">{rejectedText(c.why)}</p>;
  return null;
}

/** A confirmation line older than this is not waited for any more (the new verdict is on the report page by then). */
const CORRECTION_QUEUED_STALE_MS = 10 * 60_000;

/** The clock for the 10-minute rule; a function of its own like `todayJst`, the render only asks it. */
const nowMs = () => Date.now();

interface PlanRejudge { date: string; label: string; sessionId: string }

/**
 * The card whose confirmation line this message is, or null. The api's confirmation (postProposalApplied) is a Woo chat line with no activity,
 * written within 5 s of the card's decided_at; the fixed lines that can land in the same 5 s (「次數用完」, 「這次分析沒成功」) carry an activity_id.
 */
function confirmedCard(m: ApiCoachMessage, applied: ApiProposal[]): ApiProposal | null {
  if (m.role !== "coach" || m.kind !== "chat" || m.proposal || m.constraint || m.activity_id != null) return null;
  const at = Date.parse(m.created_at);
  return applied.find((p) => Math.abs(Date.parse(p.decided_at ?? "") - at) < 5000) ?? null;
}

/** The session's title as the api writes it in a verdict message (`sessionLabel`: label ?? type, then the distance); only for the wait line's words. */
const apiTitle = (s: Pick<ApiSession, "label" | "type" | "target_distance_m">) => `${s.label ?? s.type}${s.target_distance_m ? ` ${Math.round(s.target_distance_m / 100) / 10} km` : ""}`;

/**
 * coach-correct-plan: for each confirmation line of a card that corrected completed sessions, the sessions Woo has not finished re-judging
 * (message id → [{date, label, sessionId}], card order). Only the thread and the plan are looked at, no new api field: the confirmation is
 * `confirmedCard` (and not the "沒有排到重判" one), newer than 10 minutes; a session is finished when a Woo verdict or chat line newer than the
 * confirmation carries an activity that now sits in that session (the activity follows the corrected session to its new row, so the new verdict and the
 * worker's later 「這次分析沒成功」 both match; a title would not: the api's and the web's session names differ for labels like 間歇／節奏).
 */
function planRejudgeWaits(messages: ApiCoachMessage[], sessions: ApiSession[], activities: ApiActivity[], now: number): Map<string, PlanRejudge[]> {
  const out = new Map<string, PlanRejudge[]>();
  const applied = messages.flatMap((x) => (x.proposal?.status === "applied" && x.proposal.decided_at ? [x.proposal] : []));
  const sessionOf = new Map(activities.map((a) => [a.id, a.session_id]));
  for (const m of messages) {
    const card = confirmedCard(m, applied);
    if (!card || m.text.includes("沒有排到重判")) continue;
    const at = Date.parse(m.created_at);
    if (now - at > CORRECTION_QUEUED_STALE_MS) continue;
    const seen = new Set<string>();
    const targets: PlanRejudge[] = [];
    for (const c of card.changes) {
      const id = c.applied_session_id;
      if (c.correction !== true || !c.date || !id || seen.has(id)) continue;
      seen.add(id);
      const s = sessions.find((x) => x.id === id);
      targets.push({ date: c.date, label: s ? apiTitle(s) : c.label ?? "", sessionId: id });
    }
    const done = new Set(messages.filter((x) => x.role === "coach" && (x.kind === "review" || x.kind === "chat") && x.activity_id != null && Date.parse(x.created_at) > at).map((x) => sessionOf.get(x.activity_id as string)));
    const left = targets.filter((t) => !done.has(t.sessionId));
    if (left.length) out.set(m.id, left);
  }
  return out;
}

/** Under the confirmation line of a card that corrected completed sessions: who Woo is re-judging (one session: its name; several: how many and which days), or the 3-minute line. */
function PlanRejudgeLine({ left, timedOut }: { left: PlanRejudge[]; timedOut: boolean }) {
  if (timedOut) return <div className="said">重判比較慢，稍後再回來看；報告頁也會更新</div>;
  const t = left[0];
  const text = left.length === 1 ? `Woo 在重判 ${md(t.date)} 的${/^[A-Za-z0-9]/.test(t.label) ? " " : ""}${t.label}` : `Woo 在重判 ${left.length} 堂（${left.map((x) => md(x.date)).join("、")}）`;
  return <div className="said"><WooStatus stage={null} fallback={text} /></div>;
}

const byTime = (a: ApiCoachMessage, b: ApiCoachMessage) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** A copy of the cache with these messages in it (newer copies win). */
function upsert(cache: Map<string, ApiCoachMessage>, msgs: ApiCoachMessage[]): Map<string, ApiCoachMessage> {
  const next = new Map(cache);
  for (const m of msgs) next.set(m.id, m);
  return next;
}

/** Everything seen so far, oldest first; the loader's newest page wins over the cache for the same id (it is the fresh copy). */
function mergeThread(cache: Map<string, ApiCoachMessage>, latest: ApiCoachMessage[]): ApiCoachMessage[] {
  return [...upsert(cache, latest).values()].sort(byTime);
}

/**
 * Bring a message into view between the top bar and the composer: a message that fits is centred there, a taller one starts right under the
 * top bar (its top is what the athlete reads first; centring would push it above the screen). Instant, whatever the motion setting.
 */
function scrollToMessage(id: string, scroller: HTMLElement | null): number | null {
  const el = document.getElementById(`msg-${id}`);
  if (!el || !scroller) return null;
  const top = document.querySelector(".navbar")?.getBoundingClientRect().bottom ?? 0;
  const bottom = document.querySelector(".composer")?.getBoundingClientRect().top ?? window.innerHeight;
  const room = bottom - top;
  const r = el.getBoundingClientRect();
  const want = r.height <= room ? top + (room - r.height) / 2 : top;
  scroller.scrollBy({ top: r.top - want, behavior: "instant" });
  return scroller.scrollTop;
}

function DayRule({ date }: { date: string }) {
  return <div className="day-rule"><span />{mdDow(date)}<span /></div>;
}

/** The message `/coach?message=<id>` jumped to, for its two seconds of ring. */
const FlashContext = createContext<string | null>(null);

function CoachMessage({ m, children, badge, className }: { m: ApiCoachMessage; children: React.ReactNode; badge?: "check" | "warn" | null; className?: string }) {
  const flash = useContext(FlashContext) === m.id;
  return (
    <article id={`msg-${m.id}`} className={`msg coach${className ? ` ${className}` : ""}${flash ? " target" : ""}`}>
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
    <div id={`msg-${m.id}`} className="msg me">
      <div className={`bubble${m.kind === "pick" ? " pick" : ""}`}>
        {m.quote ? <div className="quote">{m.quote}</div> : null}
        {m.kind === "pick" && m.text !== "都不是" && m.text !== "不是，另外算" ? <i className="strava-dot" aria-hidden="true" /> : null}
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
function CheckinChips({ m, busy, elsewhere, onPick }: { m: ApiCoachMessage; busy: boolean; /** append: the candidate sits in another session that has several recordings (not offered). */ elsewhere?: (activityId: string) => boolean; onPick: (body: { activity_id?: string; session_id?: string; none?: boolean }) => void }) {
  const c = m.checkin;
  if (!c || c.state !== "open") return null;
  // append: today's session already has a recording and another arrived. Two answers, stacked and flush with the avatar (a label is wider than the text column); no guess to mark.
  if (c.mode === "append") {
    return (
      <div className="chips-stack" role="group" aria-label="是不是同一堂">
        {c.candidates.filter((cand) => !(cand.activity_id && elsewhere?.(cand.activity_id))).map((cand, i) => (
          <button key={cand.activity_id ?? i} type="button" className="chip tall primary" disabled={busy} onClick={() => onPick({ activity_id: cand.activity_id })}>
            <i className="strava-dot" aria-hidden="true" /><span className="lbl">{cand.label}</span>
          </button>
        ))}
        <button type="button" className="chip tall muted" disabled={busy} onClick={() => onPick({ none: true })}><span className="lbl">不是，另外算</span></button>
      </div>
    );
  }
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
  const { reviews, quoted } = loaderData;
  const view = usePlan();
  const revalidator = useRevalidator();
  const [searchParams, setSearch] = useSearchParams();

  const [text, setText] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [quote, setQuote] = useState<ApiActivity | null>(quoted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The thread is the loader's newest page plus a cache of everything seen so far: older pages
  // (loaded by scrolling to the top) and messages that a newer page has since pushed out of the
  // newest one. Polling only refreshes the newest page; the cache keeps the rest.
  const [cache, setCache] = useState<Map<string, ApiCoachMessage>>(() => new Map());
  const [newest, setNewest] = useState(loaderData.messages);
  if (newest !== loaderData.messages) {
    setNewest(loaderData.messages);
    setCache((c) => upsert(c, newest)); // the page being replaced: keep what it had
  }
  const messages = useMemo(() => mergeThread(cache, loaderData.messages), [cache, loaderData.messages]);
  const [hasMore, setHasMore] = useState(loaderData.has_more);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);

  // /coach?message=<id> (the weekly-review sheet's 在對話裡看): load older pages until that message is in, scroll it to the middle, ring it for 2 seconds.
  // An id that does not look like one, or is not found within JUMP_MAX_PAGES pages, is ignored: the thread opens on its newest page as always.
  const messageParam = searchParams.get("message");
  const [jump, setJump] = useState<{ id: string; pages: number; done: boolean } | null>(() => (messageParam && MESSAGE_ID.test(messageParam) ? { id: messageParam, pages: 0, done: false } : null));
  const [flash, setFlash] = useState<string | null>(null);
  const jumpActive = !!jump && !jump.done;

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

  // What this page just did to a proposal card (applied it, or a sibling A／B card was): shown
  // at once; once the stored status is anything but pending, the stored one wins.
  const [decisions, setDecisions] = useState<Record<string, ApiProposal["status"]>>({});
  const statusOf = (p: ApiProposal) => (p.status !== "pending" ? p.status : decisions[p.id] ?? "pending");

  // Woo agreed to redo a verdict and the new one is not in yet (his reply says state queued): the same polling, the wait line sits under his reply.
  const correctionPending = messages.some((m) => m.role === "coach" && m.correction?.state === "queued");

  // A card that corrected completed sessions was applied and their new verdicts are not in yet: the same polling, the wait line sits under Woo's confirmation (coach-correct-plan).
  const planWaits = planRejudgeWaits(messages, view?.data.sessions ?? [], view ? [...view.data.activities, ...view.data.unassigned] : [], nowMs());
  const planRejudgePending = planWaits.size > 0;

  // Something is on its way (a reply, the verdict, a rewritten review): look every 2 s so the stage text keeps up.
  const polling = waiting || rerunPending || expectPending || correctionPending || planRejudgePending;
  const { timedOut, restart } = useReviewPolling(polling, true);
  // The reply that says "我重判一次" can itself have taken a while: the 3 minutes of "重判比較慢" count from the reply, not from the send.
  const restartRef = useRef(restart);
  useEffect(() => { restartRef.current = restart; });
  useEffect(() => { if (correctionPending || planRejudgePending) restartRef.current(); }, [correctionPending, planRejudgePending]);
  // Polls for a reply do not need /weekly again (see clientLoader); a review being rewritten does.
  useEffect(() => { reuseWeekly = (waiting || expectPending || correctionPending || planRejudgePending) && !rerunPending; }, [waiting, expectPending, correctionPending, planRejudgePending, rerunPending]);
  useEffect(() => () => { reuseWeekly = false; lastWeekly = null; }, []);
  // What the sheets on 課表／今天 kept about the weekly reviews is out of date once the thread was used (a card decided, a question answered).
  useEffect(() => () => resetWeeklyCaches(), []);
  const typing = waiting || expectPending;

  // Woo's open "how did it feel?" (the last message) turns the composer into the answer
  // box. A mismatch question is answered with its own chips instead — while it is open,
  // 不是，重選 is the one way to undo the pick (選錯了 on the pick bubble is hidden).
  const openAsk = last && last.kind === "ask" && last.ask?.state === "open" && last.ask.kind !== "mismatch" ? last : null;
  const mismatchOpen = !!last && last.kind === "ask" && last.ask?.kind === "mismatch" && last.ask.state === "open";

  // The composer is fixed to the bottom and grows (RPE row, quote chip, an error line, a taller
  // box): its measured height keeps the thread's bottom padding, so it never covers the last message.
  const formRef = useRef<HTMLFormElement>(null);
  // The thread scrolls inside this box (the page is a fixed modal, 01b §5.6): every scroll position, height and observer below is the box's, not the window's.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [composerH, setComposerH] = useState(69);
  useLayoutEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const measure = () => setComposerH(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // This page is a modal (the layout draws no tab bar): the composer sits on the bottom edge, so there is no tab bar
  // height to follow. Closing goes one step back in history (the page you came from); with nothing to go back to
  // (the app was opened at /coach) it goes to 今天, replacing this entry.
  const navigate = useNavigate();
  const location = useLocation();
  const cameFromApp = location.key !== "default";
  // Leaving slides the modal down (300 ms) and then goes one step back; a second press while it leaves is ignored. The browser's back button has no leaving animation.
  // the thread takes the focus when the modal is there: keys (PageUp, arrows, Space, Home, End) scroll it, as they scrolled the window before
  useEffect(() => { scrollerRef.current?.focus({ preventScroll: true }); }, []);
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    const shell = scrollerRef.current?.closest<HTMLElement>(".shell") ?? null;
    const done = () => void (cameFromApp ? navigate(-1) : navigate("/", { replace: true }));
    if (!shell) { done(); return; }
    void leaveModal(shell, [...shell.querySelectorAll<HTMLElement>(".navbar, .composer")]).finished.then(done);
  };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  // Esc closes the page too, but not while a sheet is open (that Esc closes the sheet)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.isComposing && !document.querySelector(".sheet-root")) closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // To the bottom when the newest message changes, the wait row comes or goes, or the composer grows.
  // Not when older messages are prepended (the newest id stays) and not when a stage text changes.
  // Not while a jump to `?message=` is on its way, and once it has landed not for the composer growing (only a new message or the wait row pulls the view down again).
  const newestId = messages[messages.length - 1]?.id;
  const jumpRef = useRef<{ jump: typeof jump; landed: boolean }>({ jump, landed: false });
  useEffect(() => { jumpRef.current.jump = jump; });
  const lastBottom = useRef({ newestId, typing });
  useEffect(() => {
    const moved = lastBottom.current.newestId !== newestId || lastBottom.current.typing !== typing;
    lastBottom.current = { newestId, typing };
    const j = jumpRef.current;
    if (j.jump && !j.jump.done) return;
    if (j.landed && !moved) return;
    const sc = scrollerRef.current;
    sc?.scrollTo({ top: sc.scrollHeight });
  }, [newestId, typing, composerH]);

  // Older pages: the sentinel at the top of the list asks for the 10 before the oldest message we have.
  const topRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const anchorRef = useRef<{ h: number; y: number } | null>(null);
  const loadOlderRef = useRef<() => Promise<void>>(async () => {});
  async function loadOlder(limit?: number) { // (a default value `= PAGE` here breaks the route-chunk splitter of the build)
    if (loadingRef.current || !hasMore || messages.length === 0) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const r = await getCoach({ before: messages[0].id, limit: limit ?? PAGE });
      // what the athlete is looking at stays where it is: remember the page height, fix the scroll after the older ones are in
      anchorRef.current = { h: scrollerRef.current?.scrollHeight ?? 0, y: scrollerRef.current?.scrollTop ?? 0 };
      setCache((c) => upsert(c, r.messages));
      setHasMore(r.has_more && r.messages.length > 0); // an empty page cannot be followed by another: no loop on a sentinel that stays in view
    } catch {
      setOlderError(true);
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }
  useLayoutEffect(() => { loadOlderRef.current = loadOlder; }); // the observer's callback always calls the latest one
  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    anchorRef.current = null;
    const sc = scrollerRef.current;
    sc?.scrollTo(0, a.y + ((sc?.scrollHeight ?? 0) - a.h));
  }, [messages]);
  // (Re)armed after every load: a sentinel still in view (short messages) loads the next page at once.
  // After a failure it waits until the sentinel has left the screen and come back, so it never loops.
  useEffect(() => {
    const el = topRef.current;
    if (!el || !hasMore || loadingOlder || jumpActive) return;
    let armed = !olderError;
    let timer = 0;
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      window.clearTimeout(timer);
      if (!e.isIntersecting) { armed = true; return; }
      if (!armed) return;
      // Look again after a moment: the router scrolls to the top for an instant on a navigation (sending
      // a message clears ?quote), which must not read as "the athlete reached the top".
      timer = window.setTimeout(() => { if (el.getBoundingClientRect().bottom > -200) void loadOlderRef.current(); }, 150);
    }, { root: scrollerRef.current, rootMargin: "200px 0px 0px 0px" });
    io.observe(el);
    return () => { window.clearTimeout(timer); io.disconnect(); };
  }, [hasMore, loadingOlder, olderError, jumpActive]);

  const flashTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  /* oxlint-disable react/set-state-in-effect -- the jump is a loop with the thread: each page that arrives is looked at here, and the next step (another page, the scroll and the ring, giving up) is set from what is found */
  useEffect(() => {
    if (!jump || jump.done || loadingOlder) return;
    if (messages.some((m) => m.id === jump.id)) {
      jumpRef.current.landed = true;
      // The layout above the message can still change a moment after the older pages are in (the "載入更早" row folds away): look once more
      // after it has settled, and only if the athlete has not scrolled since.
      requestAnimationFrame(() => {
        const y = scrollToMessage(jump.id, scrollerRef.current);
        if (y != null) window.setTimeout(() => { if (Math.abs((scrollerRef.current?.scrollTop ?? 0) - y) < 1) scrollToMessage(jump.id, scrollerRef.current); }, 300);
      });
      setFlash(jump.id);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 2000);
      setJump({ ...jump, done: true });
    } else if (hasMore && jump.pages < JUMP_MAX_PAGES && !olderError) {
      setJump({ ...jump, pages: jump.pages + 1 });
      void loadOlder(JUMP_PAGE);
    } else {
      setJump({ ...jump, done: true });
      requestAnimationFrame(() => scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight })); // not found: the thread as it always opens
    }
  }, [jump, messages, hasMore, loadingOlder, olderError]); // oxlint-disable-line react-hooks/exhaustive-deps -- loadOlder is the latest closure of this render
  /* oxlint-enable react/set-state-in-effect */

  // The weekly review rewritten after 沒跑 may sit on an older page, which polling (newest page only) does not
  // reach: while it is being rewritten, fetch the stretch just before the newest page along with each poll.
  const refreshingRef = useRef(false);
  useEffect(() => {
    if (!rerunPending || !rerun || refreshingRef.current) return;
    if (loaderData.messages.some((m) => m.id === rerun.id) || !loaderData.messages.length) return;
    refreshingRef.current = true;
    getCoach({ before: loaderData.messages[0].id, limit: 50 })
      .then((r) => setCache((c) => upsert(c, r.messages)))
      .catch(() => { /* the next poll tries again */ })
      .finally(() => { refreshingRef.current = false; });
  }, [loaderData, rerun, rerunPending]);

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
      if (searchParams.has("quote")) setSearch({}, { replace: true }); // a navigation: only when there is a quote to drop
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
      // a refused append (overlap, a different kind of activity, a full session ...) says why in fixed words, as on the report page
      if (e instanceof ApiError && e.status === 409) {
        const picked = body.activity_id && view ? [...view.data.activities, ...view.data.unassigned].find((x) => x.id === body.activity_id) ?? null : null;
        const sessionId = messages.find((x) => x.id === checkinId)?.checkin?.session_id;
        setError(assignErrorText(e, picked, (sessionId && view ? groupBySession(view.data.activities).get(sessionId) : null) ?? [], "coach"));
        void revalidator.revalidate(); // the session changed under us: fetch it again
      } else setError(e instanceof ApiError ? e.message : "送出失敗，再試一次");
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
      const r = await postWeeklyAsk(m.weekly_review_id, ask.session_id, { answer });
      setCache((c) => upsert(c, [r.message])); // the review may be on an older page that polling does not refresh
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
  const planWeeks = view?.data.weeks ?? [];

  // 請 Woo 重看 on a stale card: a user line with re_propose; Woo sends a new card against today's plan.
  async function repropose(p: ApiProposal) {
    await postCoachMessage({ text: "課表變了，這張重看一次", re_propose: p.id });
    await revalidator.revalidate();
    restart();
  }

  // The cards of one A／B reply arrive as consecutive messages sharing a group_id: draw them as one reply.
  const groups = new Map<string, ApiCoachMessage[]>();
  for (const m of messages) if (m.proposal?.group_id) groups.set(m.proposal.group_id, [...(groups.get(m.proposal.group_id) ?? []), m]);

  const appliedCards = messages.flatMap((x) => (x.proposal?.status === "applied" && x.proposal.decided_at ? [x.proposal] : []));

  function cards(members: ApiCoachMessage[]) {
    const reload = () => void revalidator.revalidate();
    const ps = members.flatMap((x) => (x.proposal ? [x.proposal] : []));
    const chosen = ps.find((p) => statusOf(p) === "applied")?.option?.letter ?? null;
    const memo = members.find((x) => x.constraint)?.constraint ?? null;
    return (
      <>
        {ps.map((p) => (
          <ProposalCard key={p.id} proposal={p} status={statusOf(p)} sessions={sessions} weeks={planWeeks} chosen={chosen}
            onStatus={(id, status) => setDecisions((d) => ({ ...d, [id]: status }))} onChanged={reload} onRepropose={repropose} />
        ))}
        {memo ? <ConstraintCard key={memo.id} constraint={memo} onChanged={reload} /> : null}
      </>
    );
  }

  // A long run farther than any run before it is worth a line of its own.
  const allActs = view ? [...view.data.activities, ...view.data.unassigned] : [];
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
    <FlashContext.Provider value={flash}>
      <div className="modal-scroll" ref={scrollerRef} tabIndex={-1}>
      <NavBar kind="inline" left={<GlassButton label="關閉" onClick={close}><CloseIcon /></GlassButton>} title="Woo" subtitle="你的教練 · 只聊跑步和課表" scroller={scrollerRef} />
      <main className="thread" style={{ "--composer-h": `${composerH}px` } as React.CSSProperties}>
        <div className={`thread-top${hasMore ? "" : " end"}`} ref={topRef} aria-live="polite">
          {loadingOlder ? <span className="tt-load">載入更早的對話<span className="typing-dots" aria-hidden="true"><i /><i /><i /></span></span> : olderError ? "載入失敗，往上滑再試一次" : null}
        </div>
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
            const rewriting = rerunPending && rerun?.id === m.id;
            node = (
              <CoachMessage m={m} badge={m.weekly?.updated ? "check" : null}>
                <WeeklyReviewBody m={m} review={w} view={view} sessions={sessions} weeks={planWeeks} busy={busy}
                  rerun={rewriting ? (timedOut ? "gave-up" : "pending") : null}
                  cards={{ statusOf, onStatus: (id, status) => setDecisions((d) => ({ ...d, [id]: status })), onChanged: () => void revalidator.revalidate(), onRepropose: repropose }}
                  onAnswerAsk={(ask, answer) => void answerWeeklyAsk(m, ask, answer)} />
              </CoachMessage>
            );
          } else if (m.kind === "ask" && m.ask?.kind === "mismatch") {
            node = (
              <CoachMessage m={m}>
                <MdText text={m.text} />
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
          } else if (m.kind === "chat" && (m.proposal || m.constraint)) {
            const members = (m.proposal?.group_id && groups.get(m.proposal.group_id)) || [m];
            if (members[0] !== m) return null; // drawn with the first card of its group
            const stale = members.some((x) => x.proposal && statusOf(x.proposal) === "stale");
            node = (
              <CoachMessage m={m} badge={stale ? "warn" : null}>
                <MdText text={m.text} />
                {members.slice(1).filter((x) => x.text && x.text !== m.text).map((x) => <MdText key={x.id} text={x.text} />)}
                {cards(members)}
                {m.proposal_rejected ? <Rejected /> : null}
                <CorrectionLine m={m} timedOut={timedOut} />
              </CoachMessage>
            );
          } else if (m.kind === "review") {
            // A newer verdict of this session is below: this one is dimmed, has no badge and is not "the first" anything.
            const old = m.review?.superseded === true;
            const first = old ? null : firstTime(m.activity_id);
            node = (
              <CoachMessage m={m} badge={old ? null : verdictBadge(m.review?.verdict)} className={old ? "superseded" : undefined}>
                {old ? <p className="cancelled">這則判定已更新，以下面新的為準</p> : null}
                {m.review?.updated ? <div className="updated rejudged"><span aria-hidden="true">⟳</span> 已更新判定 · {m.review.updated.reason}</div> : null}
                <div className="head"><b>{m.review?.label}</b><VerdictTag verdict={m.review?.verdict} /></div>
                {first ? <div className="celebrate"><div className="k">第一次</div><div className="v"><span className="num">{first}</span><span>km 長跑</span></div></div> : null}
                <MdText text={m.text} />
                {m.review?.reminder ? <p className="next">→ {m.review.reminder}</p> : null}
                {m.activity_id ? <Link to={`/activities/${m.activity_id}`} className="chip" style={{ marginTop: 8 }}>看報告</Link> : null}
              </CoachMessage>
            );
          } else if (m.kind === "checkin") {
            node = (
              <CoachMessage m={m}>
                <MdText text={m.text} />
                <CheckinChips m={m} busy={busy} elsewhere={(id) => { const x = allActs.find((a) => a.id === id); return !!x && inOtherMultiSession(x, m.checkin?.session_id ?? null); }} onPick={(body) => void pick(m.id, body)} />
                {i === lastCheckinIdx && m.checkin?.state === "dismissed" ? <button type="button" className="relink" onClick={() => void reset()} disabled={busy}>重新選 ›</button> : null}
              </CoachMessage>
            );
          } else {
            // Woo's line written as a card was applied (within a few seconds of it) is his confirmation: the avatar gets the check.
            const confirms = confirmedCard(m, appliedCards) != null;
            node = <CoachMessage m={m} badge={confirms ? "check" : null}><MdText text={m.text} />{m.proposal_rejected ? <Rejected /> : null}<CorrectionLine m={m} timedOut={timedOut} />{planWaits.has(m.id) ? <PlanRejudgeLine left={planWaits.get(m.id) ?? []} timedOut={timedOut} /> : null}</CoachMessage>;
          }
          return <Fragment key={m.id}>{rule}{node}</Fragment>;
        })}
        {typing ? (
          <article className="msg coach typing">
            <CoachAvatar />
            <div className="body">{timedOut ? "Woo 回得比較慢，稍後再回來看。" : <WooStatus stage={last?.stage} />}</div>
          </article>
        ) : null}
      </main>
      </div>
      <form className="composer glass" ref={formRef} onSubmit={(e) => { e.preventDefault(); void send(text, quote?.id); }}>
        {quote && !openAsk ? (
          <div className="quote-chip">
            <span>引用 {quoteLine(quote)}</span>
            <button type="button" className="qx" aria-label="移除引用" onClick={() => { setQuote(null); setSearch({}, { replace: true }); }}>×</button>
          </div>
        ) : null}
        {openAsk ? (
          <div className="rpe-row" role="radiogroup" aria-label="累的程度 1 到 10">
            <span className="k">RPE</span>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rpe === n} className={`rpe-btn${rpe === n ? " on" : ""}`} onClick={() => setRpe(rpe === n ? null : n)} title={RPE_WORDS[n]}>{n}</button>
            ))}
          </div>
        ) : null}
        <div className="row">
          <textarea
            id="coach-text"
            rows={1}
            enterKeyHint="send"
            value={text}
            maxLength={MAX_CHARS}
            placeholder={openAsk ? "回 Woo：感覺怎麼樣…" : "跟 Woo 聊跑步、課表…"}
            aria-label={openAsk ? "回 Woo" : "問 Woo"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text, quote?.id); } }}
          />
          <button type="submit" className="send" aria-label="送出" disabled={busy || !text.trim()}><SendIcon /></button>
        </div>
        {error ? <p className="hint err" role="alert">{error}</p> : null}
      </form>
    </FlashContext.Provider>
  );
}
