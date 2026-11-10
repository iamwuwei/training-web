import { useLayoutEffect, useRef } from "react";
import { Outlet, redirect, useLocation, useMatches, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/_app";
import { EdgeBack } from "../components/edge-back";
import { NavBar } from "../components/nav-bar";
import { TabBar } from "../components/ui";
import { ApiError, getGroups, getPlan } from "../lib/api";
import { clearMotion, enterModal } from "../lib/motion";
import { useNavDirClear } from "../lib/nav";
import { usePageFocus } from "../lib/use-page-focus";
import { ensureWeekly } from "../lib/use-weekly";
import { AuthError, completeLogin, getUser, hasSession, logout, saveReturnTo, takeReturnTo, type SessionUser } from "../lib/auth";
import type { PlanResponse } from "../types/api";

// Layout for the four tabs. Finishes the Cognito callback (?code=&state= on "/"),
// then loads the plan once; children read it through usePlan() (app/lib/use-plan.tsx).

/**
 * Coming into the group list reads /plan again: leaving or disbanding a group (or having seen its 消息中心 elsewhere) changes the
 * count behind the 群組 tab's dot, and the layout would otherwise keep what it loaded first.
 */
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (nextUrl.pathname === "/groups" && currentUrl.pathname !== "/groups") return true;
  return defaultShouldRevalidate;
}

/** The unread events of all my groups, for the 群組 tab's dot, when /plan can not carry it (no active plan → 404). Any failure (an api without groups, a hiccup) is "none". */
async function unreadFromGroups(): Promise<number> {
  const r = await getGroups().catch(() => null);
  return r ? r.groups.reduce((t, g) => t + g.unread, 0) : 0;
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  let loginError: string | null = null;
  try {
    if (await completeLogin(url)) throw redirect(takeReturnTo() ?? "/"); // back to the invite link that sent the person to log in, if any
  } catch (e) {
    if (e instanceof AuthError) loginError = e.message;
    else throw e;
  }
  if (loginError) return { data: null as PlanResponse | null, user: null as SessionUser | null, error: loginError, groupsUnread: 0 };
  if (!hasSession()) {
    saveReturnTo(url.pathname);
    throw redirect("/login");
  }

  const user = getUser();
  void ensureWeekly(); // the 週回顧 entries (課表, 今天) read /weekly: asked next to /plan so both come in together (not waited for; no plan or a failure just means no entry)
  try {
    const data = await getPlan();
    return { data, user, error: null as string | null, groupsUnread: data.groups_unread ?? 0 };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      saveReturnTo(url.pathname); // an expired session on an invite link: log in, come back to the link
      throw redirect("/login");
    }
    if (e instanceof ApiError && e.status === 403) return { data: null, user, error: "not_registered" as string, groupsUnread: 0 };
    // no active plan: /plan has no `groups_unread` to give, the list of groups has the same numbers
    if (e instanceof ApiError && e.status === 404) return { data: null, user, error: null as string | null, groupsUnread: await unreadFromGroups() };
    throw e;
  }
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  useNavDirClear(useLocation().key);
  usePageFocus();
  // A page that says so (教練: `handle = { modal: true }`) is a modal: no tab bar, and the shell gets the class (coach-sheet-polish)
  const modal = useMatches().some((m) => (m.handle as { modal?: boolean } | undefined)?.modal === true);
  // The modal slides up over the page (01b §5.6; `MODAL_SLIDE` in lib/motion.ts turns it into a fade). Its bar and its composer are glass that moves with it: solid until it has stopped.
  // When the page is not a modal (leaving: the coach slid down, then we navigated) whatever the leaving animation left on the shell goes.
  const shellRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (!modal) { clearMotion(el); return; }
    void enterModal(el, [...el.querySelectorAll<HTMLElement>(".navbar, .composer")]);
  }, [modal]);
  if (loaderData.error) {
    const notRegistered = loaderData.error === "not_registered";
    return (
      <div className="shell">
        <NavBar kind="large" title={notRegistered ? "尚未加入名單" : "登入失敗"} />
        <main>
          <p className="empty">
            {notRegistered
              ? `${loaderData.user?.display_name ?? "這個帳號"} 還沒被加進 training-api 的 users。`
              : loaderData.error}
          </p>
          <p className="note">
            <button type="button" onClick={logout} style={{ color: "var(--ink-2)", textDecoration: "underline" }}>
              {notRegistered ? "登出，換一個帳號" : "重新登入"}
            </button>
          </p>
        </main>
      </div>
    );
  }
  return (
    <div ref={shellRef} className={modal ? "shell modal" : "shell"}>
      <Outlet />
      {modal ? null : <EdgeBack />}
      {modal ? null : <TabBar coachUnread={(loaderData.data?.coach_unread ?? 0) > 0} groupsUnread={loaderData.groupsUnread > 0} />}
    </div>
  );
}
