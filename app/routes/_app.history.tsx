import { useState } from "react";
import { redirect } from "react-router";
import type { Route } from "./+types/_app.history";
import { ActivityPost } from "../components/posts";
import { TopBar } from "../components/ui";
import { ApiError, getActivities } from "../lib/api";
import { getToken } from "../lib/auth";
import { km } from "../lib/format";
import { FILTERS, labelStyle } from "../lib/labels";
import { usePlan } from "../lib/use-plan";

// Reads /activities (not /plan) so unplanned runs show up too.

export async function clientLoader() {
  if (!getToken()) throw redirect("/login");
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

export default function History({ loaderData }: Route.ComponentProps) {
  const view = usePlan();
  const [filter, setFilter] = useState("all");
  const [onlyReminded, setOnlyReminded] = useState(false);

  const all = loaderData.activities.filter((a) => a.match_status !== "ignored");
  const sessionOf = (id: string | null) => (id && view ? view.data.sessions.find((s) => s.id === id) ?? null : null);
  const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
  const shown = all.filter((a) => {
    const s = sessionOf(a.session_id);
    return f.match(s ? labelStyle(s) : null) && (!onlyReminded || (a.review?.reminders.length ?? 0) > 0);
  });
  const total_m = all.reduce((s, a) => s + a.distance_m, 0);

  return (
    <>
      <TopBar title="紀錄" aside={`${all.length} 次 · ${km(total_m)} km`} />
      <main>
        <div className="chips" role="group" aria-label="篩選">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" className="chip" aria-pressed={filter === x.key} onClick={() => setFilter(x.key)}>
              {x.kind ? <span className={`dot ${x.kind}`} /> : null}{x.name}
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={onlyReminded} onClick={() => setOnlyReminded((v) => !v)}>有提醒</button>
        </div>
        {shown.length ? shown.map((a) => (
          <ActivityPost key={a.id} activity={a} session={sessionOf(a.session_id)} showReminders />
        )) : <p className="empty">{all.length ? "沒有符合的紀錄" : "還沒有紀錄"}</p>}
        {view ? <p className="note">課表從 {view.data.sessions[0]?.scheduled_date.slice(5).replace("-", "/")} 開始</p> : null}
      </main>
    </>
  );
}
