import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/_app.activities.$id";
import { BackIcon } from "../components/icons";
import { Avatar, Reminders, TopBar } from "../components/ui";
import { ApiError, getActivities } from "../lib/api";
import { hasSession } from "../lib/auth";
import { mdDow } from "../lib/date";
import { duration, int, km, kmPlan, pace, paceRange } from "../lib/format";
import { labelStyle, verdictKind } from "../lib/labels";
import { activityDate, hrOver, paceFast } from "../lib/plan";
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

function Stat({ v, k, over, unit }: { v: string; k: string; over?: boolean; unit?: string }) {
  return (
    <div>
      <div className={`num${over ? " over" : ""}`}>{v}{unit ? <small> {unit}</small> : null}</div>
      <div className="k">{k}</div>
    </div>
  );
}

function Compare({ current, session, all, sessions }: { current: ApiActivity; session: ApiSession; all: ApiActivity[]; sessions: ApiSession[] }) {
  const kind = labelStyle(session).kind;
  const peers = all
    .map((a) => ({ a, s: sessions.find((x) => x.id === a.session_id) ?? null }))
    .filter(({ a, s }) => s && labelStyle(s).kind === kind && a.avg_pace_sec_km)
    .sort((x, y) => x.a.start_time.localeCompare(y.a.start_time))
    .slice(-5);
  if (peers.length < 2) return null;
  const fastest = Math.min(...peers.map(({ a }) => a.avg_pace_sec_km!));
  return (
    <section className="compare">
      <h2 className="section-h" style={{ margin: 0 }}>同類型比較 · {labelStyle(session).name}</h2>
      <div className="rows">
        {peers.map(({ a, s }) => {
          const cur = a.id === current.id;
          const width = (fastest / a.avg_pace_sec_km!) * 100;
          return (
            <div key={a.id} className={`row${cur ? " cur" : ""}`}>
              <span className="d">{activityDate(a).slice(5).replace("-", "/")}</span>
              <div className="bar"><i style={{ width: `${width}%`, background: cur ? `var(--t-${kind})` : "var(--chip-line)" }} /></div>
              <span className={`num${paceFast(a, s) ? " over" : ""}`}>{pace(a.avg_pace_sec_km)}</span>
              <span className={`num${hrOver(a, s) ? " over" : cur && a.avg_hr != null && s?.target_hr_min != null && a.avg_hr <= (s.target_hr_max ?? Infinity) ? " under" : ""}`}>{int(a.avg_hr)}</span>
            </div>
          );
        })}
      </div>
      <div className="legend"><span>配速</span><span>心拍</span></div>
    </section>
  );
}

function Splits({ splits }: { splits: NonNullable<ApiActivity["splits"]> }) {
  const paces = splits.map((s) => (s.average_speed > 0 ? 1000 / s.average_speed : 0)).filter(Boolean);
  if (!paces.length) return null;
  const fastest = Math.min(...paces);
  return (
    <section className="compare">
      <h2 className="section-h" style={{ margin: 0 }}>每公里</h2>
      <div className="rows">
        {splits.map((s) => {
          const p = s.average_speed > 0 ? 1000 / s.average_speed : null;
          return (
            <div key={s.split} className="row">
              <span className="d">{s.split}</span>
              <div className="bar"><i style={{ width: p ? `${(fastest / p) * 100}%` : 0, background: "var(--ink)" }} /></div>
              <span className="num">{pace(p)}</span>
              <span className="num">{s.average_heartrate != null ? int(s.average_heartrate) : "–"}</span>
            </div>
          );
        })}
      </div>
      <div className="legend"><span>配速</span><span>心拍</span></div>
    </section>
  );
}

export default function Report({ loaderData }: Route.ComponentProps) {
  const view = usePlan();
  const navigate = useNavigate();
  const { activity: a, all } = loaderData;
  const sessions = view?.data.sessions ?? [];
  const s = sessions.find((x) => x.id === a.session_id) ?? null;
  const r = a.review;
  const vk = verdictKind(r?.verdict);
  const memo = r?.comment ?? a.description;
  const target = s ? (s.target ?? paceRange(s.target_pace_min_sec_km, s.target_pace_max_sec_km)) : null;
  const hrK = s?.target_hr_max != null ? `心拍 · 最高 ${int(a.max_hr)}` : "心拍";

  return (
    <>
      <TopBar title="報告" back={<button type="button" className="back" aria-label="返回" onClick={() => (window.history.length > 1 ? void navigate(-1) : void navigate("/history"))}><BackIcon /></button>} />
      <main>
        <article className="post" style={{ paddingTop: 18, paddingBottom: 16 }}>
          <Avatar session={s} />
          <div className="body">
            <div className="meta">
              <b>{mdDow(activityDate(a))}</b>
              <span className="grey">{s ? `· 第 ${s.week_no} 週${s.phase ? ` · ${s.phase}` : ""}` : "· 未排課"}</span>
            </div>
            <p className="title lg" style={{ fontSize: 18, fontWeight: 700 }}>{s?.content ?? `跑步 ${km(a.distance_m)} km`}</p>
            {target && target !== "–" ? <p className="muted">目標 {target}</p> : null}
            {memo ? <p className="text" style={{ marginTop: 12, lineHeight: 1.65 }}>{memo}</p> : null}
          </div>
        </article>

        <section className="statgrid">
          <Stat v={km(a.distance_m)} k={s?.target_distance_m ? `km · 課表 ${kmPlan(s.target_distance_m)}` : "km"} />
          <Stat v={duration(a.moving_time_sec)} k="時間" />
          <Stat v={pace(a.avg_pace_sec_km)} k="配速 /km" over={paceFast(a, s)} />
          <Stat v={int(a.avg_hr)} k={a.max_hr != null ? `心拍 · 最高 ${a.max_hr}` : hrK} over={hrOver(a, s)} />
          {a.avg_watts != null ? <Stat v={int(a.avg_watts)} k="功率 W" /> : null}
          {a.kcal != null ? <Stat v={int(a.kcal)} k="卡路里" /> : null}
        </section>

        {r?.verdict ? (
          <section className={`verdict-block ${vk ?? ""}`}>
            <h2>{r.verdict}</h2>
            {r.reminders.length ? <Reminders items={r.reminders} /> : null}
            <div className="src">{r.source === "claude" ? `自動判定${r.model ? ` · ${r.model}` : ""}` : "手動判定"}</div>
          </section>
        ) : null}

        {a.splits?.length ? <Splits splits={a.splits} /> : null}
        {s ? <Compare current={a} session={s} all={all} sessions={sessions} /> : null}

        {(a.weather || a.gear_name || a.device_name) ? (
          <section className="gear">
            {a.weather ? <>{a.weather}<br /></> : null}
            {[a.gear_name, a.device_name].filter(Boolean).join(" · ")}
          </section>
        ) : null}
      </main>
    </>
  );
}
