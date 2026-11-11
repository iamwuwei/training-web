import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRevalidator } from "react-router";
import type { ApiActivity, ApiSession } from "../types/api";
import { getPlan, putSession } from "../lib/api";
import { linkErrorText } from "../lib/combine";
import { mdDow } from "../lib/date";
import { km } from "../lib/format";
import { shortName, sportName } from "../lib/labels";
import { activityDate, linkOptions, type PlanView } from "../lib/plan";
import { BottomSheet } from "./sheet";
import { Avatar } from "./ui";

/**
 * False once the page no longer offers the activity (it is bound now, or gone). The sheet keeps drawing its last content while it
 * slides out, so the body cannot learn this from its props; it reads it here instead (and says nothing more while it leaves).
 */
const Offered = createContext(true);

/**
 * The activities whose bind is on its way. Outside the component on purpose: the sheet may be closed (02 §3.4 ⑥ allows it) and opened again before the
 * answer is back, and the new body must not send the same pick a second time (the api does not treat a repeated PUT as a no-op: it judges again).
 */
const inFlight = new Set<string>();
const watchers = new Set<() => void>();
const setFlying = (id: string, on: boolean) => { if (on) inFlight.add(id); else inFlight.delete(id); watchers.forEach((f) => f()); };
const watchFlying = (f: () => void) => { watchers.add(f); return () => void watchers.delete(f); };

/**
 * 算成哪一堂: the open sessions around an unassigned activity (the week it was run in, the one before and the one after); pick one,
 * then 算成這堂 binds it (PUT …/session with only the session id: no replace, no append). `activity` is the activity as the page has it NOW,
 * or null once it is bound or gone: the sheet closes by itself then, which is also how a lost answer (the api did bind it) ends.
 * `onLinked` runs after a successful bind, once the sheet has been told to close: the page puts the focus where the opener was (02 §3.5).
 */
export function LinkSheet({ open, activity, view, onClose, onLinked }: { open: boolean; activity: ApiActivity | null; view: PlanView; onClose: () => void; onLinked?: (s: ApiSession) => void }) {
  // the page reloaded and this activity is bound (or gone): the page's "wants to open" ends too, so unbinding later does not open it again
  useEffect(() => { if (open && !activity) onClose(); }, [open, activity, onClose]);
  return (
    <Offered.Provider value={!!activity}>
      <BottomSheet open={open && !!activity} onClose={onClose} label="算成哪一堂" className="link-sheet">
        {activity ? <LinkBody key={activity.id} activity={activity} view={view} onClose={onClose} onLinked={onLinked} /> : null}
      </BottomSheet>
    </Offered.Provider>
  );
}

function LinkBody({ activity, view, onClose, onLinked }: { activity: ApiActivity; view: PlanView; onClose: () => void; onLinked?: (s: ApiSession) => void }) {
  const revalidator = useRevalidator();
  const offered = useContext(Offered);
  const options = useMemo(() => linkOptions(view, activity), [view, activity]);
  const [picked, setPicked] = useState<string | null>(options.preselect);
  const flying = useSyncExternalStore(watchFlying, () => inFlight.has(activity.id), () => false);
  const [done, setDone] = useState(false); // bound: the sheet is on its way out, the button keeps saying 送出中…
  // a failure is told only after the page has looked again (02 §5-3), so it is kept here until then
  const [failure, setFailure] = useState<{ e: unknown } | null>(null);
  // the choice that counts: when the list was refreshed and the picked session left it, nothing is picked (no other is picked for him)
  const sel = options.days.some((d) => d.session.id === picked) ? picked : null;
  // told once the page is in sync again; while it is not, or the sheet is already leaving, the button stays in 送出中…
  const told = failure != null && revalidator.state === "idle" && offered;
  const busy = flying || done || (failure != null && !told);
  const error = told ? linkErrorText(failure.e) : null;

  async function submit() {
    if (!sel || busy || inFlight.has(activity.id)) return;
    setFlying(activity.id, true);
    setFailure(null);
    try {
      await putSession(activity.id, { session_id: sel });
    } catch (e) {
      // look again before saying anything: 409 / 404 mean the list is out of date, and a lost answer means the api did bind it (then the
      // page stops offering this activity and the sheet closes itself). The page is asked only when it can answer: a failed GET inside
      // `revalidate()` is not rejected, it sends the whole app to the error page. One GET to find out, one to reload; never a second PUT.
      const reachable = await getPlan().then(() => true, () => false);
      if (reachable) { try { await revalidator.revalidate(); } catch { /* the sentence below still holds */ } }
      setFailure({ e });
      setFlying(activity.id, false);
      return;
    }
    setDone(true);
    try { await revalidator.revalidate(); } catch { /* it is bound; the page shows it on its next load */ }
    onClose();
    const s = options.days.find((d) => d.session.id === sel)?.session;
    if (s) onLinked?.(s);
    setFlying(activity.id, false);
  }

  const date = mdDow(activityDate(activity));
  const what = activity.distance_m > 0 ? `${km(activity.distance_m)} km` : `${Math.round(activity.moving_time_sec / 60)} 分`;
  return (
    <>
      <div className="lk-head st">
        <h2 className="sheet-title">算成哪一堂</h2>
        <p className="lk-sub">{date} · {sportName(activity.sport_type)} {what}</p>
      </div>
      {options.days.length ? (
        <div className="lk-list" role="radiogroup" aria-label="可以算成的課">
          {options.days.map((d) => (
            <label key={d.session.id} className={`lk-row${d.status === "skipped" ? " skipped" : ""}`}>
              <input type="radio" name="link-session" className="sr-only" checked={sel === d.session.id} disabled={busy}
                onChange={() => { setPicked(d.session.id); setFailure(null); }} />
              <Avatar session={d.session} />
              <span className="txt">
                <span className="t">{shortName(d.session)}</span>
                <span className="s">{mdDow(d.session.scheduled_date)}{d.status === "skipped" ? " · 跳過" : d.status === "today" ? " · 今天" : ""}</span>
              </span>
              <span className="radio" aria-hidden="true" />
            </label>
          ))}
        </div>
      ) : <p className="empty">前後一週沒有空著的課</p>}
      <div className="lk-foot">
        {error ? <p className="err" role="alert">{error}</p> : null}
        <button type="button" className="btn primary" disabled={!sel} aria-disabled={busy || undefined} onClick={() => void submit()}>{busy ? "送出中…" : "算成這堂"}</button>
      </div>
    </>
  );
}
