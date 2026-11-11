import { useEffect, useRef, useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.groups.$id.members";
import { GroupConfirm } from "../components/group-confirm";
import { GroupInviteSheet } from "../components/group-invite";
import { GroupBack, GroupNotFound, LoadFailed } from "../components/group-parts";
import { ShareIcon } from "../components/icons";
import { GlassButton, NavBar } from "../components/nav-bar";
import { getGroup, postGroupMemberRemove } from "../lib/api";
import { groupIsGone, isStatus, NOTICE_GONE } from "../lib/groups";
import { loadGroupData } from "../lib/group-load";
import type { ApiGroupMember } from "../types/api";
import { pageTitle } from "../lib/meta";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return loadGroupData(() => getGroup(params.id));
}

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("成員", matches);
}

/**
 * 成員: the list of who is in the group (nothing about their progress or plans — that is the dashboard's). The owner sees 移除 on
 * every other row and, in the title bar, 邀請夥伴 (the share icon → the invite sheet). Leaving and disbanding live in 群組設定.
 */
export default function GroupMembers({ loaderData, params }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const id = params.id;
  const [removing, setRemoving] = useState<ApiGroupMember | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [fullNote, setFullNote] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (loaderData.status === "notfound") return <GroupNotFound />;
  if (loaderData.status === "error") {
    return (
      <>
        <NavBar kind="inline" title="成員" left={<GroupBack to={`/groups/${id}`} label="群組" ariaLabel="回群組" />} />
        <main><LoadFailed text="讀不到群組。" onRetry={() => void revalidator.revalidate()} /></main>
      </>
    );
  }
  const { group: g, members, invite } = loaderData.data;
  const owner = g.my_role === "owner";
  const full = g.member_count >= g.max_members;

  function showFull() {
    setFullNote(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFullNote(false), 4000);
  }

  async function remove() {
    if (!removing) return;
    try {
      await postGroupMemberRemove(id, removing.id);
    } catch (e) {
      if (isStatus(e, 404)) {
        // the member is already gone (the list is stale) or the group is: ask the group which
        if (await groupIsGone(id)) { void navigate("/groups", { replace: true, state: { notice: NOTICE_GONE(g.name) } }); return; }
        setRemoving(null);
        void revalidator.revalidate();
        return;
      }
      throw e;
    }
    setRemoving(null);
    void revalidator.revalidate();
  }

  return (
    <>
      <NavBar
        kind="inline"
        title="成員"
        left={<GroupBack to={`/groups/${id}`} label="群組" ariaLabel="回群組" />}
        right={owner
          ? full
            ? <GlassButton ariaDisabled label={`邀請夥伴（已滿 ${g.max_members} 人）`} onClick={showFull}><ShareIcon /></GlassButton>
            : <GlassButton label="邀請夥伴" onClick={() => setInviteOpen(true)}><ShareIcon /></GlassButton>
          : undefined}
      />
      <main>
        {fullNote ? <p className="group-note" role="status">已滿 {g.max_members} 人。有人離開或被移除，才能再邀請。</p> : null}
        <div className="member-admin">
          {members.map((m) => (
            <div className="member-admin-row" key={m.id}>
              <div className="avatar member" aria-hidden="true">{m.display_name.slice(0, 1)}</div>
              <div className="txt">
                <div className="l1">
                  <span className="name">{m.display_name}</span>
                  {m.is_me ? <span className="pill">你</span> : null}
                  {m.role === "owner" ? <span className="role">擁有者</span> : null}
                </div>
              </div>
              {owner && !m.is_me ? <button type="button" className="rm" aria-label={`移除 ${m.display_name}`} onClick={() => setRemoving(m)}>移除</button> : null}
            </div>
          ))}
        </div>
      </main>
      <GroupConfirm
        open={!!removing} tone="danger" action="移除" busyLabel="移除中…"
        title={`把 ${removing?.display_name ?? ""} 移出群組？`}
        text={`${removing?.display_name ?? ""} 會馬上看不到這個群組，大家也看不到 ${removing?.display_name ?? ""} 的任何東西。要回來得用新的邀請連結。`}
        onCancel={() => setRemoving(null)} onConfirm={remove}
      />
      <GroupInviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} groupId={id} invite={invite} onChanged={() => void revalidator.revalidate()} />
    </>
  );
}
