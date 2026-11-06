import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRevalidator, useSearchParams, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/_app.groups.$id.plans";
import { GroupBack, GroupNotFound, LoadFailed, RowsSkeleton } from "../components/group-parts";
import { GroupMemberPicker } from "../components/group-member-picker";
import { DayRow, WeekBars } from "../components/plan-week";
import { SessionSheet } from "../components/session-sheet";
import { Bar, TopBar } from "../components/ui";
import { ApiError, getGroup, getMemberPlan } from "../lib/api";
import { md, todayJst } from "../lib/date";
import { km, kmPlan } from "../lib/format";
import { groupIsGone, mdPlain, NOTICE_GONE } from "../lib/groups";
import { loadGroupData } from "../lib/group-load";
import { memberPlanRange, toPlanResponse } from "../lib/member-plan";
import { buildPlanView, weekSubline } from "../lib/plan";
import type { ApiSession, MemberPlanResponse } from "../types/api";
import { pageTitle } from "../lib/meta";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return loadGroupData(() => getGroup(params.id));
}

/** Picking another member only changes `?m=`; the group (the dropdown's list) is not read again, the pane below reads the member. */
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) return false;
  return defaultShouldRevalidate;
}

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("大家的課表", matches);
}

type Pane = { key: string; status: "ok"; data: MemberPlanResponse } | { key: string; status: "missing" } | { key: string; status: "error" };

/** One member's plan, read-only: the plan page's week bars and day rows, drawn from what he shares (his `runs` and `reviews` switches decide the numbers and dots). */
function MemberPlan({ data }: { data: MemberPlanResponse }) {
  const today = todayJst();
  const { member, shared } = data;
  const plan = useMemo(() => toPlanResponse(data), [data]);
  const view = useMemo(() => (plan ? buildPlanView(plan, today) : null), [plan, today]);
  const [picked, setPicked] = useState<number | null>(null);
  const [open, setOpen] = useState<ApiSession | null>(null);

  if (!shared.plan) {
    return (
      <div className="member-plan-off">
        <p className="t">{member.display_name} 沒有分享課表</p>
        <p className="sub">每個人在設定裡決定要不要給群組看課表。</p>
      </div>
    );
  }
  if (!view) {
    return <div className="member-plan-off"><p className="t">{member.display_name} 還沒有課表</p></div>;
  }

  const { weeks, currentWeek } = view;
  const current = currentWeek?.week_no ?? weeks.find((w) => w.isFuture)?.week_no ?? weeks[weeks.length - 1]?.week_no;
  const selected = picked ?? current;
  const idx = weeks.findIndex((w) => w.week_no === selected);
  const week = weeks[idx];
  const go = (i: number) => (i >= 0 && i < weeks.length ? () => setPicked(weeks[i].week_no) : undefined);
  const ro = { runs: shared.runs, reviews: shared.reviews };
  const end = memberPlanRange(data);

  return (
    <>
      <p className="member-plan-head"><b>{member.is_me ? "你的課表" : `${member.display_name} 的課表`}</b>{end ? ` · 課表排到 ${mdPlain(end)}` : ""}</p>
      <WeekBars weeks={weeks} selected={selected} onSelect={setPicked} readonly={ro} />
      {week ? (
        <>
          <div className="week-head2">
            <button type="button" className="step" onClick={go(idx - 1)} disabled={!go(idx - 1)} aria-label="上一週">‹</button>
            <div className="mid">
              <div className="line">
                <span className="title">第 {week.week_no} 週 {week.isCurrent ? <span className="pill">本週</span> : current != null && current !== week.week_no ? <button type="button" className="back-today" onClick={() => setPicked(current)}>回本週</button> : null}</span>
                <span className="kms">
                  {!ro.runs || week.isFuture ? <><b className="num plan">{kmPlan(week.plan_m)}</b><span className="of"> km</span></> : <><b className={`num${week.isComplete ? " done" : ""}`}>{km(week.actual_m)}</b><span className="of"> / {kmPlan(week.plan_m)} km</span></>}
                </span>
              </div>
              <div className="sub">{md(week.week_start)}–{md(week.week_end)} · {ro.runs ? weekSubline(week, view) : week.focus ?? ""}</div>
            </div>
            <button type="button" className="step" onClick={go(idx + 1)} disabled={!go(idx + 1)} aria-label="下一週">›</button>
          </div>
          {ro.runs && !week.isFuture ? <Bar value={week.actual_m} max={week.plan_m} tone={week.isComplete ? "good" : "ink"} /> : null}
          <div className="dayrows">
            {week.days.map((d) => <DayRow key={d.session.id} day={d} view={view} weekNo={week.week_no} isToday={d.session.scheduled_date === today} onOpen={setOpen} routine={null} readonly={ro} />)}
          </div>
        </>
      ) : null}
      {member.is_me ? <p className="member-plan-note">這裡只能看。要改課表或看報告，到<Link to="/plan">課表</Link>。</p> : null}
      <SessionSheet session={open} view={view} onClose={() => setOpen(null)} onOpen={setOpen} readOnly={{ name: member.display_name, ...ro }} />
    </>
  );
}

export default function GroupPlans({ loaderData, params }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [attempt, setAttempt] = useState(0);
  const [pane, setPane] = useState<Pane | null>(null);
  const id = params.id;
  const group = loaderData.status === "ok" ? loaderData.data : null;
  const groupName = group?.group.name ?? "";
  const selfId = group?.members.find((m) => m.is_me)?.id ?? null;
  const mid = search.get("m") ?? selfId;
  const key = `${id}:${mid}:${attempt}`;

  useEffect(() => {
    if (!mid) return;
    let live = true;
    getMemberPlan(id, mid)
      .then((data) => { if (live) setPane({ key, status: "ok", data }); })
      .catch(async (e: unknown) => {
        // 400: not even an id. 404: no such member in this group — or no such group any more (I was removed while the page was open): ask which
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 404 && (await groupIsGone(id))) { if (live) void navigate("/groups", { replace: true, state: { notice: NOTICE_GONE(groupName) } }); return; }
        if (live) setPane(status === 400 || status === 404 ? { key, status: "missing" } : { key, status: "error" });
      });
    return () => { live = false; };
  }, [id, mid, key, groupName, navigate]);

  if (loaderData.status === "notfound") return <GroupNotFound />;
  if (!group) {
    return (
      <>
        <TopBar title="大家的課表" back={<GroupBack to={`/groups/${id}`} label="回群組" />} />
        <main><LoadFailed text="讀不到群組。" onRetry={() => void revalidator.revalidate()} /></main>
      </>
    );
  }
  const cur = pane && pane.key === key ? pane : null;
  const listed = group.members.some((m) => m.id === mid);

  return (
    <>
      <TopBar title="大家的課表" back={<GroupBack to={`/groups/${id}`} label="回群組" />} />
      <main>
        <div className="member-pick-row">
          <GroupMemberPicker members={group.members} selectedId={listed ? mid : null} onSelect={(m) => setSearch({ m }, { replace: true })} />
        </div>
        {!cur ? (
          <div style={{ marginTop: 16 }}><RowsSkeleton rows={4} height={56} /></div>
        ) : cur.status === "missing" ? (
          <div className="member-plan-off">
            <p className="t">找不到這位成員</p>
            <p className="sub">可能已經離開這個群組。</p>
            <Link to={`/groups/${id}/plans`}>看自己的課表 ›</Link>
          </div>
        ) : cur.status === "error" ? (
          <LoadFailed text="讀不到課表。" onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <MemberPlan key={cur.data.member.id} data={cur.data} />
        )}
      </main>
    </>
  );
}
