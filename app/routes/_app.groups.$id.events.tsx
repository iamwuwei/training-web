import { useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import type { Route } from "./+types/_app.groups.$id.events";
import { GroupEventRow } from "../components/group-event-row";
import { GroupEventSheet } from "../components/group-event-sheet";
import { GroupBack, GroupNotFound, LoadFailed } from "../components/group-parts";
import { RefreshIcon } from "../components/icons";
import { GlassButton, NavBar } from "../components/nav-bar";
import { SectionH } from "../components/ui";
import { getGroupEvents, getGroups, putGroupSeen } from "../lib/api";
import { todayJst } from "../lib/date";
import { isStatus } from "../lib/groups";
import { loadGroupData } from "../lib/group-load";
import type { ApiGroupEvent } from "../types/api";
import { pageTitle } from "../lib/meta";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return loadGroupData(async () => {
    // `unread` is what was not seen when the page opened (the 新 dots); the list of groups carries it, it costs one cheap query
    const [page, groups] = await Promise.all([getGroupEvents(params.id), getGroups().catch(() => null)]);
    return { events: page.events, has_more: page.has_more, unread: groups?.groups.find((g) => g.id === params.id)?.unread ?? 0 };
  });
}

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("消息中心", matches);
}

/**
 * 消息中心: who did what in this group, newest first, last 90 days. Opening it marks everything seen (the list's count and the
 * tab's dot go away); the ones that were new on arrival keep their ink dot until the page is left. Nothing polls: 重新整理 reads again.
 */
export default function GroupEvents({ loaderData, params }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const id = params.id;
  const first = loaderData.status === "ok" ? loaderData.data : null;
  // the count at arrival: after PUT …/seen the loader answers 0, this state keeps what the page opened with
  const [unseen] = useState(first?.unread ?? 0);
  const [more, setMore] = useState<{ events: ApiGroupEvent[]; has_more: boolean | null }>({ events: [], has_more: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [open, setOpen] = useState<ApiGroupEvent | null>(null);
  const marked = useRef(false);

  useEffect(() => {
    if (!first || marked.current) return;
    marked.current = true;
    putGroupSeen(id).then(() => revalidator.revalidate()).catch(() => undefined);
  }, [first, id, revalidator]);

  const events = useMemo(() => {
    const seen = new Set<string>();
    return [...(first?.events ?? []), ...more.events].filter((e) => !seen.has(e.id) && seen.add(e.id));
  }, [first, more.events]);
  const newIds = useMemo(() => new Set(events.filter((e) => !e.member.is_me).slice(0, unseen).map((e) => e.id)), [events, unseen]);

  if (loaderData.status === "notfound") return <GroupNotFound />;
  if (loaderData.status === "error" || !first) {
    return (
      <>
        <NavBar kind="inline" title="消息中心" left={<GroupBack to={`/groups/${id}`} label="群組" ariaLabel="回群組" />} />
        <main><LoadFailed text="讀不到動態。" onRetry={() => void revalidator.revalidate()} /></main>
      </>
    );
  }
  const hasMore = more.has_more ?? first.has_more;
  // reading again starts from the top: older pages loaded earlier may hold events that are gone now
  const reload = () => { setMore({ events: [], has_more: null }); setMoreFailed(false); void revalidator.revalidate(); };
  const today = todayJst();
  const loading = revalidator.state === "loading";

  async function older() {
    const last = events[events.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await getGroupEvents(id, { before: last.id });
      setMore((m) => ({ events: [...m.events, ...page.events], has_more: page.has_more }));
    } catch (e) {
      if (isStatus(e, 404)) void revalidator.revalidate();
      else setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <NavBar
        kind="inline"
        title="消息中心"
        left={<GroupBack to={`/groups/${id}`} label="群組" ariaLabel="回群組" />}
        right={<GlassButton className="refresh" label={loading ? "更新中" : "重新整理"} busy={loading} disabled={loading} onClick={reload}><RefreshIcon /></GlassButton>}
      />
      <main>
        <SectionH>最近 90 天</SectionH>
        {events.length === 0 ? (
          <p className="empty">還沒有動態。<br />有人完成了課、加入或離開，都會出現在這裡。</p>
        ) : (
          <div className="events">{events.map((e) => <GroupEventRow key={e.id} event={e} today={today} isNew={newIds.has(e.id)} onOpen={setOpen} />)}</div>
        )}
        {hasMore ? (
          <button type="button" className="chip events-more" disabled={loadingMore} onClick={() => void older()}>{loadingMore ? "載入中…" : "更早的 ›"}</button>
        ) : events.length ? (
          <p className="events-end">只顯示最近 90 天的動態。</p>
        ) : null}
        {moreFailed ? <p className="events-end" role="alert">讀不到更早的動態，再試一次。</p> : null}
      </main>
      <GroupEventSheet groupId={id} event={open} onClose={(gone) => { setOpen(null); if (gone) reload(); }} />
    </>
  );
}
