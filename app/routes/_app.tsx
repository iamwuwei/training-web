import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/_app";
import { TabBar } from "../components/ui";
import { ApiError, getPlan } from "../lib/api";
import { AuthError, completeLogin, getUser, hasSession, logout, type SessionUser } from "../lib/auth";
import type { PlanResponse } from "../types/api";

// Layout for the three tabs. Finishes the Cognito callback (?code=&state= on "/"),
// then loads the plan once; children read it through usePlan() (app/lib/use-plan.tsx).

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  let loginError: string | null = null;
  try {
    if (await completeLogin(url)) throw redirect("/");
  } catch (e) {
    if (e instanceof AuthError) loginError = e.message;
    else throw e;
  }
  if (loginError) return { data: null as PlanResponse | null, user: null as SessionUser | null, error: loginError };
  if (!hasSession()) throw redirect("/login");

  const user = getUser();
  try {
    const data = await getPlan();
    return { data, user, error: null as string | null };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    if (e instanceof ApiError && e.status === 403) return { data: null, user, error: "not_registered" as string };
    if (e instanceof ApiError && e.status === 404) return { data: null, user, error: null as string | null };
    throw e;
  }
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  if (loaderData.error) {
    const notRegistered = loaderData.error === "not_registered";
    return (
      <div className="shell">
        <header className="topbar"><h1>{notRegistered ? "尚未加入名單" : "登入失敗"}</h1></header>
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
    <div className="shell">
      <Outlet />
      <TabBar coachUnread={(loaderData.data?.coach_unread ?? 0) > 0} />
    </div>
  );
}
