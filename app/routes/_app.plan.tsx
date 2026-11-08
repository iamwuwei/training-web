import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/_app.plan";
import { Link, useLocation, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { BackIcon } from "../components/icons";
import { DayRow, WeekBars } from "../components/plan-week";
import { SessionSheet } from "../components/session-sheet";
import { WeeklyReviewSheet } from "../components/weekly-review-sheet";
import { Avatar, Bar, CoachAvatar, TopBar } from "../components/ui";
import { ApiError, postProposal } from "../lib/api";
import { md, timeJst } from "../lib/date";
import { km, kmPlan, pace } from "../lib/format";
import { sportName } from "../lib/labels";
import { activityDate, buildPlanView, isRunSport, weekSubline, type Week } from "../lib/plan";
import { buildPreview, type Preview } from "../lib/preview";
import { NoPlanEntry, usePlan } from "../lib/use-plan";
import { useProposal, useReviewedWeeks } from "../lib/use-proposal";
import { reviewForWeek, useWeeklyReviews } from "../lib/use-weekly";
import { resetWeeklyCaches } from "../lib/use-weekly-message";
import type { ApiActivity, ApiSession, ApiWeek, PlanResponse } from "../types/api";
import { pageTitle } from "../lib/meta";

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("課表", matches);
}

const NO_WEEKS: ApiWeek[] = [];

/** 其他活動: the week's Strava activities that are not a session (walks, strength, unmatched runs), under the 7 rows. Each opens its report. */
function ExtraRows({ week, unassigned }: { week: Week; unassigned: ApiActivity[] }) {
  const rows = unassigned
    .filter((a) => { const d = activityDate(a); return a.match_status !== "ignored" && d >= week.week_start && d <= week.week_end; })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (!rows.length) return null;
  return (
    <section className="extras" aria-label="其他活動">
      <h3 className="h">其他活動 · 沒配到課的</h3>
      {rows.map((a) => {
        const run = isRunSport(a.sport_type);
        return (
          <Link key={a.id} to={`/activities/${a.id}`} className="row">
            <span aria-hidden="true" />
            <Avatar session={null} sport={a.sport_type} />
            <span className="n"><span className="t">{sportName(a.sport_type)}</span><span className="when">{md(activityDate(a))} {timeJst(a.start_time)}</span></span>
            <span className="r">{run || a.distance_m > 0 ? <><b className="num">{km(a.distance_m)}</b> km</> : <><b className="num">{Math.round(a.moving_time_sec / 60)}</b> 分</>}</span>
            <span className="r">{run && a.avg_pace_sec_km ? <><b className="num">{pace(a.avg_pace_sec_km)}</b> /km</> : a.avg_hr != null ? <><b className="num">{a.avg_hr}</b> bpm</> : null}</span>
          </Link>
        );
      })}
    </section>
  );
}

