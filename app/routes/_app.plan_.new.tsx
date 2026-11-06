import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/_app.plan_.new";
import { BackIcon } from "../components/icons";
import { CoachAvatar, SectionH, TopBar } from "../components/ui";
import { ApiError, getActivities, getLatestPlanDraft, postPlanDraft } from "../lib/api";
import { addDays, todayJst } from "../lib/date";
import {
  clearIntake, defaultForm, DISTANCES, DRAFT_TEXT, EXPERIENCES, FIELD_ORDER, fieldOfCode, formDistanceM, formFromParams, formTargetSec, fromIntake,
  loadIntake, MINUTES, saveIntake, startWithWeeks, submitErrorLink, submitErrorText, targetPace, toIntake, validateForm, weeksBetween, WEEKDAYS,
  type FormErrors, type IntakeForm,
} from "../lib/draft";
import { mdDowPlain, mdPlain } from "../lib/groups";
import { duration, pace } from "../lib/format";
import { localProfile, type LocalProfile } from "../lib/profile";
import type { PlanIntake } from "../types/api";

export function meta(): Route.MetaDescriptors {
  return [{ title: DRAFT_TEXT.form.title }];
}

const T = DRAFT_TEXT;
const MAX_NAME = 40;
const MAX_NOTES = 200;

/** A row of choices, one at a time. */
function Chips<V extends string | number | null>({ items, value, onPick }: { items: { value: V; label: string }[]; value: V; onPick: (v: V) => void }) {
  return (
    <>
      {items.map((it) => (
        <button key={String(it.value)} type="button" className="chip" aria-pressed={it.value === value} onClick={() => onPick(it.value)}>{it.label}</button>
      ))}
    </>
  );
}

function distanceLabel(f: IntakeForm): string {
  if (f.distance === "other") return `${formDistanceM(f) != null ? (formDistanceM(f) as number) / 1000 : f.otherKm} km`;
  return DISTANCES.find((d) => d.value === f.distance)?.label ?? "";
}

/** Step 2's twelve bars: one per week, the height is the km of that week, a week without a run is the light one. */
function HistBars({ p }: { p: LocalProfile }) {
  const max = Math.max(1, ...p.weeks.map((w) => w.km));
  return (
    <>
      <div className="hist-bars" role="img" aria-label={`最近 12 週每週公里：${p.weeks.map((w) => Math.round(w.km * 10) / 10).join("、")}`}>
        {p.weeks.map((w) => <i key={w.week_start} className={w.km > 0 ? "" : "zero"} style={{ height: `${(w.km / max) * 100}%` }} />)}
      </div>
      <div className="hist-axis" aria-hidden="true"><span>{mdPlain(p.weeks[0].week_start)}</span><span>每週公里</span><span>{mdPlain(p.weeks[p.weeks.length - 1].week_start)}</span></div>
    </>
  );
}

function Stat({ k, children }: { k: string; children: React.ReactNode }) {
  return <div><dt>{k}</dt><dd>{children}</dd></div>;
}

