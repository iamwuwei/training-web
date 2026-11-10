import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.plan_.draft.$id";
import { GroupConfirm } from "../components/group-confirm";
import { ChevronIcon, EditIcon, RefreshIcon, TrashIcon } from "../components/icons";
import { DayRow, WeekBars } from "../components/plan-week";
import { BackPill, GlassButton, NavBar } from "../components/nav-bar";
import { Bar, CoachAvatar } from "../components/ui";
import { WooStatus } from "../components/woo-status";
import { adoptPlanDraft, ApiError, discardPlanDraft, getPlanDraft, resumePlanDraft } from "../lib/api";
import { md, todayJst } from "../lib/date";
import {
  adoptErrorText, basisLines, draftName, DRAFT_TEXT, draftToPlanResponse, ERROR_CALLS_EXHAUSTED, firstSentence, flagList, flaggedWeeks, flagWhere,
  isDraftStateError, progressPct, resumeErrorText, saveIntake, stageText, startLine, weeksDone, weeksLine, type FlagItem,
} from "../lib/draft";
import { kmPlan, km } from "../lib/format";
import { SEND_FAILED } from "../lib/groups";
import { buildPlanView, weekSubline } from "../lib/plan";
import { useReviewPolling } from "../lib/use-review-polling";
import type { ApiPlanDraft } from "../types/api";

/**
 * The draft is read again on every poll (useReviewPolling revalidates). One failed read (a 5xx, the phone's network coming back from the
 * background) must not take the page down: while the draft is pending the last good reading stays on screen, and only after
 * `POLL_FAILS_SHOWN` failed reads in a row does the page say so. A first reading that fails has nothing to fall back on (`loadFailed`).
 */
const POLL_FAILS_SHOWN = 3;
// What the polls share. They belong to one visit of one draft: leaving the page (see the effect in PlanDraft) or opening another draft
// starts them again, so coming back never inherits an earlier visit's old progress or its failed reads.
let lastGood: ApiPlanDraft | null = null;
let failures = 0;
let seenId: string | null = null;
let mounted = 0;

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  if (seenId !== params.id) { seenId = params.id; lastGood = null; failures = 0; }
  try {
    const { draft } = await getPlanDraft(params.id);
    lastGood = draft;
    failures = 0;
    return { draft: draft as ApiPlanDraft | null, notFound: false, failures: 0, loadFailed: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) { lastGood = null; failures = 0; return { draft: null as ApiPlanDraft | null, notFound: true, failures: 0, loadFailed: false }; }
    if (e instanceof ApiError && e.status === 401) throw e; // the layout sends the person to the login page
    failures += 1;
    // only a pending draft of this id falls back (that is the poll); a page opened fresh on a draft that can not be read says so
    if (lastGood && lastGood.id === params.id && lastGood.status === "pending") return { draft: lastGood as ApiPlanDraft | null, notFound: false, failures, loadFailed: false };
    return { draft: null as ApiPlanDraft | null, notFound: false, failures, loadFailed: true };
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "新課表" }];
}

const T = DRAFT_TEXT;
const noop = () => {};

/** Woo's thought (the first sentence, 全文 › opens the rest in place) and what it rests on. Shown as soon as the skeleton has one. */
function DraftWhy({ d }: { d: ApiPlanDraft }) {
  const [open, setOpen] = useState(false);
  const full = (d.summary ?? "").trim();
  const first = firstSentence(full);
  const more = full.length > first.length;
  return (
    <section className="draft-why" aria-label={T.preview.whyK}>
      <CoachAvatar size={36} />
      <div>
        <div className="k">{T.preview.whyK}</div>
        <p className="text">
          {open ? full : first}
          {more && !open ? <> <button type="button" className="more" aria-expanded={false} onClick={() => setOpen(true)}>{T.preview.full}</button></> : null}
        </p>
        {d.profile ? basisLines(d.profile).map((l) => <p className="basis" key={l}>{l}</p>) : null}
      </div>
    </section>
  );
}

