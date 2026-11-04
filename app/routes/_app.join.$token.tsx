import { useState } from "react";
import { Link, redirect, useNavigate } from "react-router";
import type { Route } from "./+types/_app.join.$token";
import { TopBar } from "../components/ui";
import { ApiError, getInvite, postInviteAccept } from "../lib/api";
import { hasSession, saveReturnTo } from "../lib/auth";
import { todayJst } from "../lib/date";
import { countdown, LIMIT_TEXT, MAX_MEMBERS, mdDowPlain, SEND_FAILED } from "../lib/groups";
import { parseInviteToken } from "../lib/invite";
import { usePlan } from "../lib/use-plan";
import type { InvitePreviewResponse, InviteState } from "../types/api";

type Preview = { state: InviteState | "not_found"; group: InvitePreviewResponse["group"] };

export async function clientLoader({ params, request }: Route.ClientLoaderArgs): Promise<{ token: string; preview: Preview }> {
  if (!hasSession()) {
    // not logged in: remember this link, log in, and the login brings the person back here
    saveReturnTo(new URL(request.url).pathname);
    throw redirect("/login");
  }
  const token = parseInviteToken(params.token);
  if (!token || token !== params.token) return { token: params.token, preview: { state: "not_found", group: null } };
  try {
    const p = await getInvite(token);
    return { token, preview: { state: p.state, group: p.group } };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    if (e instanceof ApiError && e.status === 404) return { token, preview: { state: "not_found", group: null } };
    throw e;
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "加入群組 · 富士山マラソン 2026" }];
}

const MESSAGES: Record<Exclude<InviteState, "ok"> | "not_found", string> = {
  expired: "這條邀請已過期，請擁有者再發一條",
  revoked: "這條邀請已被撤銷",
  used_up: "這條邀請已經用完了",
  full: `這個群組已經滿了（${MAX_MEMBERS} 人）`,
  already_member: "你已經在這個群組裡了",
  group_limit: LIMIT_TEXT,
  not_found: "找不到這條邀請",
};

/** 加入頁 /join/<token>: who invited you to what, then 加入群組 — or one sentence (and one link) saying why this link can not be used. */
export default function Join({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const plan = usePlan();
  const { token } = loaderData;
  // the answer of the last 409 replaces what the loader said, for this token only
  const [again, setAgain] = useState<{ token: string; preview: Preview } | null>(null);
  const now = again?.token === token ? again.preview : loaderData.preview;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const g = now.group;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await postInviteAccept(token);
      void navigate(`/groups/${res.group.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // the link stopped being usable meanwhile (full, used up, the third group …): ask again what it is now and say that
        try {
          const p = await getInvite(token);
          if (p.state !== "ok") { setAgain({ token, preview: { state: p.state, group: p.group } }); return; }
        } catch { /* fall through to the generic line */ }
      }
      setError(SEND_FAILED);
    } finally {
      setBusy(false);
    }
  }

  if (now.state !== "ok" || !g) {
    const state = now.state === "ok" ? "not_found" : now.state;
    const to = state === "already_member" && g ? { href: `/groups/${g.id}`, text: "去這個群組 ›" } : state === "group_limit" ? { href: "/groups", text: "去群組清單 ›" } : { href: "/", text: "回今天 ›" };
    return (
      <>
        <TopBar title="加入群組" />
        <main>
          <div className="join-msg">
            <p className="t">{MESSAGES[state]}</p>
            <Link to={to.href}>{to.text}</Link>
          </div>
        </main>
      </>
    );
  }

  const cd = countdown(g.race_date, todayJst());
  return (
    <>
      <TopBar title="加入群組" />
      <main>
        <div className="join-card">
          <div className="by">{g.invited_by} 邀你加入</div>
          <h2>{g.name}</h2>
          <div className="race">{g.race_name} · {mdDowPlain(g.race_date)}</div>
          <div className="stats">
            <div><div className="k">倒數</div><div className="v">{cd.kind === "days" ? <><span className="num good">{cd.n}</span><span className="unit">天</span></> : <span className="num">{cd.kind === "today" ? "比賽日" : "已完賽"}</span>}</div></div>
            <div><div className="k">成員</div><div className="v"><span className="num">{g.member_count} / {MAX_MEMBERS}</span><span className="unit">人</span></div></div>
          </div>
          <p className="privacy">加入後，群組裡的人看得到什麼由你在設定裡決定（預設：進度彙總和完成的課）。對話、心得、傷痛不會給別人看。</p>
          {!plan ? <p className="noplan">你還沒有課表，加入後大家看到的是「還沒有課表」。</p> : null}
          {error ? <p className="err" role="alert">{error}</p> : null}
          <div className="actions-row">
            <Link to="/" className="skip grow">不用了</Link>
            <button type="button" className="btn compact primary" disabled={busy} onClick={() => void join()}>{busy ? "加入中…" : "加入群組"}</button>
          </div>
        </div>
      </main>
    </>
  );
}
