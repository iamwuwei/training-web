import { useState } from "react";
import { Link, redirect, useLocation, useNavigate, useRevalidator } from "react-router";
import { useReviewPolling } from "../lib/use-review-polling";
import type { Route } from "./+types/_app.activities.$id";
import { BackIcon } from "../components/icons";
import { GearInfo } from "../components/gear-info";
import { MemoEditor } from "../components/memo";
import { SessionSheet } from "../components/session-sheet";
import { BottomSheet } from "../components/sheet";
import { Avatar, CoachAvatar, Reminders, TopBar, verdictBadge } from "../components/ui";
import { ApiError, getActivities, putSession, rereview } from "../lib/api";
import { hasSession } from "../lib/auth";
import { dayDiff, md, mdDow, timeJst } from "../lib/date";
import { duration, int, km, kmPlan, pace } from "../lib/format";
import { labelStyle, shortName, sportName, verdictKind } from "../lib/labels";
import { activityDate, hrOver, isRunSport, paceFast, type PlanView } from "../lib/plan";
import { focusLabel, focusStats, fullSplits, planFor, sessionBand, splitPace, type Band, type SessionPlan } from "../lib/segments";
import { kindSeries } from "../lib/trend";
import type { ApiActivity, ApiSession } from "../types/api";
import { usePlan } from "../lib/use-plan";

// The activity usually comes from the already-loaded plan; fall back to
// /activities for unplanned runs (which /plan does not return).

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  if (!hasSession()) throw redirect("/login");
  try {
    const { activities } = await getActivities();
    const activity = activities.find((a) => a.id === params.id);
    if (!activity) throw new Response("找不到這筆紀錄", { status: 404 });
    return { activity, all: activities };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    throw e;
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "報告 · 富士山マラソン 2026" }];
}

