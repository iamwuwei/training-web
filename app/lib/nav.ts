// Shell navigation helpers (01b §5.3, §5.5). Module state only: nothing is stored anywhere.
import { useEffect } from "react";

/** The three tab roots whose scroll position is remembered per path (ScrollRestoration getKey, root.tsx). 教練 is a modal, 設定 is not a tab. */
export const TAB_ROOTS = new Set(["/", "/plan", "/groups"]);

// Which tab a path belongs to: 今天 (and 設定, which is entered from 今天) 0, 課表 1, 群組 2. 教練 (3) is a modal and is never "selected".
const ROOT_OF = [[/^\/(settings(\/.*)?)?$/, 0], [/^\/plan(\/|$|\?)/, 1], [/^\/groups(\/|$)/, 2]] as const;

/** The tab this path is under, or null (報告, 加入群組, 教練 … belong to no tab). */
export function rootIndex(pathname: string): number | null {
  for (const [re, i] of ROOT_OF) if (re.test(pathname)) return i;
  return null;
}

let lastIdx = 0;
/** Where the tab bar's lens sits: the path's own tab, else the last one it was on (a page outside the tabs keeps the lens where it was, 01b §17-11). */
export function lensIndex(pathname: string): number {
  const i = rootIndex(pathname);
  if (i != null) lastIdx = i;
  return lastIdx;
}

// A back that the app itself started (a back pill, the left-edge swipe): its pop plays our animation. A `popstate` nobody marked is the browser's own
// (Safari's swipe back, the back button): in a tab it has just played its own animation, so ours does not play again; in standalone there is no
// browser animation, so it always plays (01b §5.2, §17-3). Module state only, expires on its own if the navigation never happens.
let ownBackAt = 0;
export function markOwnBack() { ownBackAt = Date.now(); }
/** True once, if `markOwnBack()` was called within the last second. */
export function takeOwnBack(): boolean {
  const own = Date.now() - ownBackAt < 1000;
  ownBackAt = 0;
  return own;
}

/** Is there an earlier entry of this app's history to go back to? (React Router counts the entries it made in `history.state.idx`; 0 = the first one of this tab.) */
export function hasPrevious(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === "number" && idx > 0;
}

// Which way a page is about to move, for the View Transitions of the pages that are not settings (01b §5.4): `html[data-nav="push" | "pop"]` is what app.css reads.
// A transition nobody marked (the browser's own back, forward) has no `data-nav`, and app.css gives it no animation: Safari has just played its own.
// The transition starts when the navigation lands (after its loaders, which can take seconds), so the mark is not timed from the click: it is cleared 1 s after
// the location changed (`useNavDirClear`, in the app layout), and a mark whose navigation never landed goes after 10 s.
let navDirTimer = 0;
/** Mark the navigation that is about to start. */
export function setNavDir(dir: "push" | "pop") {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.nav = dir;
  window.clearTimeout(navDirTimer);
  navDirTimer = window.setTimeout(() => { delete document.documentElement.dataset.nav; }, 10_000);
}

// The browser's own back and forward are always a `popstate`, and one that this app started marks `pop` (never `push`): a `push` still on the page when a
// `popstate` comes is left over from the push before it (the transition is still within its 1 s), so it goes, and the browser's back plays no animation.
// Registered once when the module is loaded, in the capture phase so it runs before the router starts its navigation.
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => { if (document.documentElement.dataset.nav === "push") delete document.documentElement.dataset.nav; }, true);
}

/** The mark goes once the transition that the location change started is over (400 ms at most, plus room for a slow device: the animation starts after the new page is drawn). */
export function useNavDirClear(locationKey: string) {
  useEffect(() => {
    if (!document.documentElement.dataset.nav) return;
    const t = window.setTimeout(() => { window.clearTimeout(navDirTimer); delete document.documentElement.dataset.nav; }, 1000);
    return () => window.clearTimeout(t);
  }, [locationKey]);
}
