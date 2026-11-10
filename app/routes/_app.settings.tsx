import { useEffect, useRef, useState } from "react";
import { redirect, useLocation, useMatches, useNavigate, useOutlet, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.settings";
import { BackPill, NavBar } from "../components/nav-bar";
import { PushStack } from "../components/push-stack";
import { SettingsMain } from "../components/settings-main";
import { ApiError, getGroups, getMe, getShare } from "../lib/api";
import { hasSession } from "../lib/auth";
import { hasPrevious, markOwnBack } from "../lib/nav";
import { pageTitle } from "../lib/meta";
import type { SettingsContext } from "../lib/settings-context";
import type { ShareSettings } from "../types/api";

export async function clientLoader() {
  if (!hasSession()) throw redirect("/login");
  try {
    // The share block is the 群組 feature's: an api from before it answers 404, then the block is left out and the page is as it was.
    // Any other failure is shown as a failure (it is the only place to see what is shared: it must not vanish quietly).
    // `inGroups` only picks the block's first sentence; if the groups can not be read the usual one is shown.
    const [me, share, groups] = await Promise.all([
      getMe(),
      getShare().then((r) => ({ state: "ok" as const, share: r.share })).catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? { state: "missing" as const } : { state: "error" as const })),
      getGroups().catch(() => null),
    ]);
    return { me, share, inGroups: groups ? groups.groups.length > 0 : true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    throw e;
  }
}

/** The pushed pages (route id → the bar's title). The pages themselves only draw their content. */
const SUB_TITLES: Record<string, string> = {
  "routes/_app.settings.privacy": "隱私",
  "routes/_app.settings.strava": "Strava",
};

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  const sub = matches.at(-1)?.id ?? "";
  return pageTitle(SUB_TITLES[sub] ?? "設定", matches);
}

/**
 * 設定 and the pages pushed over it (01b §5.1, §5.2). The settings page stays mounted under whichever page is pushed (`PushStack`), so coming back finds it as it was.
 * The share switches are one state here (the 隱私 row on the settings page counts the ones that are on while the page that changes them is open).
 */
export default function SettingsLayout({ loaderData }: Route.ComponentProps) {
  const matches = useMatches();
  const subId = matches.map((m) => m.id).find((id) => id in SUB_TITLES) ?? null;
  const { state } = useLocation() as { key: string; state: { fromSettings?: boolean } | null };
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const loaded = loaderData.share.state === "ok" ? loaderData.share.share : null;
  const [changed, setChanged] = useState<ShareSettings | null>(null);
  const share = changed ?? loaded;
  const ctx: SettingsContext = {
    me: loaderData.me,
    shareState: loaderData.share.state,
    share,
    inGroups: loaderData.inGroups,
    updateShare: (f) => setChanged((prev) => { const base = prev ?? loaded; return base ? f(base) : prev; }),
    reload: () => revalidator.revalidate(),
  };

  const outlet = useOutlet(ctx);

  // One back at a time: a second press before the first one has landed would go back past the settings page.
  const backing = useRef(false);
  useEffect(() => { backing.current = false; }, [subId]);
  // A page pushed from here goes one step back; one reached from elsewhere (今天's 去設定, a shared link, an old #anchor) goes to the settings page itself.
  const onBack = () => {
    if (backing.current) return;
    backing.current = true;
    markOwnBack();
    if (state?.fromSettings) void navigate(-1);
    else void navigate("/settings", { replace: true });
  };

  // 今天 is the page before this one when there is one. `key` alone does not say (a `replace` from a pushed page, or an old #anchor, gives a new key at the start of the history): the router's own index does.
  const goToday = () => void (hasPrevious() ? navigate(-1) : navigate("/", { replace: true }));

  return (
    <>
      {subId ? null : outlet /* the index: nothing to draw, unless the url carries an old #anchor and it sends us on */}
      <PushStack
        base={
          <>
            <NavBar kind="inline" title="設定" left={<BackPill label="今天" ariaLabel="返回今天" onClick={goToday} />} />
            <SettingsMain ctx={ctx} />
          </>
        }
        sub={subId ? outlet : null}
        subKey={subId}
        title={subId ? SUB_TITLES[subId] : null}
        backLabel="設定"
        onBack={onBack}
      />
    </>
  );
}
