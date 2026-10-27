import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/_app.plan";
import { Link, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { BackIcon } from "../components/icons";
import { SessionSheet } from "../components/session-sheet";
import { Avatar, Bar, CoachAvatar, TopBar } from "../components/ui";
import { ApiError, postProposal } from "../lib/api";
import { md, timeJst } from "../lib/date";
import { duration, km, kmPlan, pace } from "../lib/format";
import { isStrengthDay, rowName, sportName, verdictKind } from "../lib/labels";
import { activityDate, buildPlanView, isRunSport, type Day, type Week } from "../lib/plan";
import { buildPreview, type Preview } from "../lib/preview";
import { NoPlan, usePlan } from "../lib/use-plan";
import { useProposal } from "../lib/use-proposal";
import type { ApiActivity, ApiRoutine, ApiSession } from "../types/api";

export function meta(): Route.MetaDescriptors {
  return [{ title: "課表 · 富士山マラソン 2026" }];
}

function WeekBars({ weeks, selected, onSelect, changed }: { weeks: Week[]; selected: number; onSelect: (weekNo: number) => void; changed?: Set<number> }) {
  const max = Math.max(1, ...weeks.map((w) => w.plan_m));
  const isRace = (w: Week) => w.days.some((d) => d.session.type === "race");
  return (
    <section className="weekbars" style={{ "--n": weeks.length } as React.CSSProperties} aria-label="每週跑量，點一週切換下面的課表">
      <div className="cols" role="tablist" aria-label="週">
        {weeks.map((w) => {
          const h = `${Math.max(6, (w.plan_m / max) * 100)}%`;
          const on = w.week_no === selected;
          return (
            <button
              key={w.week_no}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={`第 ${w.week_no} 週 ${km(w.actual_m)} / ${kmPlan(w.plan_m)} km`}
              className={`col${w.isComplete ? " done" : ""}${isRace(w) ? " race" : ""}${on ? " on" : ""}`}
              onClick={() => onSelect(w.week_no)}
            >
              <i style={{ height: h }}>
                {!w.isComplete && w.actual_m > 0 ? <b style={{ height: `${Math.min(100, (w.actual_m / w.plan_m) * 100)}%` }} /> : null}
              </i>
            </button>
          );
        })}
      </div>
      <div className="labels" aria-hidden="true">
        {weeks.map((w) => (
          <span key={w.week_no} className={[isRace(w) ? "race" : "", w.isCurrent ? "cur" : "", w.week_no === selected ? "on" : "", changed?.has(w.week_no) ? "changed" : ""].join(" ")}>
            {isRace(w) ? "42" : w.week_no}
          </span>
        ))}
      </div>
    </section>
  );
}

/** The first sentence of a note, for the one sub-line a row has room for. */
function firstSentence(t: string | null): string | null {
  if (!t) return null;
  const m = /^[^。！？!?；;]+/.exec(t.trim());
  return m ? m[0] : t;
}

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function DayRow({ day, isToday, onOpen, routine, was, preview }: { day: Day; isToday: boolean; onOpen: (s: ApiSession) => void; routine: ApiRoutine | null; was?: string; preview?: boolean }) {
  const { session: s, activity: a, status } = day;
  const date = new Date(`${s.scheduled_date}T00:00:00Z`);
  const rest = s.type === "rest";
  const strength = rest && isStrengthDay(s);
  let right: React.ReactNode = null;
  let dot: string | null = null;
  if (a) {
    const run = isRunSport(a.sport_type);
    right = (
      <>
        {run || a.distance_m > 0 ? <><b className="num">{km(a.distance_m)}</b> km</> : <b className="num">{duration(a.moving_time_sec)}</b>}
        {run && a.avg_pace_sec_km ? <> · <b className="num">{pace(a.avg_pace_sec_km)}</b></> : a.avg_hr != null ? <> · <b className="num">{a.avg_hr}</b> bpm</> : null}
      </>
    );
    dot = verdictKind(a.review?.verdict) ?? "none";
  } else if (routine?.completed_at) {
    const n = routine.items.filter((i) => i.done).length;
    right = <><b className="num">{n}/{routine.items.length}</b> 項{routine.rpe ? <> · RPE <b className="num">{routine.rpe}</b></> : null}</>;
    dot = "good";
  } else if (status === "skipped") {
    right = <span className="grey">跳過</span>;
    dot = "skip";
  } else if (!rest && s.target) {
    right = <span className="grey">{s.target.replace(/\s*\/\s*/g, " · ")}</span>;
  }
  const sub = !a && !rest && status !== "skipped" ? s.brief ?? firstSentence(s.note) : null;
  const inner = (
    <>
      <div className="d"><span className="dow">{DOW[date.getUTCDay()]}</span><span className="num dom">{date.getUTCDate()}</span></div>
      <Avatar session={s} sport={a?.sport_type} />
      <div className="n"><div className={`t${rest && !strength ? " rest" : ""}`}>{rowName(s)}</div>{was ? <div className="was">{was}</div> : sub ? <div className="sub">{sub}</div> : null}</div>
      <div className="r">{right}{dot ? <i className={`dot ${dot}`} /> : null}</div>
    </>
  );
  const cls = `dayrow${isToday ? " today" : ""}${status === "skipped" ? " skipped" : ""}${was ? " changed" : ""}`;
  if (a) return <Link to={`/activities/${a.id}`} className={cls}>{inner}</Link>;
  if (preview || (rest && !s.note && !s.brief)) return <div className={cls}>{inner}</div>; // a preview row carries its "原本" line instead of a sheet
  return <button type="button" className={cls} onClick={() => onOpen(s)}>{inner}</button>;
}

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
            <span className="r">
              {run || a.distance_m > 0 ? <><b className="num">{km(a.distance_m)}</b> km</> : <><b className="num">{Math.round(a.moving_time_sec / 60)}</b> 分</>}
              {run && a.avg_pace_sec_km ? <> · <b className="num">{pace(a.avg_pace_sec_km)}</b></> : a.avg_hr != null ? <> · <b className="num">{a.avg_hr}</b> bpm</> : null}
            </span>
          </Link>
        );
      })}
    </section>
  );
}