const pos = (v: number, lo: number, hi: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

/** Target band on a track, actual value as a dot; the dot turns red outside the band. */
function RangeRow({ label, value, text, band, fmt, note }: {
  label: string; value: number; text: string; band: Band; fmt: (n: number) => string; note?: string;
}) {
  const pad = Math.max(10, (band.hi - band.lo) * 0.8);
  const lo = Math.min(band.lo, value) - pad, hi = Math.max(band.hi, value) + pad;
  const ok = value >= band.lo && value <= band.hi;
  const l = pos(band.lo, lo, hi), r = pos(band.hi, lo, hi);
  return (
    <div className="range">
      <span className="k">{label}</span>
      <div className="track" role="img" aria-label={`${label} ${text}，目標 ${fmt(band.lo)}–${fmt(band.hi)}，${ok ? "在目標內" : "超出目標"}`}>
        <i className="rail" />
        <i className="band" style={{ left: `${l}%`, width: `${r - l}%` }} />
        <i className={`dot${ok ? "" : " out"}`} style={{ left: `${pos(value, lo, hi)}%` }} />
        <span className="tick" style={{ left: `${l}%` }}>{fmt(band.lo)}</span>
        <span className="tick" style={{ left: `${r}%` }}>{fmt(band.hi)}</span>
      </div>
      <span className={`v${ok ? "" : " out"}`}><b className="num">{text}</b> {ok ? <span className="ok">✓</span> : <span className="bad">!</span>}</span>
      {note ? <p className="note-line">{note}</p> : null}
    </div>
  );
}

/** `approx`: reps-and-seconds sessions (hills, intervals, strides) only estimate a distance, so no pass/fail colour. */
function DistRow({ actual, plan, approx }: { actual: number; plan: number; approx?: boolean }) {
  const ok = !approx && actual >= plan * 0.9;
  return (
    <div className="range">
      <span className="k">距離</span>
      <div className="bar"><i style={{ width: `${Math.min(100, (actual / plan) * 100)}%`, background: ok ? "var(--v-good)" : "var(--ink-3)" }} /></div>
      <span className="v"><b className="num">{km(actual)}</b> <span className="of">/ {approx ? "約 " : ""}{kmPlan(plan)} km</span></span>
    </div>
  );
}

/** Hill repeats, intervals and strides are written in reps and seconds; their planned distance is an estimate. */
const approxDistance = (s: ApiSession) => s.type === "interval" || /×|秒/.test(s.content ?? "");

/** "Target vs actual": pace and HR against the session's ranges, plus distance. */
function TargetVsActual({ a, s, plan }: { a: ApiActivity; s: ApiSession; plan: SessionPlan }) {
  const rows = [];
  const hrBand = s.target_hr_min != null || s.target_hr_max != null
    ? { lo: s.target_hr_min ?? (s.target_hr_max as number) - 20, hi: s.target_hr_max ?? (s.target_hr_min as number) + 10 }
    : null;
  if (plan.single) {
    const band = sessionBand(s);
    if (band && a.avg_pace_sec_km) rows.push(<RangeRow key="p" label="配速" value={a.avg_pace_sec_km} text={pace(a.avg_pace_sec_km)} band={band} fmt={pace} />);
    if (hrBand && a.avg_hr != null) rows.push(<RangeRow key="h" label="心拍" value={a.avg_hr} text={String(a.avg_hr)} band={hrBand} fmt={String} />);
  } else {
    const f = focusStats(plan, a.splits);
    const band = f && plan.kms?.[f.from - 1]?.band;
    const range = f ? (f.from === f.to ? `第 ${f.from} km` : `第 ${f.from}〜${f.to} km`) : "";
    if (f && band) rows.push(<RangeRow key="p" label={focusLabel(s)} value={f.pace} text={pace(f.pace)} band={band} fmt={pace} note={`${range}平均`} />);
    if (f && hrBand && f.hrTop != null) rows.push(<RangeRow key="h" label="心拍" value={f.hrTop} text={String(f.hrTop)} band={hrBand} fmt={String} note={`${range}裡心拍最高的一公里`} />);
  }
  if (s.target_distance_m && isRunSport(a.sport_type)) rows.push(<DistRow key="d" actual={a.distance_m} plan={s.target_distance_m} approx={approxDistance(s)} />);
  if (!rows.length) return null;
  return (
    <section className="targets">
      <h2 className="section-h" style={{ margin: 0 }}>目標 vs 實際</h2>
      {rows}
    </section>
  );
}

/** One dot per km on a pace axis; the target band is drawn on the km it applies to. */
function SplitDots({ a, s, plan }: { a: ApiActivity; s: ApiSession | null; plan: SessionPlan | null }) {
  const sps = fullSplits(a.splits);
  if (!sps.length) return null;
  const paces = sps.map(splitPace);
  const bands = (plan?.kms ?? []).map((k) => k.band).filter((b): b is Band => !!b);
  const lo = Math.min(...paces, ...bands.map((b) => b.lo)) - 10;
  const hi = Math.max(...paces, ...bands.map((b) => b.hi)) + 10;
  const hrCap = s?.target_hr_max ?? null;
  const banded = plan?.kms?.some((k) => k.band);
  return (
    <section className="dots">
      <h2 className="section-h" style={{ margin: 0 }}>每公里</h2>
      {sps.map((sp) => {
        const p = splitPace(sp);
        const t = plan?.kms?.[sp.split - 1];
        const band = t?.band ?? null;
        const out = band ? p < band.lo || p > band.hi : false;
        const hr = sp.average_heartrate != null ? Math.round(sp.average_heartrate) : null;
        return (
          <div key={sp.split} className="row">
            <span className="d">{sp.split}</span>
            <div className="lane">
              <i className="rail" />
              {band ? <i className="band" style={{ left: `${pos(band.lo, lo, hi)}%`, width: `${pos(band.hi, lo, hi) - pos(band.lo, lo, hi)}%` }} /> : null}
              <i className={`dot${out ? " out" : ""}`} style={{ left: `${pos(p, lo, hi)}%` }} />
            </div>
            <span className={`num${out ? " over" : ""}`}>{pace(p)}</span>
            <span className={`num${hr != null && hrCap != null && t?.focus && hr > hrCap ? " over" : ""}`}>{hr ?? "–"}</span>
          </div>
        );
      })}
      <div className="legend">
        <span>{banded ? (plan?.single ? "綠帶 = 目標配速" : "綠帶 = 該段的目標配速") : s ? "這堂課的分段讀不出來，只畫實際配速" : ""}</span>
        <span>配速 · 心拍</span>
      </div>
    </section>
  );
}

/**
 * The same kind of session over its last six runs, as a line: for Easy / Recovery
 * the pace while the heart rate sat in the target band (fitness, not effort);
 * for MP and the rest the focus-block pace. Faster is higher. Series in lib/trend.ts.
 */
function Trend({ current, session, all, sessions }: { current: ApiActivity; session: ApiSession; all: ApiActivity[]; sessions: ApiSession[] }) {
  const kind = labelStyle(session);
  const { points: series, aerobic, lo, hi } = kindSeries(session, all, sessions);
  const points = series.slice(-6);
  const title = aerobic ? `${kind.name} 的有氧效率` : `${kind.name} 的配速趨勢`;
  const sub = aerobic ? `心拍 ${lo}〜${hi} 時的配速` : planFor(session).single ? "整趟平均" : `${focusLabel(session)}平均`;
  if (points.length < 2) {
    return (
      <section className="trend">
        <div className="head"><h2 className="section-h" style={{ margin: 0 }}>{title}</h2><span className="sub">{sub}</span></div>
        <p className="empty-line">{points.length ? `這是第一次 ${kind.name} 課，下一次之後就會出現趨勢。` : aerobic ? `還沒有心拍落在 ${lo}〜${hi} 的紀錄。` : "還沒有可以比較的紀錄。"}</p>
      </section>
    );
  }
  const W = 220, H = 56, PAD = 8;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs), max = Math.max(...vs), span = Math.max(20, max - min);
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + ((v - min) / span) * (H - PAD * 2); // slower (bigger) sits lower
  const curIdx = points.findIndex((p) => p.a.id === current.id);
  const ref = points[0], cur = points[curIdx >= 0 ? curIdx : points.length - 1];
  const delta = cur.v - ref.v;
  const weeks = Math.max(1, Math.round((Date.parse(cur.a.start_time) - Date.parse(ref.a.start_time)) / (7 * 86_400_000)));
  return (
    <section className="trend">
      <div className="head"><h2 className="section-h" style={{ margin: 0 }}>{title}</h2><span className="sub">{sub}</span></div>
      <div className="body">
        <div className="chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${points.map((p) => `${activityDate(p.a).slice(5)} ${pace(p.v)}`).join("，")}`}>
            <polyline points={points.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => <circle key={p.a.id} cx={x(i)} cy={y(p.v)} r="3.5" fill={p.a.id === cur.a.id ? "var(--accent)" : "var(--bg)"} stroke={p.a.id === cur.a.id ? "var(--accent)" : "currentColor"} strokeWidth="2" />)}
          </svg>
          <div className="dates"><span>{activityDate(ref.a).slice(5).replace("-", "/")}</span><span>{activityDate(cur.a).slice(5).replace("-", "/")}</span></div>
        </div>
        <div className="delta">
          <div className={`num${delta < 0 ? " good" : delta > 0 ? " slow" : ""}`}>{delta === 0 ? "持平" : <>{delta < 0 ? "−" : "+"}{Math.abs(delta)}<span>秒</span></>}</div>
          <div className="sub">{delta === 0 ? `跟 ${weeks} 週前一樣` : `每公里，比 ${weeks} 週前${delta < 0 ? "快" : "慢"}`}</div>
        </div>
      </div>
    </section>
  );
}

