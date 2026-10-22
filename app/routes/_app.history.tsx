import { useState } from "react";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/_app.history";
import { Avatar, TopBar, VerdictTag } from "../components/ui";
import { ApiError, getActivities } from "../lib/api";
import { hasSession } from "../lib/auth";
import { md, mdDow } from "../lib/date";
import { duration, int, km, pace } from "../lib/format";
import { FILTERS, labelStyle, shortName, sportName } from "../lib/labels";
import { activityDate, hrOver, isRunSport, paceFast } from "../lib/plan";
import { usePlan } from "../lib/use-plan";
import type { ApiActivity, ApiSession } from "../types/api";

// Reads /activities (not /plan) so unplanned runs show up too.

export async function clientLoader() {
  if (!hasSession()) throw redirect("/login");
  try {
    return await getActivities();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    throw e;
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "紀錄 · 富士山マラソン 2026" }];
}

/** One activity, two lines, 72px: date · name · verdict; three numbers. Over-target numbers go amber. */
function Row({ a, s }: { a: ApiActivity; s: ApiSession | null }) {
  const run = isRunSport(a.sport_type);
  const name = s ? shortName(s) : `${sportName(a.sport_type)}${a.distance_m > 0 ? ` ${km(a.distance_m)} km` : ""}`;
  return (
    <Link to={`/activities/${a.id}`} className="hrow">
      <Avatar session={s} sport={a.sport_type} />
      <span className="txt">
        <span className="l1"><b>{mdDow(activityDate(a))}</b><span className="name">{name}</span><VerdictTag verdict={a.review?.verdict} /></span>
        <span className="l2">
          {run || a.distance_m > 0 ? <span><b className="num">{km(a.distance_m)}</b> km</span> : <span><b className="num">{duration(a.moving_time_sec)}</b></span>}
          {run && a.avg_pace_sec_km ? <span><b className={`num${paceFast(a, s) ? " over" : ""}`}>{pace(a.avg_pace_sec_km)}</b> /km</span> : null}
          {a.avg_hr != null ? <span><b className={`num${hrOver(a, s) ? " over" : ""}`}>{int(a.avg_hr)}</b> bpm</span> : run ? <span><b className="num">{duration(a.moving_time_sec)}</b></span> : null}
        </span>
      </span>
    </Link>
  );
}

export default function History({ loaderData }: Route.ComponentProps) {
  const view = usePlan();
  const [filter, setFilter] = useState("all");
  const [onlyReminded, setOnlyReminded] = useState(false);

  const all = loaderData.activities.filter((a) => a.match_status !== "ignored");
  const sessionOf = (id: string | null) => (id && view ? view.data.sessions.find((s) => s.id === id) ?? null : null);
  const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
  const shown = all.filter((a) => {
    const s = sessionOf(a.session_id);
    return f.match(s ? labelStyle(s) : null, a.sport_type) && (!onlyReminded || (a.review?.reminders.length ?? 0) > 0);
  });
  const total_m = all.reduce((s, a) => s + a.distance_m, 0);

  // Group by plan week, newest week first; anything outside the plan's weeks goes under 其他.
  const weeks = view?.weeks ?? [];
  const groups: { key: string; title: string; dates: string; items: ApiActivity[] }[] = [];
  for (const a of shown) {
    const d = activityDate(a);
    const w = weeks.find((x) => d >= x.week_start && d <= x.week_end);
    const key = w ? `w${w.week_no}` : "other";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, title: w ? `第 ${w.week_no} 週` : "其他", dates: w ? `${md(w.week_start)}–${md(w.week_end)}` : "", items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }

  return (
    <>
      <TopBar title="紀錄" aside={<><b className="num">{all.length}</b> 次 · <b className="num">{km(total_m)}</b> km</>} />
      <main>
        <div className="chips" role="group" aria-label="篩選">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" className="chip" aria-pressed={filter === x.key} onClick={() => setFilter(x.key)}>
              {x.kind ? <span className={`dot ${x.kind}`} /> : null}{x.name}
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={onlyReminded} onClick={() => setOnlyReminded((v) => !v)}>有提醒</button>
        </div>
        {groups.length ? groups.map((g) => (
          <section key={g.key} className="hgroup">
            <div className="wk"><span>{g.title}{g.dates ? ` · ${g.dates}` : ""}</span><span className="kms">{km(g.items.reduce((n, a) => n + a.distance_m, 0))} km</span></div>
            {g.items.map((a) => <Row key={a.id} a={a} s={sessionOf(a.session_id)} />)}
          </section>
        )) : <p className="empty">{all.length ? "沒有符合的紀錄" : "還沒有紀錄"}</p>}
        {view ? <p className="note">課表從 {md(view.data.sessions[0]?.scheduled_date ?? "")} 開始</p> : null}
      </main>
    </>
  );
}