// /plan?proposal=<id>: the plan as it would be after one of Woo's cards (本地疊上去，不打新 API),
// with 採用／不用 in the top bar. Anything else is the plain plan.
export default function Plan() {
  const base = usePlan();
  const proposalId = useSearchParams()[0].get("proposal");
  const { proposal, ready } = useProposal(proposalId);
  const navigate = useNavigate();
  const location = useLocation();
  // the preview is reached from the thread's 「在課表上看」: going back to the thread is one step back in history (the thread is a modal; closing it again lands before it)
  const cameFromApp = location.key !== "default";
  const backToCoach = () => void (cameFromApp ? navigate(-1) : navigate("/coach", { replace: true }));
  const revalidator = useRevalidator();
  const [picked, setPicked] = useState<number | null>(null);
  const [open, setOpen] = useState<ApiSession | null>(null);
  // the weekly-review sheet (週回顧): the entry is in the header of a week that has one
  const { reviews } = useWeeklyReviews();
  const [reviewId, setReviewId] = useState<string | null>(null);
  if (proposalId && reviewId) setReviewId(null); // 在課表上看 on a card in the sheet: the sheet is done, the preview takes over
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeGone, setNoticeGone] = useState<string | null>(null);
  // 採用 went through: until the reloaded plan is in, keep showing the plan the athlete just saw
  // (without markers) — laying the card over the already-changed plan would add a session twice.
  const [applied, setApplied] = useState<{ id: string; data: PlanResponse } | null>(null);
  const done = !!applied && applied.id === proposalId;

  // The card still waiting for an answer is previewed; one that was decided elsewhere (or is gone)
  // gets the plain plan and a grey line for 3 seconds.
  const pending = !!proposal && proposal.status === "pending" && !done;
  // a 補課 counts in its original week unless that week's review is already written: that needs GET /weekly
  const makeup = pending && !!proposal?.changes.some((c) => c.makeup);
  const { reviewed, ready: reviewsReady } = useReviewedWeeks(makeup, base?.data.weeks ?? NO_WEEKS);
  const preview: Preview | null = useMemo(() => (base && proposal && pending && reviewsReady ? buildPreview(base.data, proposal, reviewed) : null), [base, proposal, pending, reviewsReady, reviewed]);
  const view = useMemo(() => (done && base ? buildPlanView(applied.data, base.today) : preview && base ? buildPlanView(preview.data, base.today) : base), [done, applied, preview, base]);
  const notice = !!proposalId && ready && reviewsReady && !preview && !done;
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNoticeGone(proposalId), 3000);
    return () => window.clearTimeout(t);
  }, [notice, proposalId]);

  if (!view || !base) return <NoPlanEntry title="課表" />;
  const { weeks, currentWeek, today } = view;
  const current = currentWeek?.week_no ?? weeks.find((w) => w.isFuture)?.week_no ?? weeks[weeks.length - 1]?.week_no;
  // a 補課 card opens on the week it moves to: the week it came from is over, with one grey row in it
  const changedIn = preview ? weeks.filter((w) => preview.changedWeeks.has(w.week_no)) : [];
  const firstChanged = preview ? (preview.hasMakeup ? changedIn.find((w) => !w.isPast) : undefined)?.week_no ?? changedIn[0]?.week_no : undefined;
  const selected = picked ?? firstChanged ?? current;
  const idx = weeks.findIndex((w) => w.week_no === selected);
  const week = weeks[idx];
  const entry = week && !preview && !week.isFuture ? reviewForWeek(week, reviews) : null;
  const go = (i: number) => (i >= 0 && i < weeks.length ? () => setPicked(weeks[i].week_no) : undefined);
  const changedList = preview ? [...preview.changedWeeks].sort((a, b) => a - b) : [];
  const weekAfter = (n: number) => `第 ${n} 週 ${kmPlan(weeks.find((w) => w.week_no === n)?.plan_m ?? 0)} km`;

  // 採用 stays on the plan (now the new one); 不用 = this card is not taken, back to the thread.
  async function decide(action: "apply" | "dismiss") {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      await postProposal(proposal.id, action);
      resetWeeklyCaches(); // a weekly card decided here: what the weekly-review sheet kept about it is out of date
      if (action === "apply") {
        if (preview) setApplied({ id: proposal.id, data: preview.data });
        setPicked(null);
        await revalidator.revalidate();
        void navigate("/plan", { replace: true });
      } else backToCoach();
    } catch (e) {
      // 409: the plan changed since — the card is stale now, the thread says so.
      if (e instanceof ApiError && e.status === 409) backToCoach();
      else setError(e instanceof ApiError ? e.message : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {preview ? (
        <header className="plan-preview-bar">
          <button type="button" className="back" aria-label="返回教練" onClick={backToCoach}><BackIcon /></button>
          <CoachAvatar size={24} />
          <div className="mid">
            <div className="t">預覽 Woo 的提案</div>
            <div className="s">{changedList.length ? `第 ${changedList.join("、")} 週會改 · 還沒生效` : "還沒生效"}</div>
          </div>
          <button type="button" className="chip primary" disabled={busy} onClick={() => void decide("apply")}>採用</button>
          <button type="button" className="chip" disabled={busy} onClick={() => void decide("dismiss")}>不用</button>
        </header>
      ) : <TopBar title="課表" aside={currentWeek?.phase ? currentWeek.phase : `${weeks.length} 週`} />}
      <main>
        {notice && noticeGone !== proposalId ? <p className="plan-notice" role="status">這張提案已經處理過了</p> : null}
        {error ? <p className="plan-notice" role="alert" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
        <WeekBars weeks={weeks} selected={selected} onSelect={setPicked} changed={preview?.changedWeeks} />
        {week ? (
          <>
            <div className="week-head2">
              <button type="button" className="step" onClick={go(idx - 1)} disabled={!go(idx - 1)} aria-label="上一週">‹</button>
              <div className="mid">
                <div className="line">
                  <span className="title">第 {week.week_no} 週 {week.isCurrent ? <span className="pill">本週</span> : current != null && current !== week.week_no ? <button type="button" className="back-today" onClick={() => setPicked(current)}>回本週</button> : null}</span>
                  <span className="kms">
                    {preview && preview.changedWeeks.has(week.week_no) && preview.beforeM.get(week.week_no) !== week.plan_m ? <span className="was"><s>{kmPlan(preview.beforeM.get(week.week_no))}</s> →</span> : null}
                    {week.isFuture ? <><b className="num plan">{kmPlan(week.plan_m)}</b><span className="of"> km</span></> : <><b className={`num${week.isComplete ? " done" : ""}`}>{km(week.actual_m)}</b><span className="of"> / {kmPlan(week.plan_m)} km</span></>}
                  </span>
                </div>
                {preview && preview.focusWas.has(week.week_no) ? (
                  <div className="sub">{md(week.week_start)}–{md(week.week_end)} · <span className="was"><s>{preview.focusWas.get(week.week_no)}</s></span><br /><span className="now">{week.focus}</span></div>
                ) : <div className="sub">{md(week.week_start)}–{md(week.week_end)} · {weekSubline(week, view)}</div>}
                {entry ? <button type="button" className="review-entry" onClick={() => setReviewId(entry.id)}><CoachAvatar size={20} />週回顧 ›</button> : null}
              </div>
              <button type="button" className="step" onClick={go(idx + 1)} disabled={!go(idx + 1)} aria-label="下一週">›</button>
            </div>
            {!week.isFuture ? <Bar value={week.actual_m} max={week.plan_m} tone={week.isComplete ? "good" : "ink"} /> : null}
            <div className="dayrows">
              {week.days.map((d) => <DayRow key={d.session.id} day={d} view={view} weekNo={week.week_no} isToday={d.session.scheduled_date === today} onOpen={setOpen} routine={view.routineBySession.get(d.session.id) ?? null} was={preview?.was.get(d.session.id)} preview={!!preview} />)}
            </div>
            {preview ? (
              <p className="plan-note">
                琥珀線的列是這張提案會改的，下面一行是改前。
                {changedList.filter((n) => n !== week.week_no).length ? `${changedList.filter((n) => n !== week.week_no).map((n) => `第 ${n} 週也有改${n < week.week_no ? "（‹）" : "（›）"}`).join("；")}。` : ""}
                採用後{changedList.map(weekAfter).join("、")}。
              </p>
            ) : null}
            <ExtraRows week={week} unassigned={view.unassigned} />
          </>
        ) : null}
      </main>
      <SessionSheet session={open} view={view} onClose={() => setOpen(null)} onOpen={setOpen} />
      <WeeklyReviewSheet review={reviews.find((r) => r.id === reviewId) ?? null} view={view} onClose={() => setReviewId(null)} />
    </>
  );
}