/** 換一個活動: the other Strava activities within a day of the session; picking one takes the session over. */
function SwapSheet({ open, onClose, a, s, all, view }: { open: boolean; onClose: () => void; a: ApiActivity; s: ApiSession; all: ApiActivity[]; view: PlanView | null }) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = new Set<string>();
  const others = [...all, ...(view?.unassigned ?? [])]
    .filter((x) => x.id !== a.id && x.match_status !== "ignored" && !seen.has(x.id) && seen.add(x.id) && Math.abs(dayDiff(s.scheduled_date, activityDate(x))) <= 1)
    .sort((x, y) => y.start_time.localeCompare(x.start_time));
  async function swap(x: ApiActivity) {
    setBusy(x.id);
    setError(null);
    try {
      await putSession(x.id, { session_id: s.id, replace: true });
      await revalidator.revalidate();
      onClose();
      void navigate(`/activities/${x.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 503 ? "資料庫還在啟動，幾秒後再按一次" : e.message) : "送出失敗，再試一次");
    } finally {
      setBusy(null);
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} label="換一個活動">
      <h2 className="sheet-title">{md(s.scheduled_date)} 的 {shortName(s)} 是哪一個活動？</h2>
      {others.length ? others.map((x) => {
        const run = isRunSport(x.sport_type);
        return (
          <button key={x.id} type="button" className="swap-row" onClick={() => void swap(x)} disabled={busy != null}>
            <Avatar session={null} sport={x.sport_type} />
            <span className="txt">
              <span className="l1"><i className="strava-dot" />{sportName(x.sport_type)}<span className="when">{activityDate(x) === s.scheduled_date ? timeJst(x.start_time) : `${md(activityDate(x))} ${timeJst(x.start_time)}`}</span></span>
              <span className="l2">
                {run || x.distance_m > 0 ? <span><b className="num">{km(x.distance_m)}</b> km</span> : <span><b className="num">{duration(x.moving_time_sec)}</b></span>}
                {run && x.avg_pace_sec_km ? <span><b className="num">{pace(x.avg_pace_sec_km)}</b> /km</span> : null}
                {x.avg_hr != null ? <span><b className="num">{int(x.avg_hr)}</b> bpm</span> : null}
              </span>
            </span>
            <span className="chip">{busy === x.id ? "換成這趟…" : "換成這趟"}</span>
          </button>
        );
      }) : <p className="empty">前後一天沒有別的活動。Strava 可能還沒同步。</p>}
      {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
      <p className="sheet-foot">換了之後 Woo 會重新看這堂課。</p>
    </BottomSheet>
  );
}

export default function Report({ loaderData }: Route.ComponentProps) {
  const view = usePlan();
  const navigate = useNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();
  const { all } = loaderData;
  // ← goes back to where the report was opened from; opened directly (the router's initial
  // entry, key "default") there is no source page, so 課表. Any other key means the app
  // itself pushed this entry, so there is always something to go back to.
  const cameFromApp = location.key !== "default";
  // A memo save shows immediately through `override`; once a revalidation brings the
  // same memo_updated_at back from the server, the loader's copy (with the new review) wins.
  const [override, setOverride] = useState<ApiActivity | null>(null);
  const L = loaderData.activity;
  const a = override && override.id === L.id && override.memo_updated_at !== L.memo_updated_at ? override : L;

  const sessions = view?.data.sessions ?? [];
  const s = sessions.find((x) => x.id === a.session_id) ?? null;
  const plan = s ? planFor(s) : null;
  const r = a.review;
  const vk = verdictKind(r?.verdict);
  // No review yet with a session assigned, or a Claude review older than the memo = being written.
  const waitingReview = !!(a.session_id && !r?.failed && (!r || (r.source === "claude" && a.memo_updated_at != null && r.created_at < a.memo_updated_at)));
  // Woo is waiting on an answer in the thread (how it felt, or whether this is really the
  // run): nothing to poll for until the athlete replies there, and no "took too long". With
  // only a check-in open (the api leaves the day's check-in open after a report-page pick)
  // the verdict is still on its way, so keep polling.
  const askKind = view?.data.coach_ask_kind ?? null;
  const askOpen = !r && askKind != null;
  const checkinOpen = !r && !!view?.data.coach_checkin_open;
  const { timedOut, restart } = useReviewPolling(waitingReview && !askOpen);
  const [rereviewBusy, setRereviewBusy] = useState(false);
  const [rereviewError, setRereviewError] = useState<string | null>(null);
  async function askAgain() {
    setRereviewBusy(true);
    setRereviewError(null);
    try {
      await rereview(a.id);
      setOverride(null);
      await revalidator.revalidate();
      restart();
    } catch (e) {
      setRereviewError(e instanceof ApiError ? e.message : "送出失敗，再試一次");
    } finally {
      setRereviewBusy(false);
    }
  }
  const [showPlan, setShowPlan] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const retryChip = (
    <button type="button" className="chip" onClick={() => void askAgain()} disabled={rereviewBusy}>
      {rereviewBusy ? "送出中…" : "重新分析"}
    </button>
  );

  const date = mdDow(activityDate(a));
  const meta = s ? [date, s.week_no != null ? `第 ${s.week_no} 週` : null, s.phase].filter(Boolean).join(" · ") : `${date} · 未排課`;
  const run = isRunSport(a.sport_type);

  return (
    <>
      <TopBar title="報告" back={<button type="button" className="back" aria-label="返回" onClick={() => (cameFromApp ? void navigate(-1) : void navigate("/plan"))}><BackIcon /></button>} />
      <main>
        <article className="post report-head">
          <Avatar session={s} sport={a.sport_type} />
          <div className="body">
            <p className="name">{s ? shortName(s) : `${sportName(a.sport_type)} ${a.distance_m > 0 ? `${km(a.distance_m)} km` : duration(a.moving_time_sec)}`}</p>
            <p className="meta-line">{meta}</p>
          </div>
        </article>
        {s ? (
          <button type="button" className="plan-row" onClick={() => setShowPlan(true)}>
            <span>課表內容{s.content ? <span className="grey"> · {s.content.length > 22 ? `${s.content.slice(0, 22)}…` : s.content}</span> : null}</span>
            <span className="open">打開 ›</span>
          </button>
        ) : null}

        <div className="report-top">
          {run || a.distance_m > 0 ? <span><b className="num">{km(a.distance_m)}</b> km</span> : <span><b className="num">{duration(a.moving_time_sec)}</b></span>}
          {run && a.avg_pace_sec_km ? <span><b className={`num${paceFast(a, s) ? " over" : ""}`}>{pace(a.avg_pace_sec_km)}</b> /km</span> : null}
          {a.avg_hr != null ? <span><b className={`num${hrOver(a, s) ? " over" : ""}`}>{int(a.avg_hr)}</b> bpm</span> : null}
        </div>

        {r?.verdict ? (
          <section className={`verdict-block ${vk ?? ""}`}>
            <h2>{r.verdict}</h2>
            {r.comment ? <p className="comment">{r.comment}</p> : null}
            {r.reminders[0] ? <div className="next-band"><b>下次：</b>{r.reminders[0]}</div> : null}
            {r.reminders.length > 1 ? <Reminders items={r.reminders.slice(1)} /> : null}
            <div className="src">
              <span className="who">{r.source === "claude" ? <><CoachAvatar size={20} badge={verdictBadge(r.verdict)} />Woo · {mdDow(r.created_at.slice(0, 10)).split(" ")[0]} {timeJst(r.created_at)}</> : "教練判定 · 手動"}{waitingReview ? " · 正在依你的心得重新評…" : ""}</span>
              {!waitingReview ? <span className="acts"><Link to={`/coach?quote=${a.id}`} className="chip">問教練</Link>{r.source === "claude" ? retryChip : null}</span> : null}
            </div>
            {rereviewError ? <p className="hint" style={{ color: "var(--v-bad)" }}>{rereviewError}</p> : null}
          </section>
        ) : r?.failed ? (
          <section className="verdict-block bad">
            <h2>分析失敗</h2>
            <p className="comment" style={{ color: "var(--ink-2)" }}>這次分析沒成功，再試一次。數據和心得都已經存好。</p>
            <div className="src"><span className="who"><CoachAvatar size={20} />Woo</span><span className="acts"><Link to={`/coach?quote=${a.id}`} className="chip">問教練</Link>{retryChip}</span></div>
            {rereviewError ? <p className="hint" style={{ color: "var(--v-bad)" }}>{rereviewError}</p> : null}
          </section>
        ) : waitingReview ? (
          <section className="verdict-block">
            {askOpen ? (
              <div className="src"><span className="pending">{askKind === "mismatch" ? "Woo 在問這趟是不是" : "Woo 在等你回感受"}</span><Link to="/coach" className="chip">去回他 ›</Link></div>
            ) : timedOut ? (
              <>
                <h2 className="pending-h">分析比較久</h2>
                <p className="comment" style={{ color: "var(--ink-2)" }}>已經等了 3 分鐘還沒有結果。可能是資料庫剛喚醒或教練那邊塞車，稍後再回來看，或直接重新分析。</p>
                <div className="src"><span className="who"><CoachAvatar size={20} />Woo</span>{retryChip}</div>
                {rereviewError ? <p className="hint" style={{ color: "var(--v-bad)" }}>{rereviewError}</p> : null}
              </>
            ) : checkinOpen ? (
              <div className="src"><span className="pending">Woo 在等你回</span><Link to="/coach" className="chip">去回他 ›</Link></div>
            ) : (
              <div className="src"><span className="pending">Woo 分析中，通常 10 秒到 1 分鐘</span></div>
            )}
          </section>
        ) : null}

        {s && plan ? <TargetVsActual a={a} s={s} plan={plan} /> : (
          <section className="targets">
            <div className="stats">
              {run || a.distance_m > 0 ? <span><b className="num">{km(a.distance_m)}</b> km</span> : null}
              {run ? <span><b className="num">{pace(a.avg_pace_sec_km)}</b> /km</span> : null}
              {a.avg_hr != null ? <span><b className="num">{int(a.avg_hr)}</b> bpm</span> : null}
            </div>
          </section>
        )}

        <MemoEditor key={a.id} activity={a} onSaved={setOverride} />
        {!a.memo && a.description ? <p className="text" style={{ margin: "10px 0 0", color: "var(--ink-2)" }}>Strava 描述：{a.description}</p> : null}

        <SplitDots a={a} s={s} plan={plan} />
        {s ? <Trend current={a} session={s} all={all} sessions={sessions} /> : null}

        <GearInfo activity={a} />

        {s ? (
          <p className="swap-line">
            <span className="act"><i className="strava-dot" />活動：{sportName(a.sport_type)} {timeJst(a.start_time)}{a.distance_m > 0 ? ` · ${km(a.distance_m)} km` : ""}</span>
            <button type="button" className="link" onClick={() => setShowSwap(true)}>換一個活動 ›</button>
          </p>
        ) : null}
      </main>
      {view && s ? <SessionSheet session={showPlan ? s : null} view={view} onClose={() => setShowPlan(false)} /> : null}
      {s ? <SwapSheet open={showSwap} onClose={() => setShowSwap(false)} a={a} s={s} all={all} view={view} /> : null}
    </>
  );
}
