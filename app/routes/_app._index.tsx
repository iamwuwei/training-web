import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { Route } from "./+types/_app._index";
import { GearIcon, MountainIcon } from "../components/icons";
import { PlanPost } from "../components/posts";
import { Progress } from "../components/progress";
import { SessionSheet } from "../components/session-sheet";
import { StrengthDay } from "../components/strength-day";
import { Avatar, Bar, CoachAvatar, SectionH, TopBar, VerdictTag } from "../components/ui";
import { md, mdDow, relativeDay, timeJst } from "../lib/date";
import { duration, int, km, kmPlan, pace } from "../lib/format";
import { isStrengthDay, shortName, sportName } from "../lib/labels";
import { ApiError, putSession } from "../lib/api";
import { activityDate, hrOver, isLoggable, isRunSport, lastReminderFor, paceFast, sessionForExtra, type Day, type PlanView } from "../lib/plan";
import { NoPlan, usePlan } from "../lib/use-plan";
import { useReviewPolling } from "../lib/use-review-polling";
import type { ApiActivity, ApiSession } from "../types/api";

export function meta(): Route.MetaDescriptors {
  return [{ title: "今天 · 富士山マラソン 2026" }];
}

// One post per state for today's session: not run → synced (log it) → coach analysing → verdict.
// Everything else (full comment, memo, splits) lives on the report page.

/** The first sentence of the coach's comment, for the one-line summary under today's run. */
function firstSentence(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /^[^。！？!?]+[。！？!?]?/.exec(text.trim());
  return m ? m[0] : text;
}

function WooLine({ text, to }: { text: string; to?: string }) {
  return <div className="wooline"><CoachAvatar size={20} /><span>{text}{to ? <> <Link to={to}>看報告</Link></> : null}</span></div>;
}

/** The first sentence of a note and the rest, split on the first full stop. */
function splitNote(note: string | null): { first: string; rest: string } | null {
  if (!note) return null;
  const t = note.trim();
  let m = /^([^。！？!?]+[。！？!?]?)([\s\S]*)$/.exec(t);
  // No full stop and a long run-on line: break at the first comma instead.
  if (m && !m[2].trim() && t.length > 24) m = /^([^，,]+[，,]?)([\s\S]*)$/.exec(t);
  if (!m) return { first: t, rest: "" };
  return { first: m[1].trim().replace(/[，,]$/, ""), rest: m[2].trim() };
}

/** A rest or strength day: one line, the note's first sentence, the rest behind 為什麼. */
function RestDay({ session }: { session: ApiSession }) {
  const [open, setOpen] = useState(false);
  const strength = isStrengthDay(session);
  const title = strength ? `今天肌力日${session.label === "肌力" && session.content && !/^肌力$/.test(session.content) ? ` · ${session.content}` : ""}` : /完全/.test(`${session.label ?? ""} ${session.content ?? ""}`) ? "今天完全休息" : "今天休息";
  const raw = strength ? (session.note ?? "").replace(/^肌力日[：:]\s*/, "") : session.note;
  // Woo's one line leads; the note itself sits behind 為什麼.
  const note = session.brief ? { first: session.brief, rest: raw?.trim() ?? "" } : splitNote(raw);
  return (
    <div className={`rest-day${strength ? " strength" : ""}`}>
      {strength ? <Avatar session={session} /> : (
        <svg width="120" height="64" viewBox="0 0 120 64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
          <path d="M4 58 L40 12 L52 26 L62 18 L96 58 Z" /><path d="M34 22 L40 28 L46 22 L52 26" />
          <path d="M100 30c6 0 9-4 9-8s-3-8-9-8-9 4-9 8 3 8 9 8z" stroke="var(--accent)" /><path d="M2 58h116" stroke="var(--line)" />
        </svg>
      )}
      <p className="t">{title}</p>
      {note ? (
        <p className="note">
          {note.first}
          {note.rest ? (open ? <> {note.rest}</> : <> <button type="button" className="more" onClick={() => setOpen(true)} aria-expanded={false}>為什麼 ›</button></>) : null}
        </p>
      ) : null}
    </div>
  );
}

function Stats({ a, day, big }: { a: ApiActivity; day: Day; big?: boolean }) {
  const run = isRunSport(a.sport_type);
  return (
    <div className={`stats${big ? " big" : ""}`}>
      {run || a.distance_m > 0 ? <span><b className="num">{km(a.distance_m)}</b> km</span> : <span><b className="num">{duration(a.moving_time_sec)}</b></span>}
      {run ? <span><b className={`num${paceFast(a, day.session) ? " over" : ""}`}>{pace(a.avg_pace_sec_km)}</b> /km</span> : null}
      {a.avg_hr != null ? <span><b className={`num${hrOver(a, day.session) ? " over" : ""}`}>{int(a.avg_hr)}</b> bpm</span> : null}
    </div>
  );
}

