import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router";
import { BackIcon } from "./icons";

// Top of a page (01b §5.7, 02 §2.2): the bar is the page's background colour while the page is at rest; once content scrolls under it
// the glass and the .5px line fade in (opacity only, the blur never animates). A root page (今天, 課表, 群組) has a large title that
// collapses into the bar; every other page has an inline title (back pill, centred title, optional right controls).

/**
 * True once `target` has gone up under the bar (the bar then turns glass). `offsetPx` is the bar's height (`--nav-h` + `--nav-top`, measured),
 * so a target is "under" the bar as soon as it leaves the part of the viewport the bar does not cover. `root`: the scroller, or null for the window.
 * Without IntersectionObserver the bar is always glass.
 */
function useNavGlass(target: RefObject<Element | null>, root: RefObject<Element | null> | null, offsetPx: number): boolean {
  const [glass, setGlass] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = window.setTimeout(() => setGlass(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(([e]) => setGlass(!e.isIntersecting), { root: root?.current ?? null, rootMargin: `-${offsetPx}px 0px 0px 0px`, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [target, root, offsetPx]);
  return glass;
}

/** The bar's measured height (it is `--nav-h` + `--nav-top`, which CSS knows and JS does not). */
function useBarHeight(ref: RefObject<HTMLElement | null>): number {
  const [h, setH] = useState(44);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(Math.round(el.getBoundingClientRect().height) || 44));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

type LargeProps = { kind: "large"; title: string; subtitle?: ReactNode; right?: ReactNode; sentinel?: RefObject<HTMLElement | null> };
type InlineProps = { kind: "inline"; title: ReactNode; left?: ReactNode; right?: ReactNode; subtitle?: ReactNode; scroller?: RefObject<HTMLElement | null> | null; className?: string };

export function NavBar(props: LargeProps | InlineProps) {
  const barRef = useRef<HTMLElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const sentinelRef = useRef<HTMLElement>(null);
  const barH = useBarHeight(barRef);
  const large = props.kind === "large";
  const glass = useNavGlass(large ? (props.sentinel ?? h1Ref) : sentinelRef, large ? null : props.scroller ?? null, barH);
  const state = glass ? "glass" : "rest";

  if (props.kind === "large") {
    return (
      <>
        <header ref={barRef} className={`navbar ${state}`}>
          <div className="navrow large">
            <div className="nl" />
            <span className="ttl" aria-hidden="true">{props.title}</span>
            <div className="nr">{props.right}</div>
          </div>
        </header>
        <LargeTitle title={props.title} subtitle={props.subtitle} h1Ref={h1Ref} />
      </>
    );
  }
  return (
    <>
      <header ref={barRef} className={`navbar ${state}${props.className ? ` ${props.className}` : ""}`}>
        <div className="navrow">
          <div className="nl">{props.left}</div>
          <h1 className="ttl" tabIndex={-1}>{props.title}{props.subtitle ? <small>{props.subtitle}</small> : null}</h1>
          <div className="nr">{props.right}</div>
        </div>
      </header>
      <i ref={sentinelRef} className="nav-sentinel" aria-hidden="true" />
    </>
  );
}

/** The big title of a root page, under the bar. The bar watches this h1: when it has scrolled under, the bar's small title takes over. */
export function LargeTitle({ title, subtitle, id, h1Ref }: { title: string; subtitle?: ReactNode; id?: string; h1Ref?: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="lt">
      <h1 id={id} ref={h1Ref} tabIndex={-1}>{title}</h1>
      {subtitle ? <div className="sub">{subtitle}</div> : null}
    </div>
  );
}

/** A 44 px round glass button (a link when `to`, else a button). `label` is its accessible name. */
export function GlassButton({ to, onClick, label, children, className, disabled, busy, ariaDisabled }: {
  to?: string;
  onClick?: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** shown as aria-busy (the refresh button while it reads) */
  busy?: boolean;
  /** a button that is "off" but still answers a press (the 新增／邀請 buttons at their limit) */
  ariaDisabled?: boolean;
}) {
  const cls = `gbtn glass${className ? ` ${className}` : ""}`;
  if (to) return <Link to={to} className={cls} aria-label={label}>{children}</Link>;
  return (
    <button type="button" className={cls} aria-label={label} aria-busy={busy || undefined} aria-disabled={ariaDisabled || undefined} disabled={disabled} onClick={onClick}>{children}</button>
  );
}

/**
 * The back control of an inline page: "‹ 設定". `label` is what is drawn, `ariaLabel` (when different) what is announced. A link when `to`, else a button.
 */
export function BackPill({ label, ariaLabel, to, onClick }: { label: string; ariaLabel?: string; to?: string; onClick?: () => void }) {
  const inner = <><BackIcon /><span>{label}</span></>;
  const cls = "gbtn glass backpill";
  if (to) return <Link to={to} className={cls} aria-label={ariaLabel ?? label}>{inner}</Link>;
  return <button type="button" className={cls} aria-label={ariaLabel ?? label} onClick={onClick}>{inner}</button>;
}
