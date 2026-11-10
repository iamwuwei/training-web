import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useNavigationType } from "react-router";
import { EDGE_GESTURES, fadeTo, holdAt, isStandalone, move, reducedMotion, translateXNow } from "../lib/motion";
import { takeOwnBack } from "../lib/nav";
import { BackPill, NavBar } from "./nav-bar";

// Two pages in one layout (01b §5.2, 02 §2.10): a main page and the page pushed over it. Neither is unmounted: the main page stays under the pushed one
// (fixed, scrolled to where it was, inert), so coming back finds it as it was and the left-edge swipe has a real page to uncover. Only the settings layout needs this.
//
// push: the new page slides in from the right (400 ms --spring) while the main page moves 30% to the left under a dimming layer.
// pop:  the same backwards (350 ms). While a page moves `.busy` takes the pointer away from both layers (02 §2.10: two pages in motion can not be pressed), so a touch can not
//       interrupt; a back that gets in anyway (the browser's own button, a key, a script) starts from where the page is, not from the end.
// edge swipe (standalone only, a 20 px strip at the left edge): follows the finger; past half the width, or flicked (> 0.5 px/ms), it completes, else it springs back.
// A pop that is the browser's own (Safari's swipe back already animated it) is swapped without animation, except in standalone where nothing else animates (`takeOwnBack`).
// Reduced motion: no movement, a 120 ms fade, no edge strip.

interface Kept { node: ReactNode; title: string | null; key: string }

const COMPLETE_VELOCITY = 0.5; // px/ms

