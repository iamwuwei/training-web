import { useEffect, useState } from "react";
import { combine, type Combined } from "../lib/combine";
import { timeJst } from "../lib/date";
import { duration, int, km, pace } from "../lib/format";
import { isStatus, mdDowPlain } from "../lib/groups";
import { sharedToActivity } from "../lib/member-plan";
import { fullSplits, splitPace } from "../lib/segments";
import { getGroupEvent } from "../lib/api";
import type { ApiGroupEvent, GroupEventDetailResponse } from "../types/api";
import { BottomSheet } from "./sheet";
import { Avatar } from "./ui";
import { WooPending, WooVerdict } from "./woo-verdict";

type Loaded = { id: string; kind: "ok"; data: GroupEventDetailResponse } | { id: string; kind: "gone" } | { id: string; kind: "error" };

/** The session label is "Long 18 km": the type is the part before the distance (the avatar only needs that). */
const typeOf = (label: string) => label.replace(/\s*[\d.]+\s*km$/i, "");

function Run({ d, name }: { d: GroupEventDetailResponse; name: string }) {
  const parts = (d.segments.length ? d.segments : d.activity ? [d.activity] : []).map((a) => sharedToActivity({ ...a, review: null }));
  if (!parts.length) return null;
  const c: Combined = combine(parts);
  const splits = fullSplits(c.splits);
  return (
    <>
      <div className="es-stats">
        <span><b className="num">{km(c.distance_m)}</b> km</span>
        {c.avg_pace_sec_km ? <span><b className="num">{pace(c.avg_pace_sec_km)}</b> /km</span> : null}
        <span><b className="num">{duration(c.moving_time_sec)}</b> 時間</span>
      </div>
      <div className="es-hr">{c.avg_hr != null ? <>心拍 平均 <b className="num">{int(c.avg_hr)}</b>{c.max_hr != null ? <> · 最高 <b className="num">{int(c.max_hr)}</b></> : null}</> : null}</div>
      {parts.length > 1 ? (
        <section className="es-segs" aria-label={`${name} 的紀錄`}>
          <h2 className="section-h">紀錄 · {parts.length} 段</h2>
          {parts.map((a, i) => (
            <div className="row" key={a.id}>
              <span>{i + 1}</span>
              <span>{timeJst(a.start_time)}</span>
              <span><b className="num">{km(a.distance_m)}</b> km</span>
              <span>{a.avg_pace_sec_km ? <><b className="num">{pace(a.avg_pace_sec_km)}</b> /km</> : "–"}</span>
              <span>{a.avg_hr != null ? <><b className="num">{int(a.avg_hr)}</b> bpm</> : "–"}</span>
            </div>
          ))}
        </section>
      ) : null}
      {splits.length ? (
        <section className="es-splits" aria-label="每公里">
          <h2 className="section-h">每公里</h2>
          <div className="row head"><span>km</span><span>配速</span><span>心拍</span></div>
          {splits.map((sp, i) => (
            <div className="row" key={i}>
              <span className="d">{i + 1}</span>
              <span><b className="num">{pace(splitPace(sp))}</b></span>
              <span>{sp.average_heartrate != null ? <b className="num">{int(sp.average_heartrate)}</b> : "–"}</span>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}

/**
 * 看詳細 of a 完成了 event: what its actor lets the group see of that run (his `runs`) and of Woo's verdict (his `reviews`),
 * with a fixed sentence for each part he keeps to himself. 404 = the event is not visible any more (he switched it off or left):
 * one sentence and 關閉, which asks the list to load again.
 */
export function GroupEventSheet({ groupId, event, onClose }: { groupId: string; event: ApiGroupEvent | null; onClose: (reload: boolean) => void }) {
  const [res, setRes] = useState<Loaded | null>(null);
  const id = event?.id;
  useEffect(() => {
    if (!id) return;
    let live = true;
    getGroupEvent(groupId, id)
      .then((data) => { if (live) setRes({ id, kind: "ok", data }); })
      .catch((e: unknown) => { if (live) setRes(isStatus(e, 404) ? { id, kind: "gone" } : { id, kind: "error" }); });
    return () => { live = false; };
  }, [groupId, id]);

  const cur = res && res.id === id ? res : null;
  const e = event;
  const name = e?.member.display_name ?? "";
  const gone = cur?.kind === "gone";
  return (
    <BottomSheet open={!!e} onClose={() => onClose(gone)} label="動態詳情" className="event-sheet">
      {e && e.session ? (
        <>
          <div className="es-head st">
            {/* the event carries only its label ("Long 18 km"), not the session's type: the colour comes from the label, and a label the app does not know gets the Easy blue on purpose */}
            <Avatar session={{ label: typeOf(e.session.label), type: "easy" }} />
            <div>
              <div className="t">{e.session.label}</div>
              <div className="s">{e.member.is_me ? "你" : name} · {mdDowPlain(e.session.date)}的課</div>
            </div>
          </div>
          {!cur ? (
            <div aria-busy="true" aria-label="載入中" style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>
              <div className="sk" style={{ width: "70%", height: 28 }} />
              <div className="sk" style={{ width: "100%", height: 64 }} />
            </div>
          ) : cur.kind === "gone" ? (
            <>
              <p className="es-none" role="status">這則動態已經看不到了。</p>
              <div className="actions-row center"><button type="button" className="btn compact" onClick={() => onClose(true)}>關閉</button></div>
            </>
          ) : cur.kind === "error" ? (
            <p className="es-none" role="alert">讀不到詳情，關掉再開一次。</p>
          ) : (
            <Detail d={cur.data} name={name} />
          )}
        </>
      ) : null}
    </BottomSheet>
  );
}

function Detail({ d, name }: { d: GroupEventDetailResponse; name: string }) {
  const { shared } = d;
  if (!shared.runs && !shared.reviews) return <p className="es-none">{name} 沒有分享這趟的詳情。</p>;
  return (
    <>
      {shared.runs ? <Run d={d} name={name} /> : <p className="es-off">{name} 沒有分享這趟的跑步詳情。</p>}
      {shared.reviews
        ? d.review ? <WooVerdict review={d.review} /> : d.event.session?.judging ? <WooPending /> : <WooVerdict review={{ verdict: null, reminders: [], comment: null, source: "claude", failed: true, created_at: d.event.created_at, corrected_at: null }} />
        : <p className="es-off">{name} 沒有分享 Woo 的判定。</p>}
    </>
  );
}
