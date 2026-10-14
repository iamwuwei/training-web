import { useMemo } from "react";
import { useRouteLoaderData } from "react-router";
import type { clientLoader } from "../routes/_app";
import type { ApiUser } from "./auth";
import { todayJst } from "./date";
import { buildPlanView, type PlanView } from "./plan";

/** The plan loaded by routes/_app as a derived view, or null when the user has no active plan. */
export function usePlan(): PlanView | null {
  const loaded = useRouteLoaderData<typeof clientLoader>("routes/_app");
  const data = loaded?.data ?? null;
  const today = todayJst();
  return useMemo(() => (data ? buildPlanView(data, today) : null), [data, today]);
}

export function useUser(): ApiUser | null {
  return useRouteLoaderData<typeof clientLoader>("routes/_app")?.user ?? null;
}

export function NoPlan({ title }: { title: string }) {
  return (
    <>
      <header className="topbar"><h1>{title}</h1></header>
      <main><p className="empty">還沒有課表。請先在 training-api 建立計畫。</p></main>
    </>
  );
}