export function PushStack({ base, sub, subKey, title, backLabel, onBack }: {
  /** The main page. */
  base: ReactNode;
  /** The pushed page (an Outlet's element), or null while there is none. */
  sub: ReactNode | null;
  /** The pushed page's route id: a change is a push or a pop. */
  subKey: string | null;
  /** The pushed page's title (the bar's, inline). */
  title: string | null;
  /** The back pill's word. */
  backLabel: string;
  /** A back the app starts: marks it as ours and goes one step back. */
  onBack: () => void;
}) {
  const navType = useNavigationType();
  const navTypeRef = useRef(navType);
  const onBackRef = useRef(onBack);
  useLayoutEffect(() => { navTypeRef.current = navType; onBackRef.current = onBack; });

  const root = useRef<HTMLDivElement>(null);
  const baseEl = useRef<HTMLDivElement>(null);
  const innerEl = useRef<HTMLDivElement>(null);
  const dimEl = useRef<HTMLDivElement>(null);
  const topEl = useRef<HTMLDivElement>(null);

  // The pushed page is drawn from what it was while it leaves (the route has already gone): `kept` is the last one, `shownKey` says one is still on screen.
  const [kept, setKept] = useState<Kept | null>(sub && subKey ? { node: sub, title, key: subKey } : null);
  const [shownKey, setShownKey] = useState<string | null>(subKey);
  if (sub && subKey && (kept?.node !== sub || kept.title !== title)) setKept({ node: sub, title, key: subKey });
  if (subKey && shownKey !== subKey) setShownKey(subKey);
  const leaving = !subKey && shownKey != null;
  const node = subKey ? sub : leaving ? kept?.node ?? null : null;
  const shownTitle = subKey ? title : kept?.title ?? null;

  const prevKey = useRef<string | null>(null);
  const mounted = useRef(false);
  const baseY = useRef(0);
  const returnEl = useRef<HTMLElement | null>(null);
  const doneByEdge = useRef(false);

  /* oxlint-disable react/set-state-in-effect -- a pop without an animation drops the leaving page in the same commit (a layout effect's update is flushed before paint) */
  useLayoutEffect(() => {
    const r = root.current, base = baseEl.current, inner = innerEl.current, dim = dimEl.current;
    if (!r || !base || !inner || !dim) return;
    const first = !mounted.current;
    mounted.current = true;
    const prev = prevKey.current;
    prevKey.current = subKey;
    const busy = (on: boolean) => r.classList.toggle("busy", on);
    // the main page goes under: fixed, scrolled to where the window was (a scroller of its own keeps its sticky bar working), inert
    const goUnder = (y: number) => {
      base.classList.add("under");
      base.scrollTop = y;
      base.setAttribute("inert", "");
      base.setAttribute("aria-hidden", "true");
      inner.style.transform = "translateX(-30%)"; // where the push ends (and what a pop starts from when the page was opened on the pushed url)
      dim.style.opacity = "1";
    };
    if (first) { if (subKey) goUnder(0); return; }
    if (prev === subKey) return;

    if (!prev && subKey) {
      // ---- push
      const top = topEl.current;
      returnEl.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      baseY.current = window.scrollY;
      goUnder(baseY.current);
      window.scrollTo(0, 0);
      // our own pushes animate; so does a forward in standalone; a redirect (replace) and a browser forward in a tab do not
      const animate = !!top && (navTypeRef.current === "PUSH" || (navTypeRef.current === "POP" && isStandalone()));
      const done = () => { busy(false); top?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }); };
      if (!animate || !top) { done(); return; }
      busy(true);
      if (reducedMotion()) {
        void fadeTo(top, 1, { from: 0, duration: 120, clearAtEnd: true }).finished.then(done);
      } else {
        void move(inner, "translateX(-30%)", { from: "none", duration: 400, end: "keep" });
        void fadeTo(dim, 1, { from: 0, duration: 400 });
        void move(top, "none", { from: "translateX(100%)", duration: 400, end: "clear" }).finished.then(done);
      }
      return;
    }

    if (prev && !subKey) {
      // ---- pop
      const top = topEl.current;
      const topY = window.scrollY; // where the pushed page was scrolled: it stays on screen where it is while it leaves (as the scroll of its own box, so its sticky bar keeps working)
      const animate = takeOwnBack() || isStandalone();
      const byEdge = doneByEdge.current;
      doneByEdge.current = false;
      base.classList.remove("under");
      base.scrollTop = 0;
      base.removeAttribute("inert");
      base.removeAttribute("aria-hidden");
      window.scrollTo(0, baseY.current);
      if (top) { top.classList.add("leaving"); top.scrollTop = topY; }
      const finish = () => {
        busy(false);
        inner.style.transform = "";
        inner.style.willChange = "";
        dim.style.opacity = "";
        setShownKey(null);
        setKept(null);
        const el = returnEl.current;
        returnEl.current = null;
        if (el?.isConnected) {
          el.focus({ preventScroll: true });
          el.classList.add("was-pressed"); // the row that was pressed shows it for a moment and lets go (02 §2.6)
          requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("was-pressed")));
        }
      };
      if (!top || (!animate && !byEdge) || byEdge) { finish(); return; }
      busy(true);
      if (reducedMotion()) {
        void fadeTo(top, 0, { duration: 120 }).finished.then(finish);
      } else {
        void move(inner, "none", { duration: 350, end: "clear" });
        void fadeTo(dim, 0, { duration: 350, clearAtEnd: true });
        void move(top, "translateX(100%)", { duration: 350, end: "keep" }).finished.then(finish);
      }
    }
  }, [subKey]);
  /* oxlint-enable react/set-state-in-effect */

  // ---- the left-edge swipe (standalone)
  const drag = useRef<{ id: number; x0: number; y0: number; moved: boolean; samples: { t: number; x: number }[] } | null>(null);
  const onEdgeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const top = topEl.current, inner = innerEl.current, dim = dimEl.current;
    if (!top || !inner || !dim || !subKey) return;
    // the strip only gets a press at rest (`.busy` has the pointer off during a push or pop); holdAt is a guard for a run that has not quite ended, it stops it where it is
    holdAt(top); holdAt(inner); holdAt(dim);
    e.currentTarget.setPointerCapture(e.pointerId); // from the press: a mouse that leaves the 20 px strip keeps sending its moves here (the strip has nothing to click, so nothing is lost)
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, samples: [{ t: e.timeStamp, x: e.clientX }] };
  };
  const onEdgeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current, top = topEl.current, inner = innerEl.current, dim = dimEl.current;
    if (!d || e.pointerId !== d.id || !top || !inner || !dim) return;
    const dx = Math.max(0, e.clientX - d.x0);
    if (!d.moved) {
      if (Math.abs(e.clientY - d.y0) > Math.abs(e.clientX - d.x0) && Math.abs(e.clientY - d.y0) > 3) { // it is a scroll: not ours
        e.currentTarget.releasePointerCapture(e.pointerId);
        drag.current = null;
        return;
      }
      if (dx < 3) return;
      d.moved = true;
    }
    const w = window.innerWidth;
    top.style.transform = `translateX(${dx}px)`;
    inner.style.transform = `translateX(${-0.3 * w + 0.3 * dx}px)`;
    dim.style.opacity = String(Math.max(0, 1 - dx / w));
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
  };
  const onEdgeUp = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current, top = topEl.current, inner = innerEl.current, dim = dimEl.current;
    if (!d || e.pointerId !== d.id || !top || !inner || !dim) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved) return;
    const w = window.innerWidth;
    const dx = translateXNow(top);
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
    const first = d.samples[0], last = d.samples[d.samples.length - 1];
    const v = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    if (!cancelled && (dx > w / 2 || v > COMPLETE_VELOCITY)) {
      // finish the pop from here (the time left in proportion), then go back: the pop then finds the page already gone
      const ms = Math.max(120, 350 * (1 - dx / w));
      void move(inner, "none", { duration: ms, end: "clear" });
      void fadeTo(dim, 0, { duration: ms });
      void move(top, "translateX(100%)", { duration: ms, end: "keep" }).finished.then(() => { doneByEdge.current = true; onBackRef.current(); });
    } else {
      void move(inner, "translateX(-30%)", { duration: 300, end: "keep" });
      void fadeTo(dim, 1, { duration: 300 });
      void move(top, "none", { duration: 300, end: "clear" });
    }
  };

  return (
    <div ref={root} className="pstack">
      <div ref={baseEl} className="pg base">
        <div ref={innerEl} className="pg-inner">{base}</div>
        <div ref={dimEl} className="dim" aria-hidden="true" />
      </div>
      {node ? (
        <div ref={topEl} className="pg top">
          {EDGE_GESTURES && isStandalone() && !reducedMotion() && subKey ? (
            <div className="edge" onPointerDown={onEdgeDown} onPointerMove={onEdgeMove} onPointerUp={(e) => onEdgeUp(e, false)} onPointerCancel={(e) => onEdgeUp(e, true)} />
          ) : null}
          <div className="pg-inner">
            <NavBar kind="inline" title={shownTitle ?? ""} left={<BackPill label={backLabel} ariaLabel={`返回${backLabel}`} onClick={onBack} />} />
            {node}
          </div>
        </div>
      ) : null}
    </div>
  );
}