/** One tap: this Strava activity is that session. Woo reviews it afterwards. */
function useAssign() {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function assign(activityId: string, sessionId: string) {
    setBusy(true);
    setError(null);
    try {
      await putSession(activityId, { session_id: sessionId, replace: true });
      await revalidator.revalidate();
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 503 ? "資料庫還在啟動，幾秒後再按一次" : e.message) : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }
  return { assign, busy, error };
}

function TodayPost({ day, view, slow, onOpen }: { day: Day; view: PlanView; slow?: boolean; onOpen: (s: ApiSession) => void }) {
  const { session, activity } = day;
  const { assign, busy, error } = useAssign();

  if (activity) {
    const r = activity.review;
    const line = r?.reminders[0] ? `→ ${r.reminders[0]}` : firstSentence(r?.comment);
    return (
      <Link to={`/activities/${activity.id}`} className="post link today-post">
        <Avatar session={session} />
        <div className="body">
          <div className="head">
            <b>{shortName(session)}</b>
            {r?.verdict ? <VerdictTag verdict={r.verdict} /> : r?.failed ? <span className="pending failed">分析失敗，點進去重試</span> : view.data.coach_checkin_open ? <span className="pending">Woo 在等你回</span> : <span className="pending">{slow ? "分析比較久，點進去看" : "教練分析中…"}</span>}
          </div>
          <Stats a={activity} day={day} big />
          {line ? <div className="wooline"><CoachAvatar size={20} /><span>{line}</span></div> : null}
        </div>
      </Link>
    );
  }

  if (!isLoggable(session)) return <RestDay session={session} />;
  if (isStrengthDay(session)) {
    const title = `今天肌力日${session.label === "肌力" && session.content && !/^肌力$/.test(session.content) ? ` · ${session.content}` : ""}`;
    return (
      <>
        <StrengthDay session={session} routine={view.routineBySession.get(session.id) ?? null} title={title} />
        {view.data.coach_checkin_open ? <Link to="/coach" className="btn primary woo"><span className="w" aria-hidden="true">W</span>Woo 在問這趟練得怎麼樣</Link> : null}
      </>
    );
  }

  const synced = view.todayActivities.filter((a) => !a.session_id);
  const first = synced.find((a) => isRunSport(a.sport_type)) ?? synced[0];
  const prep = lastReminderFor(view, session);
  return (
    <div className="today-open">
      <button type="button" className="open-plan" onClick={() => onOpen(session)}><PlanPost session={session} big /></button>
      {prep && !first ? <WooLine text={prep} /> : null}
      {first ? (
        <>
          <p className="synced">
            <i aria-hidden="true" />Strava：{sportName(first.sport_type)}
            {first.distance_m > 0 ? <> <b className="num">{km(first.distance_m)}</b> km</> : null}
            {isRunSport(first.sport_type) ? <> · <b className="num">{pace(first.avg_pace_sec_km)}</b> /km</> : null}
          </p>
          {view.data.coach_checkin_open ? (
            <Link to="/coach" className="btn primary woo"><span className="w" aria-hidden="true">W</span>Woo 在問這趟練得怎麼樣</Link>
          ) : (
            <button type="button" className="btn primary" onClick={() => void assign(first.id, session.id)} disabled={busy}>{busy ? "送出中…" : "這趟就是今天的課"}</button>
          )}
          {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
        </>
      ) : (
        <p className="hint">跑完後 Strava 會自動同步到這裡</p>
      )}
    </div>
  );
}

function ExtraRow({ a, view }: { a: ApiActivity; view: PlanView }) {
  const target = sessionForExtra(view, a);
  const run = isRunSport(a.sport_type);
  const { assign, busy } = useAssign();
  return (
    <div className="extra-row">
      <Link to={`/activities/${a.id}`} className="who">
        <Avatar session={null} sport={a.sport_type} />
        <span className="txt">
          <span className="t">{sportName(a.sport_type)} {a.distance_m > 0 ? `${km(a.distance_m)} km` : duration(a.moving_time_sec)}</span>
          <span className="s">{[timeJst(a.start_time), run ? `${pace(a.avg_pace_sec_km)} /km` : null, a.avg_hr != null ? `${a.avg_hr} bpm` : null].filter(Boolean).join(" · ")}</span>
        </span>
      </Link>
      {target ? <button type="button" className="chip" onClick={() => void assign(a.id, target.id)} disabled={busy}>{busy ? "…" : `算成 ${target.scheduled_date === activityDate(a) ? "今天" : md(target.scheduled_date)} 的課`}</button> : null}
    </div>
  );
}

export default function Today() {
  const view = usePlan();
  const revalidator = useRevalidator();
  const todayAct = view?.todayDay?.activity ?? null;
  // No review yet and Woo isn't waiting on an answer: the worker is writing one.
  const analysing = !!(todayAct && !todayAct.review) && !view?.data.coach_checkin_open;
  const { timedOut } = useReviewPolling(analysing);
  const [open, setOpen] = useState<ApiSession | null>(null);
  if (!view) return <NoPlan title="今天" />;
  const { todayDay, todayActivities, upcoming, currentWeek, daysToRace, data, today } = view;

  // The activity surfaced inside today's post (state "synced") is not repeated below.
  const shownInPost = todayDay && !todayDay.activity && isLoggable(todayDay.session)
    ? (todayActivities.filter((a) => !a.session_id).find((a) => isRunSport(a.sport_type)) ?? todayActivities.find((a) => !a.session_id))?.id
    : undefined;
  const extras = todayActivities.filter((a) => !a.session_id && a.id !== shownInPost);
  const next = upcoming[0] ?? null;
  const nextPrep = next ? lastReminderFor(view, next.session) : null;

  return (
    <>
      <TopBar
        title={<><MountainIcon />富士山マラソン 2026</>}
        aside={<Link to="/settings" className="gear" aria-label="設定"><GearIcon /></Link>}
      />
      <main>
        <div className="hero2">
          <div>
            <div className="k">倒數</div>
            <div className="v">{daysToRace > 0 ? <><span className="num big">{daysToRace}</span><span className="unit">天</span></> : <span className="num mid">{daysToRace === 0 ? "比賽日" : "已完賽"}</span>}</div>
            <i aria-hidden="true" />
          </div>
          {currentWeek ? (
            <Link to="/plan" className="week-line" aria-label={`第 ${currentWeek.week_no} 週 ${km(currentWeek.actual_m)} / ${kmPlan(currentWeek.plan_m)} km`}>
              <div className="k">第 {currentWeek.week_no} 週 · {md(currentWeek.week_start)}–{md(currentWeek.week_end)}</div>
              <div className="v"><span className={`num mid${currentWeek.isComplete ? " done" : ""}`}>{km(currentWeek.actual_m)}</span><span className="unit">/ {kmPlan(currentWeek.plan_m)} km</span></div>
              <Bar value={currentWeek.actual_m} max={currentWeek.plan_m} tone={currentWeek.isComplete ? "good" : "ink"} />
            </Link>
          ) : null}
        </div>

        <SectionH
          action={<button type="button" className="chip" onClick={() => void revalidator.revalidate()} disabled={revalidator.state === "loading"}>{revalidator.state === "loading" ? "更新中…" : "重新整理"}</button>}
        >
          今天 · {mdDow(today)}
        </SectionH>
        {todayDay ? (
          <TodayPost day={todayDay} view={view} slow={timedOut} onOpen={setOpen} />
        ) : (
          <p className="empty">{today > data.plan.race_date ? "課表已結束，辛苦了。" : "課表還沒開始。"}</p>
        )}

        {extras.length ? (
          <>
            <SectionH>今天其他活動</SectionH>
            {extras.map((a) => <ExtraRow key={a.id} a={a} view={view} />)}
          </>
        ) : null}

        {/* Only the next session: the 進步 block below should start on the second screen. */}
        <SectionH>下次{next ? ` · ${mdDow(next.session.scheduled_date)}` : ""}</SectionH>
        {next ? (
          <button type="button" className="next-row first" onClick={() => setOpen(next.session)}>
            <Avatar session={next.session} />
            <span className="t">{next.session.content ?? shortName(next.session)}</span>
            <span className="when">{md(next.session.scheduled_date)} · {relativeDay(next.session.scheduled_date, today)}</span>
            {next.session.target ? <span className="sub">{next.session.target}</span> : null}
            {nextPrep ? <WooLine text={nextPrep} /> : null}
          </button>
        ) : <p className="empty">沒有後續課表</p>}

        <Progress view={view} />
      </main>
      <SessionSheet session={open} view={view} onClose={() => setOpen(null)} />
    </>
  );
}
