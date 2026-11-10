import { useMemo } from "react";
import { Link, useRouteLoaderData } from "react-router";
import type { clientLoader } from "../routes/_app";
import { GearIcon } from "../components/icons";
import { GlassButton, NavBar } from "../components/nav-bar";
import { PushLink } from "../components/push-link";
import { CoachAvatar } from "../components/ui";
import { WooStatus } from "../components/woo-status";
import type { SessionUser } from "./auth";
import { todayJst } from "./date";
import { draftWeeks, DRAFT_TEXT, draftName, useLatestDraft } from "./draft";
import { buildPlanView, type PlanView } from "./plan";

/** The plan loaded by routes/_app as a derived view, or null when the user has no active plan. */
export function usePlan(): PlanView | null {
  const loaded = useRouteLoaderData<typeof clientLoader>("routes/_app");
  const data = loaded?.data ?? null;
  const today = todayJst();
  return useMemo(() => (data ? buildPlanView(data, today) : null), [data, today]);
}

export function useUser(): SessionUser | null {
  return useRouteLoaderData<typeof clientLoader>("routes/_app")?.user ?? null;
}

/**
 * What 今天 and 課表 show to someone without an active plan (02 §1): the way to ask Woo for one, or where the draft Woo is
 * making for him stands. Reads GET /me (Strava) and GET /plan-drafts/latest once; the `_app` loader is not involved.
 */
export function NoPlanEntry({ title }: { title: "今天" | "課表" }) {
  const { me, draft, latestNotFound, loading } = useLatestDraft();
  const T = DRAFT_TEXT.entry;
  const aside = title === "今天" ? <GlassButton to="/settings" label="設定"><GearIcon /></GlassButton> : undefined;

  let body: React.ReactNode;
  if (loading) {
    // both answers are not in yet: a round and two lines, no words
    body = (
      <div className="plan-entry" aria-busy="true" aria-label="載入中">
        <div className="sk" style={{ width: 44, height: 44, borderRadius: "50%" }} />
        <div className="sk" style={{ width: 140, height: 20, marginTop: 14 }} />
        <div className="sk" style={{ width: 240, height: 14, marginTop: 10 }} />
      </div>
    );
  } else if (me && !me.strava) {
    body = (
      <div className="plan-entry">
        <CoachAvatar size={44} />
        <p className="t">{T.noneTitle}</p>
        <p className="sub">{T.stravaSub}</p>
        <div className="actions-row center"><Link to="/settings/strava" className="btn primary compact">{T.stravaCta}</Link></div>
      </div>
    );
  } else if (latestNotFound) {
    body = <p className="empty">{T.apiMissing}</p>;
  } else if (draft?.status === "pending") {
    body = (
      <div className="plan-entry">
        <CoachAvatar size={44} />
        <p className="t"><WooStatus stage={null} fallback={T.pendingTitle} /></p>
        <p className="sub">{T.pendingSub}</p>
        <div className="actions-row center"><PushLink to={`/plan/draft/${draft.id}`} className="btn primary compact">{T.pendingCta}</PushLink></div>
      </div>
    );
  } else if (draft?.status === "ready") {
    body = (
      <div className="plan-entry">
        <CoachAvatar size={44} badge="check" />
        <p className="t">{T.readyTitle}</p>
        <p className="sub">{T.readySub(draftName(draft), draftWeeks(draft))}</p>
        <div className="actions-row center"><PushLink to={`/plan/draft/${draft.id}`} className="btn primary compact">{T.readyCta}</PushLink></div>
      </div>
    );
  } else if (draft?.status === "failed") {
    body = (
      <div className="plan-entry">
        <CoachAvatar size={44} />
        <p className="t">{T.failedTitle}</p>
        <p className="sub">{draft.can_resume ? T.failedSub : T.failedSubNoResume}</p>
        <div className="actions-row center"><PushLink to={`/plan/draft/${draft.id}`} className="btn primary compact">{T.failedCta}</PushLink></div>
      </div>
    );
  } else {
    body = (
      <div className="plan-entry">
        <CoachAvatar size={44} />
        <p className="t">{T.noneTitle}</p>
        <p className="sub">{T.noneSub}</p>
        <div className="actions-row center"><PushLink to="/plan/new" className="btn primary compact woo"><span className="w" aria-hidden="true">W</span>{T.noneCta}</PushLink></div>
        <p className="hint">{T.noneHint}</p>
      </div>
    );
  }

  return (
    <>
      <NavBar kind="large" title={title} right={aside} />
      <main>{body}</main>
    </>
  );
}
