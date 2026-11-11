import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.groups.$id.settings";
import { GroupConfirm } from "../components/group-confirm";
import { GroupBack, GroupNotFound, LoadFailed } from "../components/group-parts";
import { NavBar } from "../components/nav-bar";
import { deleteGroup, getGroup, postGroupLeave } from "../lib/api";
import { dow } from "../lib/date";
import { isStatus, NOTICE_GONE } from "../lib/groups";
import { loadGroupData } from "../lib/group-load";
import { pageTitle } from "../lib/meta";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return loadGroupData(() => getGroup(params.id));
}

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("群組設定", matches);
}

/**
 * 群組設定: what the group is (read-only) and the way out. A member leaves, the owner disbands (an owner can not leave). Doing it
 * yourself goes straight back to the list with nothing said; a 404 (you were removed, the group is gone) says so once, on the list.
 */
export default function GroupSettings({ loaderData, params }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const id = params.id;
  const [ask, setAsk] = useState<"leave" | "disband" | null>(null);

  if (loaderData.status === "notfound") return <GroupNotFound />;
  if (loaderData.status === "error") {
    return (
      <>
        <NavBar kind="inline" title="群組設定" left={<GroupBack to={`/groups/${id}`} label="群組" ariaLabel="回群組" />} />
        <main><LoadFailed text="讀不到群組。" onRetry={() => void revalidator.revalidate()} /></main>
      </>
    );
  }
  const { group: g, members } = loaderData.data;
  const owner = g.my_role === "owner";
  const ownerMember = members.find((m) => m.role === "owner");

  async function leaveOrDisband() {
    try {
      if (owner) await deleteGroup(id);
      else await postGroupLeave(id);
    } catch (e) {
      if (isStatus(e, 404)) {
        setAsk(null);
        void navigate("/groups", { replace: true, state: { notice: NOTICE_GONE(g.name) } });
        return;
      }
      throw e;
    }
    setAsk(null);
    void navigate("/groups", { replace: true });
  }

  return (
    <>
      <NavBar kind="inline" title="群組設定" left={<GroupBack to={`/groups/${id}`} label="群組" ariaLabel="回群組" />} />
      <main>
        <div className="setting"><span className="k">名稱</span><span className="v">{g.name}</span></div>
        <div className="setting"><span className="k">比賽</span><span className="v">{g.race_name}</span></div>
        <div className="setting"><span className="k">比賽日</span><span className="v">{g.race_date.replace(/-/g, "/")} {dow(g.race_date)}</span></div>
        <div className="setting"><span className="k">擁有者</span><span className="v">{owner ? "你" : ownerMember?.display_name ?? "–"}</span></div>
        <div className="setting"><span className="k">成員</span><span className="v">{g.member_count} / {g.max_members}</span></div>

        {owner ? (
          <>
            <button type="button" className="group-danger" onClick={() => setAsk("disband")}>解散群組</button>
            <p className="group-foot">你是擁有者，不能離開；要走就解散。</p>
          </>
        ) : (
          <>
            <button type="button" className="group-danger" onClick={() => setAsk("leave")}>離開群組</button>
          </>
        )}
      </main>
      <GroupConfirm
        open={ask === "leave"} tone="danger" action="離開群組" busyLabel="離開中…"
        title={`離開「${g.name}」？`}
        text="離開後你看不到大家的任何東西，大家也看不到你的。你在其他群組不受影響。要回來得用新的邀請連結。"
        onCancel={() => setAsk(null)} onConfirm={leaveOrDisband}
      />
      <GroupConfirm
        open={ask === "disband"} tone="danger" action="解散群組" busyLabel="解散中…"
        title={`解散「${g.name}」？`}
        text="所有人都會馬上看不到這個群組，邀請連結全部失效。解散後不能復原。"
        onCancel={() => setAsk(null)} onConfirm={leaveOrDisband}
      />
    </>
  );
}
