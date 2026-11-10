import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

// Focus on the pages that go in and out by View Transition (01 H6, 01b §5.4): after a push the focus moves to the new page's title, after a pop it goes back to the row
// that was pressed, so a keyboard or a screen reader does not start again from the top of the page (the old row is gone from the DOM, and the focus falls to <body>).
// 設定's pushed pages do the same in `PushStack`. Module state only, nothing is stored.

/** Where each push started from (the url of the page) and which link was pressed (its href), until the page is come back to. */
const pressed = new Map<string, string>();

/** A link that pushes a page was pressed: remember it under the page it is on. `PushLink` calls this. */
export function rememberPushFocus(link: HTMLElement) {
  const href = link.getAttribute("href");
  if (href) pressed.set(window.location.pathname + window.location.search, href);
}

/** The title of the page that is on screen (the inline bar's `h1`), else its first `h1`, else `main`: given a `tabindex` of -1 so it can take focus without being a stop of Tab. */
function pageTarget(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(".navbar h1") ?? document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("main");
  if (el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  return el;
}

/** In the app layout: the focus follows the navigation that `PushLink`, the back pills and the browser's back make (not the tabs, not 設定, not the coach). */
export function usePageFocus() {
  const { key } = useLocation();
  const navType = useNavigationType();
  const navTypeRef = useRef(navType);
  useLayoutEffect(() => { navTypeRef.current = navType; });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const { pathname, search } = window.location;
    if (pathname.startsWith("/settings") || pathname === "/coach") return;
    const nav = document.documentElement.dataset.nav; // "push" / "pop" while a transition of ours runs; none for a tab, the browser's back
    const url = pathname + search;
    if (nav === "push") {
      pageTarget()?.focus({ preventScroll: true });
    } else if (nav === "pop" || navTypeRef.current === "POP") {
      const href = pressed.get(url);
      pressed.delete(url);
      const row = href ? document.querySelector<HTMLElement>(`a[href="${CSS.escape(href)}"]`) : null;
      // the row that was pressed; if it is gone (the list changed) or this is our own back pill with nothing remembered, the page's title; a browser back that remembers nothing is left alone
      if (row) row.focus({ preventScroll: true });
      else if (href || nav === "pop") pageTarget()?.focus({ preventScroll: true });
    }
  }, [key]); // one run per location: the rest is read when it runs
}