/** 「n 條提醒」: the whole draft's lines first, then week by week; a line with a place is a button that goes to that week. */
function DraftFlags({ items, onGo }: { items: FlagItem[]; onGo: (weekNo: number) => void }) {
  const [all, setAll] = useState(false);
  const folded = !all && items.length > 4;
  const shown = folded ? items.slice(0, 3) : items;
  return (
    <section className="draft-flags" aria-label="提醒">
      <div className={`h${items.length ? "" : " none"}`}>{items.length ? `${items.length} 條提醒` : T.preview.none}</div>
      {items.length === 0 ? <p className="none">{T.preview.noneSub}</p> : shown.map((f, i) => {
        const where = flagWhere(f);
        return f.week_no == null ? (
          <div className="draft-flag" key={i}><span>{f.text}</span></div>
        ) : (
          <button type="button" className="draft-flag" key={i} onClick={() => onGo(f.week_no as number)}>
            <span>{f.text}</span>
            <span className="wk">{where}<ChevronIcon aria-hidden="true" /></span>
          </button>
        );
      })}
      {folded ? <button type="button" className="more-flags" onClick={() => setAll(true)}>還有 {items.length - 3} 條 ›</button> : null}
    </section>
  );
}

/** Generating: Woo's line, the bar, how many weeks are in. */
function DraftWait({ d, timedOut }: { d: ApiPlanDraft; timedOut: boolean }) {
  return (
    <>
      <div className="draft-wait">
        <CoachAvatar size={36} />
        <div>
          <div className="st">{timedOut ? T.wait.slow : <WooStatus stage={null} fallback={stageText(d)} />}</div>
          <Bar value={progressPct(d)} max={100} tone="ink" />
          <div className="s">{weeksLine(d)}</div>
        </div>
      </div>
      <p className="plan-note">{T.wait.note}</p>
    </>
  );
}

/** The preview: the plan page's own week bars and rows, with Woo's flags hung where they belong. */
function DraftPreview({ d, adopt, adopting, adoptError }: { d: ApiPlanDraft; adopt: () => void; adopting: boolean; adoptError: string | null }) {
  const today = todayJst();
  const view = useMemo(() => buildPlanView(draftToPlanResponse(d), today), [d, today]);
  const items = useMemo(() => flagList(d), [d]);
  const changed = useMemo(() => flaggedWeeks(d), [d]);
  const [picked, setPicked] = useState<number | null>(null);
  const head = useRef<HTMLDivElement>(null);
  const weeks = view.weeks;
  const selected = picked ?? weeks[0]?.week_no ?? 1;
  const idx = weeks.findIndex((w) => w.week_no === selected);
  const week = weeks[idx];
  const go = (i: number) => (i >= 0 && i < weeks.length ? () => setPicked(weeks[i].week_no) : undefined);
  const weekFlags = d.weeks.find((w) => w.week_no === selected)?.flags ?? [];
  const byDate = useMemo(() => new Map(d.sessions.map((s) => [s.date, s.flags ?? []])), [d.sessions]);

  function jump(weekNo: number) {
    setPicked(weekNo);
    window.setTimeout(() => head.current?.scrollIntoView({ block: "start" }), 0);
  }

  return (
    <>
      <main className="draft">
        <DraftWhy d={d} />
        <DraftFlags items={items} onGo={jump} />
        <WeekBars weeks={weeks} selected={selected} onSelect={setPicked} changed={changed} />
        {week ? (
          <>
            <div className="week-head2" ref={head} style={{ scrollMarginTop: 64 }}>
              <button type="button" className="step" onClick={go(idx - 1)} disabled={!go(idx - 1)} aria-label="上一週">‹</button>
              <div className="mid">
                <div className="line">
                  <span className="title">第 {week.week_no} 週 {week.isCurrent ? <span className="pill">本週</span> : null}</span>
                  <span className="kms">
                    {week.isFuture ? <><b className="num plan">{kmPlan(week.plan_m)}</b><span className="of"> km</span></> : <><b className="num">{km(week.actual_m)}</b><span className="of"> / {kmPlan(week.plan_m)} km</span></>}
                  </span>
                </div>
                <div className="sub">{md(week.week_start)}–{md(week.week_end)} · {weekSubline(week, view)}</div>
              </div>
              <button type="button" className="step" onClick={go(idx + 1)} disabled={!go(idx + 1)} aria-label="下一週">›</button>
            </div>
            {weekFlags.map((t, i) => <p className="draft-week-flag" key={i}>{t}</p>)}
            <div className="grp dayrows draft-days">
              {week.days.map((day) => {
                const flags = byDate.get(day.session.scheduled_date) ?? [];
                return <DayRow key={day.session.id} day={day} view={view} weekNo={week.week_no} isToday={day.session.scheduled_date === today} onOpen={noop} routine={null} was={flags.length ? flags.join("；") : undefined} preview />;
              })}
            </div>
            <p className="plan-note">{T.preview.note}</p>
          </>
        ) : null}
      </main>
      <div className="draft-bar">
        <div className="row">
          <span className={`s${adoptError ? " err" : ""}`} role={adoptError ? "alert" : undefined}>{adoptError ?? startLine(d)}</span>
          <button type="button" className="btn compact primary" disabled={adopting} onClick={adopt}>{adopting ? T.preview.adopting : T.preview.adopt}</button>
        </div>
      </div>
    </>
  );
}

