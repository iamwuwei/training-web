import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.groups._index";
import { GroupAddSheet } from "../components/group-add-sheet";
import { GroupCreateSheet } from "../components/group-create-sheet";
import { LoadFailed } from "../components/group-parts";
import { ChevronIcon, GroupIcon, PlusIcon } from "../components/icons";
import { SectionH, TopBar } from "../components/ui";
import { getGroups } from "../lib/api";
import { todayJst } from "../lib/date";
import { countdown, limitText } from "../lib/groups";
import { loadGroupData } from "../lib/group-load";
import { usePlan } from "../lib/use-plan";
import type { ApiGroup } from "../types/api";
import { pageTitle } from "../lib/meta";

export async function clientLoader() {
  return loadGroupData(() => getGroups());
}

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("群組", matches);
}

/** One group: name, who owns it, the unread count, the race and head count, the countdown. 72 px, the whole row is the link. */
function GroupRow({ g, today }: { g: ApiGroup; today: string }) {
  const cd = countdown(g.race_date, today);
  return (
    <Link to={`/groups/${g.id}`} className="group-row">
      <div className="txt">
        <div className="l1">
          <span className="nm">{g.name}</span>
          {g.my_role === "owner" ? <span className="role">擁有者</span> : null}
          {g.unread > 0 ? <span className="ucount" role="img" aria-label={`${g.unread} 則新動態`}>{g.unread}</span> : null}
        </div>
        <div className="l2">{g.race_name} · {g.member_count} / {g.max_members} 人</div>
      </div>
      <div className={`cd${cd.kind === "days" ? "" : " text"}`}>
        {cd.kind === "days" ? <><span className="num">{cd.n}</span><span className="unit">天</span></> : cd.kind === "today" ? "比賽日" : "已完賽"}
      </div>
      <ChevronIcon aria-hidden="true" />
    </Link>
  );
}

export default function Groups({ loaderData }: Route.ComponentProps) {
  const plan = usePlan();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const location = useLocation();
  const today = todayJst();
  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [limitNote, setLimitNote] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // 你已經不在「○○」裡了。: handed over by the page that got a 404 on a group that is gone (the only notice there is). Read once, then the history entry is cleaned.
  const [notice] = useState(() => (location.state as { notice?: string } | null)?.notice ?? null);
  useEffect(() => {
    if (notice) void navigate(location.pathname, { replace: true, state: null });
    return () => window.clearTimeout(timer.current);
  }, [notice, navigate, location.pathname]);

  if (loaderData.status !== "ok") {
    const missing = loaderData.status === "notfound" || (loaderData.status === "error" && loaderData.http === 404);
    return (
      <>
        <TopBar title="群組" />
        <main>
          <LoadFailed text={missing ? "這個功能還沒開通。" : "讀不到群組。"} onRetry={() => void revalidator.revalidate()} />
        </main>
      </>
    );
  }

  const { groups, max_groups: max } = loaderData.data;
  const full = groups.length >= max;
  function showLimit() {
    setLimitNote(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLimitNote(false), 4000);
  }
  const defaults = plan ? { race_name: plan.data.plan.race_name, race_date: plan.data.plan.race_date } : null;

  return (
    <>
      <TopBar
        title="群組"
        aside={full
          ? <button type="button" className="icon-btn" aria-disabled="true" aria-label={`新增群組（已經有 ${max} 個群組）`} onClick={showLimit}><PlusIcon /></button>
          : <button type="button" className="icon-btn" aria-label="新增群組：建立或用邀請連結加入" onClick={() => setAddOpen(true)}><PlusIcon /></button>}
      />
      <main>
        {notice ? <p className="group-note" role="status">{notice}</p> : null}
        {limitNote ? <p className="group-note" role="status">{limitText(max)}</p> : null}
        {groups.length === 0 ? (
          <>
            <div className="group-empty">
              <GroupIcon width={44} height={44} strokeWidth={1.6} />
              <div className="t">跟朋友一起備戰同一場比賽</div>
              <p className="sub">建一個群組，邀 1〜4 個朋友。大家各跑各的課表，在這裡看得到彼此的進度、誰完成了課，還有大家願意分享的課表。</p>
              <button type="button" className="btn compact primary" onClick={() => setCreateOpen(true)}>建立群組</button>
              <p className="hint">有邀請連結？點連結就能加入。</p>
            </div>
            <p className="group-privacy">每個人在<Link to="/settings">設定</Link>裡決定給群組看什麼（第一次建立或加入時五項都開著，隨時可以關）。跟 Woo 的對話、心得、Woo 記住的限制與傷痛和 Strava 的原始資料，永遠不會給別人看；課表備註和 Woo 的評論可能提到傷痛或行程。</p>
          </>
        ) : (
          <>
            <SectionH>我的群組 · {groups.length} / {max}</SectionH>
            <div className="group-list">{groups.map((g) => <GroupRow key={g.id} g={g} today={today} />)}</div>
          </>
        )}
      </main>
      <GroupAddSheet open={addOpen} onClose={() => setAddOpen(false)} onCreate={() => { setAddOpen(false); setCreateOpen(true); }} />
      <GroupCreateSheet open={createOpen} onClose={() => setCreateOpen(false)} defaults={defaults} today={today} />
    </>
  );
}