/** This week: '這週還剩 輕鬆跑 6 km、長跑 16 km'; a past week: '跑了 3 / 4 堂'. */
function remaining(week: Week): string {
  const planned = week.days.filter((d) => d.session.type !== "rest");
  if (week.isPast) return `跑了 ${planned.filter((d) => d.activity).length} / ${planned.length} 堂`;
  const left = planned.filter((d) => !d.activity && d.status !== "skipped").map((d) => rowName(d.session));
  return left.length ? `這週還剩 ${left.join("、")}` : "這週的課都跑完了";
}

// /plan?proposal=<id>: the plan as it would be after one of Woo's cards (本地疊上去，不打新 API),
// with 採用／不用 in the top bar. Anything else is the plain plan.
export default function Plan() {
  const base = usePlan();
  const proposalId = useSearchParams()[0].get("proposal");
  const { proposal, ready } = useProposal(proposalId);
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [picked, setPicked] = useState<number | null>(null);
  const [open, setOpen] = useState<ApiSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeGone, setNoticeGone] = useState<string | null>(null);

  // The card still waiting for an answer is previewed; one that was decided elsewhere (or is gone)
  // gets the plain plan and a grey line for 3 seconds.
  const pending = !!proposal && proposal.status === "pending";
  const preview: Preview | null = useMemo(() => (base && proposal && pending ? buildPreview(base.data, proposal) : null), [base, proposal, pending]);
  const view = useMemo(() => (preview && base ? buildPlanView(preview.data, base.today) : base), [preview, base]);
  const notice = !!proposalId && ready && !preview;
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNoticeGone(proposalId), 3000);
    return () => window.clearTimeout(t);
  }, [notice, proposalId]);

  if (!view || !base) return <NoPlan title="課表" />;
  const { weeks, currentWeek, today } = view;
  const current = currentWeek?.week_no ?? weeks.find((w) => w.isFuture)?.week_no ?? weeks[weeks.length - 1]?.week_no;
  const firstChanged = preview ? weeks.find((w) => preview.changedWeeks.has(w.week_no))?.week_no : undefined;
  const selected = picked ?? firstChanged ?? current;
  const idx = weeks.findIndex((w) => w.week_no === selected);
  const week = weeks[idx];
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
      if (action === "apply") {
        setPicked(null);
        await revalidator.revalidate();
        void navigate("/plan", { replace: true });
      } else void navigate("/coach");
    } catch (e) {
      // 409: the plan changed since — the card is stale now, the thread says so.
      if (e instanceof ApiError && e.status === 409) void navigate("/coach");
      else setError(e instanceof ApiError ? e.message : "送出失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {preview ? (
        <header className="plan-preview-bar">
          <Link to="/coach" className="back" aria-label="返回教練"><BackIcon /></Link>
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
                ) : <div className="sub">{md(week.week_start)}–{md(week.week_end)} · {week.isFuture ? (week.focus ?? "") : remaining(week)}</div>}
              </div>
              <button type="button" className="step" onClick={go(idx + 1)} disabled={!go(idx + 1)} aria-label="下一週">›</button>
            </div>
            {!week.isFuture ? <Bar value={week.actual_m} max={week.plan_m} tone={week.isComplete ? "good" : "ink"} /> : null}
            <div className="dayrows">
              {week.days.map((d) => <DayRow key={d.session.id} day={d} isToday={d.session.scheduled_date === today} onOpen={setOpen} routine={view.routineBySession.get(d.session.id) ?? null} was={preview?.was.get(d.session.id)} preview={!!preview} />)}
            </div>
            {preview ? (
              <p className="plan-note">
                琥珀線的列是這張提案會改的，下面一行是改前。
                {changedList.filter((n) => n !== week.week_no).length ? `${changedList.filter((n) => n !== week.week_no).map((n) => `第 ${n} 週${n < week.week_no ? "（‹）" : "（›）"}`).join("、")}也有改。` : ""}
                採用後{changedList.map(weekAfter).join("、")}。
              </p>
            ) : null}
            <ExtraRows week={week} unassigned={view.unassigned} />
          </>
        ) : null}
      </main>
      <SessionSheet session={open} view={view} onClose={() => setOpen(null)} />
    </>
  );
}