/** A draft that is not going anywhere: failed, expired, discarded, or not there. Same layout as the entry on 今天. */
function DraftEnd({ d, onRestart, onResume, resuming, resumeError }: { d: ApiPlanDraft | null; onRestart: () => void; onResume: () => void; resuming: boolean; resumeError: string | null }) {
  const E = T.end;
  let avatar = true, title: string, sub: string, buttons: React.ReactNode, hint: string | null = null;
  if (!d) {
    avatar = false; title = E.notFoundTitle; sub = E.notFoundSub;
    buttons = <Link to="/" className="link">{E.goToday}</Link>;
  } else if (d.status === "failed") {
    const k = weeksDone(d);
    title = E.failedTitle;
    const why = d.error ? `${d.error}。` : "";
    if (d.can_resume) {
      sub = `${why}${k > 0 ? `第 1〜${k} 週已經排好，按「${E.resume}」從第 ${k + 1} 週接著排。` : `按「${E.resume}」從斷掉的地方接著排。`}`;
      buttons = (
        <div className="actions-row center">
          <button type="button" className="btn compact" disabled={resuming} onClick={onRestart}>{E.restart}</button>
          <button type="button" className="btn compact primary" disabled={resuming} onClick={onResume}>{resuming ? E.resumeBusy : E.resume}</button>
        </div>
      );
      hint = E.resumeNote;
    } else {
      sub = `${why}${d.error === ERROR_CALLS_EXHAUSTED ? E.exhausted : E.noResume}`;
      buttons = <div className="actions-row center"><button type="button" className="btn compact primary" onClick={onRestart}>{E.restart}</button></div>;
    }
  } else if (d.status === "expired") {
    title = E.expiredTitle; sub = E.expiredSub;
    buttons = <div className="actions-row center"><button type="button" className="btn compact primary" onClick={onRestart}>{E.restart}</button></div>;
  } else {
    title = E.discardedTitle; sub = E.discardedSub;
    buttons = <Link to="/" className="link">{E.goToday}</Link>;
  }
  return (
    <>
      <div className="plan-entry">
        {avatar ? <CoachAvatar size={44} /> : null}
        <p className="t">{title}</p>
        <p className="sub">{sub}</p>
        {resumeError ? <p className="err" role="alert">{resumeError}</p> : null}
        {buttons}
        {hint ? <p className="hint">{hint}</p> : null}
      </div>
      {d?.summary ? <DraftWhy d={d} /> : null}
    </>
  );
}

