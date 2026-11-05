import { Link } from "react-router";
import type { ApiActivity, ApiSession } from "../types/api";
import { combine, groupBySession, type Combined } from "../lib/combine";
import { md, mdDow } from "../lib/date";
import { duration, int, km, pace } from "../lib/format";
import { labelStyle, rowName, shortName } from "../lib/labels";
import { activityDate, isRunSport, lastReminderFor, movedCountsIn, type PlanView } from "../lib/plan";
import { segmentRows } from "../lib/segments";
import { BottomSheet } from "./sheet";
import { Avatar, CoachAvatar, VerdictTag } from "./ui";
import { WooVerdict } from "./woo-verdict";

/** The plan's Easy pace band ('7:15〜7:45'), for the warm-up / cool-down rows of a composite session. */
function easyTarget(view: PlanView): string | null {
  const t = view.data.sessions.find((s) => s.label === "Easy" && s.target)?.target ?? null;
  return t ? t.split("/")[0].trim() : null;
}

/** The newest run of the same type before this session: its primary activity, `c` the session's recordings added up. */
export function lastOfKind(view: PlanView, session: ApiSession): { a: ApiActivity; s: ApiSession; c: Combined } | null {
  const name = labelStyle(session).name;
  const byId = new Map(view.data.sessions.map((s) => [s.id, s]));
  const runs = [...groupBySession(view.data.activities)]
    .map(([sessionId, group]) => ({ c: combine(group), s: byId.get(sessionId) }))
    .filter((x) => x.s && x.s.id !== session.id && activityDate(x.c.primary) < session.scheduled_date && labelStyle(x.s).name === name)
    .map((x) => ({ a: x.c.primary, s: x.s as ApiSession, c: x.c }))
    .sort((x, y) => y.a.start_time.localeCompare(x.a.start_time));
  return runs[0] ?? null;
}

/**
 * `readOnly`: this is another member's plan (群組 → 大家的課表). Nothing in the sheet can change anything or lead to a report:
 * the same how-to-run, Woo's line and note, plus the actual numbers when his `runs` is on and the verdict when his `reviews` is on.
 */
export interface SheetReadOnly { name: string; runs: boolean; reviews: boolean }

/** 課表細節: how to run it, Woo's one line, the full note, the last session of this kind. */
export function SessionSheet({ session, view, onClose, onOpen, readOnly }: { session: ApiSession | null; view: PlanView; onClose: () => void; /** Swap the sheet to another session (an 已改期 row's 看 11/17 那堂 ›). */ onOpen?: (s: ApiSession) => void; readOnly?: SheetReadOnly }) {
  const s = session;
  const rows = s ? segmentRows(s, easyTarget(view)) : [];
  const woo = s ? (readOnly ? s.brief : lastReminderFor(view, s) ?? s.brief) : null;
  const last = s && !readOnly ? lastOfKind(view, s) : null;
  const day = s && readOnly ? view.days.find((d) => d.session.id === s.id) ?? null : null;
  const done = day?.combined ?? null;
  const review = readOnly?.reviews ? day?.activity?.review ?? null : null;
  const isRest = s?.type === "rest";
  // 補課: the row that was moved away says where it went; the new row says where it came from. N only when it counts in another week than the row's own.
  const movedTo = s?.moved_to_date ? view.data.sessions.find((x) => x.id === s.moved_to_session_id) ?? null : null;
  const countsIn = !s ? null : s.moved_to_date ? movedCountsIn(view, s) : s.moved_from_date ? s.counts_in_week_no : null;
  const n = countsIn != null && countsIn !== s?.week_no ? countsIn : null;
  return (
    <BottomSheet open={!!s} onClose={onClose} label="課表細節" className={readOnly ? "event-sheet" : undefined}>
      {s ? (
        <>
          <div className={`ss-head${s.moved_to_date ? " moved" : ""}`}>
            <Avatar session={s} />
            <div>
              <div className="t">{rowName(s)}</div>
              <div className="s">{[mdDow(s.scheduled_date), s.week_no != null ? `第 ${s.week_no} 週` : null, s.phase, readOnly ? `${readOnly.name} 的課表` : null].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          {s.moved_to_date ? (
            <div className="ss-moved">
              <span>這堂沒跑，改到 {mdDow(s.moved_to_date)}補{n ? `，算在第 ${n} 週` : ""}。</span>
              {movedTo && onOpen ? <button type="button" className="go" onClick={() => onOpen(movedTo)}>看 {md(movedTo.scheduled_date)} 那堂 ›</button> : null}
            </div>
          ) : s.moved_from_date ? (
            <div className="ss-moved"><span>補 {mdDow(s.moved_from_date)}的課{n ? ` · 算在第 ${n} 週` : ""}</span></div>
          ) : null}
          {!isRest && rows.length ? (
            <>
              <h2 className="section-h">怎麼跑</h2>
              <div className="ss-rows">
                {rows.map((r, i) => (
                  <div key={i} className="ss-row">
                    <b className="num">{r.head}</b>
                    <span className="b">{r.body}</span>
                    <span className="r">{r.right}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {woo ? <div className="wooline"><CoachAvatar size={20} /><span>{woo}</span></div> : null}
          {s.note ? (
            <>
              <h2 className="section-h">備註</h2>
              <p className="ss-note">{s.note}</p>
            </>
          ) : null}
          {done ? (
            <>
              <h2 className="section-h">實際</h2>
              <div className="es-stats ss-actual">
                {isRunSport(done.sport_type) || done.distance_m > 0 ? <span><b className="num">{km(done.distance_m)}</b> km</span> : <span><b className="num">{duration(done.moving_time_sec)}</b></span>}
                {isRunSport(done.sport_type) && done.avg_pace_sec_km ? <span><b className="num">{pace(done.avg_pace_sec_km)}</b> /km</span> : null}
                {done.avg_hr != null ? <span><b className="num">{int(done.avg_hr)}</b> bpm</span> : null}
              </div>
            </>
          ) : null}
          {review ? <WooVerdict review={review} /> : null}
          {last ? (
            <>
              <h2 className="section-h">上次這類課</h2>
              <Link to={`/activities/${last.a.id}`} className="ss-last" onClick={onClose}>
                <Avatar session={last.s} />
                <span className="txt">
                  <span className="l1"><b>{mdDow(activityDate(last.a))}</b> <span>{shortName(last.s)}</span></span>
                  <span className="l2">
                    {isRunSport(last.a.sport_type) ? <><b className="num">{km(last.c.distance_m)}</b> km <b className="num">{pace(last.c.avg_pace_sec_km)}</b> /km</> : <b className="num">{duration(last.c.moving_time_sec)}</b>}
                    {last.c.avg_hr != null ? <> <b className="num">{int(last.c.avg_hr)}</b> bpm</> : null}
                  </span>
                </span>
                <VerdictTag verdict={last.a.review?.verdict} />
              </Link>
            </>
          ) : null}
          {readOnly ? <p className="sheet-foot">這是 {readOnly.name} 的課表，只能看。</p> : null}
        </>
      ) : null}
    </BottomSheet>
  );
}
