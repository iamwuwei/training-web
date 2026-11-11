import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.groups.$id._index";
import { GroupEventRow } from "../components/group-event-row";
import { GroupEventSheet } from "../components/group-event-sheet";
import { GroupMemberRow } from "../components/group-member-row";
import { GroupBack, GroupNotFound, LoadFailed, TopTitle } from "../components/group-parts";
import { PushLink } from "../components/push-link";
import { ChevronIcon, GearIcon, RefreshIcon } from "../components/icons";
import { GlassButton, NavBar } from "../components/nav-bar";
import { SectionH } from "../components/ui";
import { getGroup } from "../lib/api";
import { todayJst } from "../lib/date";
import { countdown, mdDowPlain } from "../lib/groups";
import { loadGroupData } from "../lib/group-load";
import type { ApiGroupEvent } from "../types/api";
import { pageTitle } from "../lib/meta";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return loadGroupData(() => getGroup(params.id));
}

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("群組", matches);
}

/** 群組詳細頁: the countdown, everyone's numbers (as each one shares them), the latest three events, the ways into the sub pages. */
export default function GroupPage({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const [open, setOpen] = useState<ApiGroupEvent | null>(null);
  if (loaderData.status === "notfound") return <GroupNotFound />;
  if (loaderData.status === "error") {
    return (
      <>
        <NavBar kind="inline" title="群組" left={<GroupBack to="/groups" label="群組清單" ariaLabel="回群組清單" />} />
        <main><LoadFailed text="讀不到群組。" onRetry={() => void revalidator.revalidate()} /></main>
      </>
    );
  }
  const { group: g, members, recent_events: events } = loaderData.data;
  const today = todayJst();
  const cd = countdown(g.race_date, today);
  const loading = revalidator.state === "loading";
  // the newest `unread` events that are not mine are the ones not seen yet: same rule as the api's count
  let fresh = g.unread;
  const isNew = new Map(events.map((e) => [e.id, !e.member.is_me && fresh-- > 0] as const));

  return (
    <>
      <NavBar
        kind="inline"
        title={<TopTitle>{g.name}</TopTitle>}
        left={<GroupBack to="/groups" label="群組清單" ariaLabel="回群組清單" />}
        right={
          <>
            <GlassButton className="refresh" label={loading ? "更新中" : "重新整理"} busy={loading} disabled={loading} onClick={() => void revalidator.revalidate()}><RefreshIcon /></GlassButton>
            <GlassButton to={`/groups/${g.id}/settings`} push label="群組設定"><GearIcon /></GlassButton>
          </>
        }
      />
      <main>
        <div className="hero2 group-hero">
          <div>
            <div className="k">倒數</div>
            <div className="v">{cd.kind === "days" ? <><span className="num big">{cd.n}</span><span className="unit">天</span></> : <span className="num mid">{cd.kind === "today" ? "比賽日" : "已完賽"}</span>}</div>
            <i aria-hidden="true" />
          </div>
          <div>
            <div className="k">比賽 · {mdDowPlain(g.race_date)}</div>
            <div className="v text"><span className="race">{g.race_name}</span></div>
          </div>
        </div>

        <section className="group-members" aria-label="夥伴">{members.map((m) => <GroupMemberRow key={m.id} group={g} member={m} today={today} />)}</section>

        <SectionH action={<PushLink to={`/groups/${g.id}/events`} className="more">{g.unread > 0 ? <span className="ucount" role="img" aria-label={`${g.unread} 則新動態`}>{g.unread}</span> : null}全部動態 ›</PushLink>}>消息中心</SectionH>
        {events.length ? (
          <div className="events">{events.map((e) => <GroupEventRow key={e.id} event={e} today={today} isNew={isNew.get(e.id) ?? false} onOpen={setOpen} />)}</div>
        ) : (
          <p className="group-quiet">還沒有動態。</p>
        )}

        <div style={{ marginTop: 8 }}>
          <PushLink to={`/groups/${g.id}/plans`} className="group-link"><span>看大家的課表</span><span className="r"><ChevronIcon aria-hidden="true" /></span></PushLink>
          <PushLink to={`/groups/${g.id}/members`} className="group-link"><span>成員</span><span className="r">{g.member_count} / {g.max_members}<ChevronIcon aria-hidden="true" /></span></PushLink>
        </div>
        <p className="group-foot"><Link to="/settings/privacy">分享在設定裡決定 ›</Link></p>
      </main>
      <GroupEventSheet groupId={g.id} event={open} onClose={(reload) => { setOpen(null); if (reload) void revalidator.revalidate(); }} />
    </>
  );
}
