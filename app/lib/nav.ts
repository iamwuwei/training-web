// Shell navigation helpers (01b §5.3, §5.5). Module state only: nothing is stored anywhere.

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
