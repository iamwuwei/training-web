import { useEffect, useId, useRef, useState } from "react";
import { getDetailOptions, putActivityDetails } from "../lib/api";
import type { ApiActivity, DetailOptionsResponse, PutDetailsRequest } from "../types/api";
import { BottomSheet } from "./sheet";

// 報告頁「裝備」旁的「編輯 ›」: the athlete's own shoe, device and weather for this one activity.
// Their value is shown over Strava's; clearing it goes back to Strava's (weather: to nothing).
// Nothing here changes the review, the memo or Woo's thread.

type Key = "gear_name" | "device_name" | "weather";
const FIELDS: { key: Key; label: string; placeholder: string }[] = [
  { key: "gear_name", label: "鞋", placeholder: "例：Nike Pegasus 41" },
  { key: "device_name", label: "裝置", placeholder: "例：Apple Watch Series 11" },
  { key: "weather", label: "天氣", placeholder: "例：晴 18°C、陰有風" },
];
const MAX = 40;
/** What the api stores: one line, single spaces, no ends. */
const clean = (v: string) => v.replace(/\s+/g, " ").trim();

function DetailsForm({ activity, onClose, onSaved }: { activity: ApiActivity; onClose: () => void; onSaved: (a: ApiActivity) => void }) {
  const uid = useId();
  const initial: Record<Key, string> = { gear_name: activity.gear_name ?? "", device_name: activity.device_name ?? "", weather: activity.weather ?? "" };
  const [vals, setVals] = useState(initial);
  const [options, setOptions] = useState<DetailOptionsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const refs = useRef<Partial<Record<Key, HTMLInputElement | null>>>({});
  // Room under the last box while one has focus (so it can scroll above the keyboard). It is taken
  // away 0.5 s after the blur, not at once: tapping 儲存 blurs the box first, and a sheet that shrinks
  // between touch-down and touch-up moves the button out from under the finger.
  const [room, setRoom] = useState(false);
  const roomTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(roomTimer.current), []);

  // Suggestions are a nicety: when they do not load there are none, and nothing is said.
  useEffect(() => {
    let live = true;
    getDetailOptions().then((o) => { if (live) setOptions(o); }).catch(() => { /* no suggestions */ });
    return () => { live = false; };
  }, []);

  // Strava's own value (the api's `details`); an older api without it counts as "Strava has none".
  const strava = (k: Key) => activity.details?.[k]?.strava ?? null;
  const changed = FIELDS.filter((f) => clean(vals[f.key]) !== clean(initial[f.key]));

  async function save() {
    if (!changed.length || busy) return;
    setBusy(true);
    setError(false);
    // only what changed; empty, or the same as Strava's, clears the athlete's value
    const body: PutDetailsRequest = {};
    for (const f of changed) {
      const v = clean(vals[f.key]);
      body[f.key] = v === "" || v === strava(f.key) ? null : v;
    }
    try {
      const res = await putActivityDetails(activity.id, body);
      onSaved(res.activity);
      onClose();
    } catch {
      setError(true); // one line whatever went wrong; the typed values stay
    } finally {
      setBusy(false);
    }
  }

  function focusIn(el: HTMLInputElement) {
    // the keyboard takes ~300 ms to come up: then put the box in the middle of what is left
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => { if (document.activeElement === el) el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); }, 300);
  }

  return (
    <>
      {room ? <span className="ds-room" /> : null}
      <h2 className="sheet-title">裝備與天氣</h2>
      <p className="ds-sub">只改這一趟；Strava 那邊不會變。</p>
      {FIELDS.map((f) => {
        const v = vals[f.key];
        const s = strava(f.key);
        const isWeather = f.key === "weather";
        const showClear = isWeather ? clean(v) !== "" : clean(v) !== (s ?? "");
        const hint = isWeather ? null : s == null ? "Strava 沒有這項" : clean(v) === s ? `Strava：${s}` : `清除後回到：${s}`;
        const sug = f.key === "weather" ? [] : (options?.[f.key] ?? []).filter((n) => n !== clean(v));
        const id = `${uid}-${f.key}`;
        return (
          <div className="ds-field" key={f.key}>
            <div className="ds-label">
              <label htmlFor={id}>{f.label}</label>
              {showClear ? <button type="button" className="ds-clear" disabled={busy} onClick={() => setVals({ ...vals, [f.key]: isWeather ? "" : s ?? "" })}>清除</button> : null}
            </div>
            <input
              id={id} ref={(el) => { refs.current[f.key] = el; }}
              type="text" className="oneline" value={v} maxLength={MAX} placeholder={f.placeholder} disabled={busy}
              autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="done"
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              onFocus={(e) => { window.clearTimeout(roomTimer.current); setRoom(true); focusIn(e.currentTarget); }}
              onBlur={() => { window.clearTimeout(roomTimer.current); roomTimer.current = window.setTimeout(() => setRoom(false), 500); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); } }}
            />
            {hint || v.length >= 30 ? (
              <div className="ds-hint">
                <span>{hint}</span>
                {v.length >= 30 ? <span className={`ds-count${v.length >= MAX ? " max" : ""}`}>{v.length}/{MAX}</span> : null}
              </div>
            ) : null}
            {sug.length ? (
              <div className="ds-sug">
                <span className="k">用過的</span>
                {sug.map((n) => (
                  <button key={n} type="button" className="chip" disabled={busy} onClick={() => { setVals({ ...vals, [f.key]: n }); refs.current[f.key]?.focus(); }}>{n}</button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="ds-error" role="alert">儲存失敗，再試一次</p> : null}
      <div className="ds-actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="btn primary" disabled={busy || !changed.length} onClick={() => void save()}>{busy ? "儲存中…" : "儲存"}</button>
      </div>
    </>
  );
}

/** `onSaved` gets the activity the api returns (with the new shown values and `details`). */
export function DetailsSheet({ open, onClose, activity, onSaved }: { open: boolean; onClose: () => void; activity: ApiActivity; onSaved: (a: ApiActivity) => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="裝備與天氣" className="details-sheet">
      <DetailsForm activity={activity} onClose={onClose} onSaved={onSaved} />
    </BottomSheet>
  );
}