/** Step 2: what Woo will see (the app's own 12 weeks, nothing sent yet) and the answers; 產生課表 sends them. */
function SummaryStep({ form, today, onBack, onDone }: { form: IntakeForm; today: string; onBack: () => void; onDone: (errors: FormErrors) => void }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<{ error: unknown; draftId: string | null } | null>(null);
  const S = T.summary;

  useEffect(() => {
    let live = true;
    // the app's own record of the last 12 weeks; if it can not be read the page says there is none, which it words as "in the app"
    getActivities().then((r) => r.activities, () => []).then((acts) => { if (live) setProfile(localProfile(acts, today)); });
    return () => { live = false; };
  }, [today]);

  async function send() {
    setBusy(true);
    setRejected(null);
    try {
      const intake: PlanIntake = toIntake(form);
      const { draft } = await postPlanDraft({ intake });
      saveIntake(intake);
      await navigate(`/plan/draft/${draft.id}`);
    } catch (e) {
      setBusy(false);
      const field = e instanceof ApiError && e.status === 400 ? fieldOfCode(e.message) : null;
      if (field) {
        // the api says the same as the form did: back to the first step, the sentence on that field
        const own = validateForm(form, today)[field];
        onDone({ [field]: own ?? (field === "start_date" ? `開始日要在今天到 ${mdPlain(addDays(today, 14))} 之間` : "送出失敗，再試一次") });
        return;
      }
      let draftId: string | null = null;
      if (e instanceof ApiError && e.message === "generating") {
        // the pending one is the newest draft; the api's 409 body has its id too, but request() keeps only the code
        draftId = await getLatestPlanDraft().then((r) => r.draft?.id ?? null, () => null);
      }
      setRejected({ error: e, draftId });
    }
  }

  const sec = form.hasTarget ? formTargetSec(form) : null;
  const dist = formDistanceM(form);
  const fixed = WEEKDAYS.filter((w) => form.fixed_rest_weekdays.includes(w.value)).map((w) => w.aria);
  const intake = toIntake(form);
  const link = rejected ? submitErrorLink(rejected.error) : null;

  return (
    <>
      <div className="wooline"><CoachAvatar size={20} /><span>{S.woo}</span></div>
      <SectionH>{S.histTitle}</SectionH>
      {profile == null ? (
        <div className="hist" aria-busy="true" aria-label="載入中">
          <div className="sk" style={{ height: 48 }} />
          <div className="sk" style={{ height: 14, width: "60%", marginTop: 14 }} />
        </div>
      ) : profile.total_runs === 0 ? (
        <div className="hist-none"><p className="t">{S.noneTitle}</p><p className="sub">{S.noneSub}</p></div>
      ) : (
        <>
          <div className="hist">
            <HistBars p={profile} />
            <dl className="hist-stats">
              <Stat k="最近 4 週 · 每週"><b className="num">{profile.last4.runs_per_week}</b><span className="unit">次</span> <b className="num">{profile.last4.km_per_week}</b><span className="unit">km</span></Stat>
              {profile.longest ? <Stat k="最長一次"><b className="num">{profile.longest.km}</b><span className="unit">km · {mdPlain(profile.longest.date)}</span></Stat> : null}
              {profile.avg_pace_sec_km ? <Stat k="平均配速"><b className="num">{pace(profile.avg_pace_sec_km)}</b><span className="unit">/km</span></Stat> : null}
              {profile.avg_hr ? <Stat k="平均心拍"><b className="num">{profile.avg_hr}</b><span className="unit">bpm</span></Stat> : null}
            </dl>
          </div>
          <p className="hist-foot">{S.histFoot}</p>
        </>
      )}

      <SectionH>{S.answers}</SectionH>
      <div className="intake-sum">
        <div className="setting"><span className="k">比賽</span><span className="v">{form.name.trim()}<br />{form.race_date ? mdDowPlain(form.race_date) : ""} · {distanceLabel(form)}</span></div>
        <div className="setting"><span className="k">目標</span><span className="v">{sec != null && dist != null ? `${duration(sec)}（${pace(targetPace(sec, dist))} /km）` : "完賽就好"}</span></div>
        <div className="setting"><span className="k">每週</span><span className="v">{form.days_per_week} 天{fixed.length ? ` · ${fixed.join("、")}固定休息` : ""}</span></div>
        <div className="setting"><span className="k">平日</span><span className="v">{form.weekday_minutes == null ? T.form.anyMinutes : `一堂最多 ${form.weekday_minutes} 分`}</span></div>
        <div className="setting"><span className="k">開始</span><span className="v">{startWithWeeks(intake)}</span></div>
        <div className="setting"><span className="k">經驗</span><span className="v">{EXPERIENCES.find((x) => x.value === form.experience)?.label}</span></div>
        <div className="setting"><span className="k">注意</span><span className="v">{form.notes.trim() || "（沒有）"}</span></div>
      </div>

      {rejected ? (
        <p className="err" role="alert">
          {submitErrorText(rejected.error)}
          {link === "draft" && rejected.draftId ? <> <Link to={`/plan/draft/${rejected.draftId}`}>看那份 ›</Link></> : null}
          {link === "settings" ? <> <Link to="/settings">去設定 ›</Link></> : null}
        </p>
      ) : null}
      <div className="actions-row">
        <button type="button" className="intake-edit grow" onClick={onBack} disabled={busy}>{S.edit}</button>
        <button type="button" className="btn compact primary woo" disabled={busy} onClick={() => void send()}><span className="w" aria-hidden="true">W</span>{busy ? S.sending : S.go}</button>
      </div>
      <p className="intake-foot">{S.foot}</p>
    </>
  );
}

