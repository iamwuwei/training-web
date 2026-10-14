import { Outlet, redirect } from "react-router";
import { TabBar } from "../components/ui";
import { ApiError, getPlan } from "../lib/api";
import { getToken, getUser } from "../lib/auth";
import type { ApiUser, PlanResponse } from "../types/api";

// Layout for the three tabs. Loads the plan once; children read it through usePlan()
// (app/lib/use-plan.tsx). The root route's HydrateFallback covers the initial load.

export async function clientLoader() {
  if (!getToken()) throw redirect("/login");
  const user: ApiUser | null = getUser();
  try {
    const data = await getPlan();
    return { data, user };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    if (e instanceof ApiError && e.status === 404) return { data: null as PlanResponse | null, user };
    throw e;
  }
}

export default function AppLayout() {
  return (
    <div className="shell">
      <Outlet />
      <TabBar />
    </div>
  );
}
