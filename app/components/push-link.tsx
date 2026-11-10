import { Link, type LinkProps } from "react-router";
import { setNavDir } from "../lib/nav";

/**
 * A link into a page that is pushed over this one (a report, a group's page, the plan form, a draft): it goes with a View Transition, sliding in from the right
 * (01b §5.4, 02 §2.10). Without `document.startViewTransition` (Safari before 18) it is a plain link. Tab to tab is not a push: those links stay `Link`.
 */
export function PushLink({ onClick, ...props }: LinkProps) {
  return <Link {...props} viewTransition onClick={(e) => {
    onClick?.(e);
    // a ⌘／Ctrl／Shift／Alt click or a middle click is the browser's (a new tab): this page does not move, so nothing is marked
    if (!e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) setNavDir("push");
  }} />;
}