export default function PlanDraft({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  // 繼續 answers with the draft as it is now (pending again): shown until the next reading of the loader replaces it
  const [override, setOverride] = useState<{ src: unknown; draft: ApiPlanDraft } | null>(null);
  const d = override && override.src === loaderData ? override.draft : loaderData.draft;
  const pending = d?.status === "pending";
  const { timedOut, restart } = useReviewPolling(pending);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const adopted = d?.status === "adopted";
  // the last reads of this pending draft failed (the last good one is still drawn): say so, and offer 再看一次
  const unreadable = pending && loaderData.failures >= POLL_FAILS_SHOWN;
  const ownAdopt = useRef(false);
  // leaving the page forgets the polls (the timeout lets development's mount–unmount–mount pass without forgetting)
  useEffect(() => {
    mounted += 1;
    return () => { mounted -= 1; window.setTimeout(() => { if (mounted === 0) { lastGood = null; failures = 0; seenId = null; } }, 0); };
  }, []);

  // opened an adopted draft (adopted in another tab, or the link kept): the plan is the active one now, the layout reads it again and 今天 draws it.
  // Our own 採用這份 does the same itself, below.
  useEffect(() => {
    if (adopted && !ownAdopt.current) { ownAdopt.current = true; void revalidate().then(() => navigate("/", { replace: true })); }
  }, [adopted, revalidate, navigate]);

  function startOver() {
    if (d) saveIntake(d.intake);
    void navigate("/plan/new");
  }

  async function adopt() {
    if (!d) return;
    setAdopting(true);
    setAdoptError(null);
    try {
      await adoptPlanDraft(d.id);
      ownAdopt.current = true;
      await revalidate();
      await navigate("/", { replace: true });
    } catch (e) {
      setAdopting(false);
      if (isDraftStateError(e)) void revalidate(); // the draft is something else now (expired …): read it and draw that
      else setAdoptError(adoptErrorText(e));
    }
  }

  async function resume() {
    if (!d) return;
    setResuming(true);
    setResumeError(null);
    try {
      const r = await resumePlanDraft(d.id);
      setOverride({ src: loaderData, draft: r.draft });
    } catch (e) {
      setResumeError(resumeErrorText(e));
    } finally {
      setResuming(false);
    }
  }

  const back = <BackPill to="/" label="今天" ariaLabel="返回今天" />;
  const title = <span className="t">{d ? draftName(d) : "新課表"}</span>;
  const discard = (
    <GroupConfirm open={discardOpen} title={T.discard.title} text={T.discard.text} action={T.discard.action} busyLabel={T.discard.busy} tone="danger"
      onCancel={() => setDiscardOpen(false)} onConfirm={async () => { await discardPlanDraft(d?.id ?? ""); await navigate("/", { replace: true }); }} />
  );
  const trash = <GlassButton label={T.wait.discard} onClick={() => setDiscardOpen(true)}><TrashIcon /></GlassButton>;

  if (loaderData.loadFailed) {
    return (
      <>
        <NavBar kind="inline" title={title} left={back} right={<GlassButton label={T.wait.again} onClick={() => void revalidate()}><RefreshIcon /></GlassButton>} />
        <main>
          <div className="plan-entry">
            <p className="err" role="alert">{SEND_FAILED}</p>
            <Link to="/" className="link">{T.end.goToday}</Link>
          </div>
        </main>
      </>
    );
  }

  if (!d || adopted) {
    return (
      <>
        <NavBar kind="inline" title={title} left={back} />
        <main>{adopted ? null : <DraftEnd d={null} onRestart={startOver} onResume={resume} resuming={false} resumeError={null} />}</main>
      </>
    );
  }

  if (d.status === "pending") {
    return (
      <>
        <NavBar kind="inline" title={title} left={back} right={<>
          {timedOut || unreadable ? <GlassButton label={T.wait.again} onClick={() => { restart(); void revalidate(); }}><RefreshIcon /></GlassButton> : null}
          {trash}
        </>} />
        <main>
          <DraftWait d={d} timedOut={timedOut} />
          {unreadable ? <p className="plan-note err" role="alert">{SEND_FAILED}</p> : null}
          {d.summary ? <DraftWhy d={d} /> : null}
        </main>
        {discard}
      </>
    );
  }

  if (d.status === "ready") {
    return (
      <>
        <NavBar kind="inline" title={title} left={back} right={<>
          <GlassButton label={T.preview.edit} onClick={startOver}><EditIcon /></GlassButton>
          {trash}
        </>} />
        <DraftPreview d={d} adopt={() => void adopt()} adopting={adopting} adoptError={adoptError} />
        {discard}
      </>
    );
  }

  return (
    <>
      <NavBar kind="inline" title={title} left={back} />
      <main><DraftEnd d={d} onRestart={startOver} onResume={() => void resume()} resuming={resuming} resumeError={resumeError} /></main>
    </>
  );
}
