import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { isStandalone } from "../lib/motion";
import { TAB_ROOTS, hasPrevious, setNavDir } from "../lib/nav";

// The left-edge swipe for the pages that push with a View Transition (01b §5.4; 設定 has its own that follows the finger, push-stack.tsx). Standalone only: a tab has
// the browser's own. It does not follow the finger (a View Transition can not be driven by one): while it is dragged a 4 px line shows at the edge so the pull is seen,
// and on release, past half the width or faster than 0.5 px/ms, the page goes back with the pop transition; otherwise nothing happens.
// The strip is a 20 px element over the page: a tap on it is a tap on the strip (it does nothing), so the page's own content at x = 16–20 can not be pressed in standalone.

const COMPLETE_VELOCITY = 0.5; // px/ms
/** Pages that have no use for it: the tab roots (nothing to go back to), 設定 (its own), the plan form (a step of it is not a page: a swipe would drop the answers). */
const skip = (pathname: string) => TAB_ROOTS.has(pathname) || pathname.startsWith("/settings") || pathname === "/plan/new" || pathname === "/coach";

export function EdgeBack() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const drag = useRef<{ id: number; x0: number; y0: number; moved: boolean; samples: { t: number; x: number }[] } | null>(null);
  if (!isStandalone() || skip(pathname)) return null;

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId); // from the press, so a mouse or trackpad that leaves the 20 px strip keeps sending its moves here (a finger is captured by the browser anyway)
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, samples: [{ t: e.timeStamp, x: e.clientX }] };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.moved) {
      if (Math.abs(e.clientY - d.y0) > Math.abs(dx) && Math.abs(e.clientY - d.y0) > 3) { // a scroll: not ours
        e.currentTarget.releasePointerCapture(e.pointerId);
        drag.current = null;
        return;
      }
      if (dx < 6) return;
      d.moved = true;
      setActive(true);
    }
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved || cancelled) return;
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    const first = d.samples[0], last = d.samples[d.samples.length - 1];
    const v = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    if ((e.clientX - d.x0 > window.innerWidth / 2 || v > COMPLETE_VELOCITY) && hasPrevious()) {
      setNavDir("pop");
      void navigate(-1);
    }
  };

  return <div className={`edge-back${active ? " active" : ""}`} onPointerDown={down} onPointerMove={move} onPointerUp={(e) => up(e, false)} onPointerCancel={(e) => up(e, true)} aria-hidden="true" />;
}