export default function NewPlan() {
  const today = todayJst();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [init] = useState(() => {
    const kept = loadIntake(); // answers kept by 改答案再排／重新開始 come first, then the address, then the defaults
    if (kept) return { form: fromIntake(kept), carried: true };
    return { form: formFromParams(params, today) ?? defaultForm(today), carried: false };
  });
  const [form, setForm] = useState<IntakeForm>(init.form);
  const [step, setStep] = useState<1 | 2>(1);
  const [errors, setErrors] = useState<FormErrors>({});
  const cameFromApp = location.key !== "default";
  useEffect(() => { clearIntake(); }, []); // read once: the answers are not kept for a later visit
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  function set<K extends keyof IntakeForm>(key: K, value: IntakeForm[K], clears: (keyof IntakeForm)[] = [key]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (clears.some((k) => errors[k])) setErrors((e) => { const n = { ...e }; for (const k of clears) delete n[k]; return n; });
  }

  function show(e: FormErrors) {
    setErrors(e);
    setStep(1);
    const first = FIELD_ORDER.find((k) => e[k]);
    // after the first step is drawn again: the field with the first sentence comes to the middle of the screen
    if (first) window.setTimeout(() => document.getElementById(`field-${first}`)?.scrollIntoView({ block: "center" }), 0);
  }

  function next() {
    const e = validateForm(form, today);
    if (Object.keys(e).length) { show(e); return; }
    setErrors({});
    setStep(2);
  }

  const dist = formDistanceM(form);
  const sec = form.hasTarget ? formTargetSec(form) : null;
  const weeks = form.race_date && form.start_date ? weeksBetween(form.start_date, form.race_date) : 0;
  const lastStart = addDays(today, 14);
  const F = T.form;
  const err = (k: keyof IntakeForm) => errors[k];

  const back = step === 2
    ? <button type="button" className="back" aria-label="回表單" onClick={() => setStep(1)}><BackIcon /></button>
    : <button type="button" className="back" aria-label="返回" onClick={() => void (cameFromApp ? navigate(-1) : navigate("/"))}><BackIcon /></button>;

  return (
    <>
      <TopBar title={step === 1 ? F.title : T.summary.title} back={back} />
      <main className="intake">
        {step === 1 && init.carried ? <p className="group-note" role="status">{F.carried}</p> : null}
        {step === 2 ? (
          <SummaryStep form={form} today={today} onBack={() => setStep(1)} onDone={show} />
        ) : (
          <>
            <SectionH>比賽</SectionH>
            <div className="intake-field" id="field-name">
              <label className="intake-label" htmlFor="f-name"><span>比賽名稱</span><span className={`intake-count${form.name.length >= MAX_NAME ? " max" : ""}`}>{form.name.length}/{MAX_NAME}</span></label>
              <input id="f-name" className={`oneline${err("name") ? " bad" : ""}`} value={form.name} maxLength={MAX_NAME} placeholder={F.namePlaceholder} autoComplete="off"
                aria-invalid={!!err("name")} aria-describedby={err("name") ? "e-name" : undefined} onChange={(e) => set("name", e.target.value)} />
              {err("name") ? <p className="err" id="e-name" role="alert">{err("name")}</p> : null}
            </div>
            <div className="intake-field" id="field-race_date">
              <label className="intake-label" htmlFor="f-race"><span>比賽日</span></label>
              <input id="f-race" type="date" className={`oneline${err("race_date") ? " bad" : ""}`} value={form.race_date}
                aria-invalid={!!err("race_date")} aria-describedby={err("race_date") ? "e-race" : undefined} onChange={(e) => set("race_date", e.target.value, ["race_date", "start_date"])} />
              {err("race_date") ? <p className="err" id="e-race" role="alert">{err("race_date")}</p> : null}
            </div>
            <div className="intake-field" id="field-otherKm">
              <div className="intake-label" id="l-distance">距離</div>
              <div className={`choice${err("otherKm") ? " bad" : ""}`} role="group" aria-labelledby="l-distance">
                <Chips items={DISTANCES} value={form.distance} onPick={(v) => set("distance", v, ["otherKm", "hasTarget"])} />
              </div>
              {form.distance === "other" ? (
                <div className="time-in">
                  <input className={`oneline${err("otherKm") ? " bad" : ""}`} inputMode="decimal" aria-label="距離（公里）" value={form.otherKm} autoComplete="off"
                    aria-invalid={!!err("otherKm")} aria-describedby={err("otherKm") ? "e-dist" : undefined} onChange={(e) => set("otherKm", e.target.value, ["otherKm", "hasTarget"])} />
                  <span className="u">{F.otherUnit}</span>
                </div>
              ) : null}
              {err("otherKm") ? <p className="err" id="e-dist" role="alert">{err("otherKm")}</p> : null}
            </div>
            <div className="intake-field" id="field-hasTarget">
              <div className="intake-label" id="l-target">目標完賽時間</div>
              <div className={`choice${err("hasTarget") ? " bad" : ""}`} role="group" aria-labelledby="l-target">
                <button type="button" className="chip" aria-pressed={!form.hasTarget} onClick={() => set("hasTarget", false)}>完賽就好</button>
                <button type="button" className="chip" aria-pressed={form.hasTarget} onClick={() => set("hasTarget", true)}>有目標時間</button>
              </div>
              {form.hasTarget ? (
                <div className="time-in" role="group" aria-label="目標時間">
                  <input className={`oneline${err("hasTarget") ? " bad" : ""}`} inputMode="numeric" aria-label="時" value={form.h} onChange={(e) => set("h", e.target.value, ["hasTarget"])} /><span className="u">時</span>
                  <input className={`oneline${err("hasTarget") ? " bad" : ""}`} inputMode="numeric" aria-label="分" value={form.m} onChange={(e) => set("m", e.target.value, ["hasTarget"])} /><span className="u">分</span>
                  <input className={`oneline${err("hasTarget") ? " bad" : ""}`} inputMode="numeric" aria-label="秒" value={form.s} onChange={(e) => set("s", e.target.value, ["hasTarget"])} /><span className="u">秒</span>
                </div>
              ) : null}
              {sec != null && dist != null ? <p className="intake-calc">配速 <b className="num">{pace(targetPace(sec, dist))}</b> /km</p> : null}
              {err("hasTarget") ? <p className="err" role="alert">{err("hasTarget")}</p> : null}
            </div>

            <SectionH>怎麼練</SectionH>
            <div className="intake-field">
              <div className="intake-label" id="l-days">每週可以練幾天</div>
              <div className="choice" role="group" aria-labelledby="l-days">
                <Chips items={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} 天` }))} value={form.days_per_week} onPick={(v) => set("days_per_week", v, ["fixed_rest_weekdays"])} />
              </div>
              <p className="intake-hint">{F.daysHint}</p>
            </div>
            <div className="intake-field" id="field-fixed_rest_weekdays">
              <div className="intake-label" id="l-fixed">固定不能練的日子</div>
              <div className={`choice days${err("fixed_rest_weekdays") ? " bad" : ""}`} role="group" aria-labelledby="l-fixed">
                {WEEKDAYS.map((w) => (
                  <button key={w.value} type="button" className="chip" aria-pressed={form.fixed_rest_weekdays.includes(w.value)} aria-label={w.aria}
                    onClick={() => set("fixed_rest_weekdays", form.fixed_rest_weekdays.includes(w.value) ? form.fixed_rest_weekdays.filter((x) => x !== w.value) : [...form.fixed_rest_weekdays, w.value])}>{w.label}</button>
                ))}
              </div>
              {err("fixed_rest_weekdays") ? <p className="err" role="alert">{err("fixed_rest_weekdays")}</p> : <p className="intake-hint">{F.fixedHint}</p>}
            </div>
            <div className="intake-field">
              <div className="intake-label" id="l-minutes">平日一堂最多</div>
              <div className="choice" role="group" aria-labelledby="l-minutes">
                <Chips items={MINUTES} value={form.weekday_minutes} onPick={(v) => set("weekday_minutes", v)} />
              </div>
              <p className="intake-hint">{F.minutesHint}</p>
            </div>
            <div className="intake-field" id="field-start_date">
              <label className="intake-label" htmlFor="f-start"><span>從哪天開始</span></label>
              <input id="f-start" type="date" className={`oneline${err("start_date") ? " bad" : ""}`} value={form.start_date} min={today} max={lastStart}
                aria-invalid={!!err("start_date")} aria-describedby="e-start" onChange={(e) => set("start_date", e.target.value)} />
              {weeks >= 1 ? <p className="intake-calc">到比賽日共 <b className="num">{weeks}</b> 週（{mdPlain(form.start_date)}〜{mdPlain(form.race_date)}）</p> : null}
              {err("start_date") ? <p className="err" id="e-start" role="alert">{err("start_date")}</p> : <p className="intake-hint" id="e-start">預設下週一；最早今天，最晚 {mdPlain(lastStart)}。</p>}
            </div>

            <SectionH>你的狀況</SectionH>
            <div className="intake-field">
              <div className="intake-label" id="l-exp">這個距離你</div>
              <div className="choice" role="group" aria-labelledby="l-exp">
                <Chips items={EXPERIENCES} value={form.experience} onPick={(v) => set("experience", v)} />
              </div>
            </div>
            <div className="intake-field">
              <label className="intake-label" htmlFor="f-notes"><span>要注意的事、偏好</span><span className={`intake-count${form.notes.length >= MAX_NOTES ? " max" : ""}`}>{form.notes.length}/{MAX_NOTES}</span></label>
              <textarea id="f-notes" value={form.notes} maxLength={MAX_NOTES} placeholder={F.notesPlaceholder} aria-describedby="h-notes" onChange={(e) => set("notes", e.target.value)} />
              <p className="intake-hint" id="h-notes">{F.notesHint}</p>
            </div>

            <div className="actions-row"><button type="button" className="btn compact primary" onClick={next}>{F.next}</button></div>
          </>
        )}
      </main>
    </>
  );
}
