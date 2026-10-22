import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import type { ApiRoutine, ApiSession } from "../types/api";
import { ApiError, postRoutine, putRoutine } from "../lib/api";
import { useReviewPolling } from "../lib/use-review-polling";
import { BottomSheet } from "./sheet";
import { Avatar, CoachAvatar } from "./ui";

// 肌力 day on the today page: one line, Woo asks where (home / gym), then his
// checklist. Ticks are saved as they happen; when every item is ticked (or the
// athlete taps 先結束) a sheet asks for RPE and one line, and 完成肌力 closes it.
// The sheet pops again on the next visit until it is completed.

const RPE_WORDS = ["", "很輕鬆", "輕鬆", "輕鬆", "適中", "適中", "適中", "有點累", "累", "很累", "極限"];
const skipKey = (id: string) => `strength-skip-${id}`;

function readSkip(id: string): boolean {
  try { return localStorage.getItem(skipKey(id)) === "1"; } catch { return false; }
}
function writeSkip(id: string, v: boolean) {
  try { if (v) localStorage.setItem(skipKey(id), "1"); else localStorage.removeItem(skipKey(id)); } catch { /* private mode */ }
}

/** The condition line under the title: the brief, else the note minus its 肌力日 prefix, first clause only. */
function conditionLine(s: ApiSession): string | null {
  if (s.brief) return s.brief;
  const n = (s.note ?? "").replace(/^肌力日[：:]\s*/, "").trim();
  if (!n) return null;
  return n.split(/[。！？!?]/)[0];
}

export function StrengthDay({ session, routine, title }: { session: ApiSession; routine: ApiRoutine | null; title: string }) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(() => readSkip(session.id));
  const [open, setOpen] = useState<number | null>(null); // which item's "how" is shown
  const [done, setDone] = useState<boolean[] | null>(null); // optimistic ticks
  const [sheet, setSheet] = useState(false);
  const [sheetDismissed, setSheetDismissed] = useState(false);
  const [rpe, setRpe] = useState<number | null>(routine?.rpe ?? null);
  const [note, setNote] = useState(routine?.note ?? "");

  const pending = routine?.status === "pending";
  useReviewPolling(pending);

  const items = routine?.items ?? [];
  const ticks = done && done.length === items.length ? done : items.map((i) => i.done);
  const nDone = ticks.filter(Boolean).length;
  const allDone = items.length > 0 && nDone === items.length;
  const completed = !!routine?.completed_at;

  // Every item ticked and not yet completed: the sheet opens by itself (until closed once this visit).
  const sheetOpen = sheet || (allDone && !completed && !sheetDismissed);

  async function run<T>(f: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await f();
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 503 ? "資料庫還在啟動，幾秒後再按一次" : e.message) : "送出失敗，再試一次");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function choose(place: "home" | "gym", regenerate = false) {
    await run(async () => { await postRoutine(session.id, { place, regenerate }); await revalidator.revalidate(); });
  }
  async function tick(idx: number) {
    const next = ticks.map((d, i) => (i === idx ? !d : d));
    setDone(next);
    try {
      await putRoutine(session.id, { done: next });
    } catch (e) {
      setDone(null);
      setError(e instanceof ApiError ? e.message : "儲存失敗，再點一次");
    }
  }
  async function complete() {
    const ok = await run(async () => {
      await putRoutine(session.id, { done: ticks, rpe, note: note.trim() || null, complete: true });
      await revalidator.revalidate();
      return true;
    });
    if (ok) { setSheet(false); void navigate("/coach"); }
  }

  const head = (
    <article className="post strength-head">
      <Avatar session={session} />
      <div className="body">
        <p className="t">{title}</p>
        {conditionLine(session) ? <p className="sub">{conditionLine(session)}</p> : null}
      </div>
    </article>
  );

  if (completed && routine) {
    return (
      <div className="strength-day">
        {head}
        <div className="strength-done">
          <div className="stats big"><span><b className="num">{nDone}/{items.length}</b> 項</span>{routine.minutes ? <span><b className="num">{routine.minutes}</b> 分</span> : null}{routine.rpe ? <span><b className="num">{routine.rpe}</b> RPE</span> : null}</div>
          {routine.note ? <p className="memo-line">{routine.note}</p> : null}
          <div className="wooline"><CoachAvatar size={20} badge="check" /><span>做完了，Woo 在教練頁留了一句。</span></div>
        </div>
      </div>
    );
  }

  if (!routine || routine.status === "failed") {
    return (
      <div className="strength-day">
        {head}
        <div className="strength-ask">
          {skipped ? (
            <p className="hint">今天跳過了。<button type="button" className="link" onClick={() => { writeSkip(session.id, false); setSkipped(false); }}>改變主意 ›</button></p>
          ) : (
            <>
              <div className="wooline"><CoachAvatar size={20} /><span>今天在家還是去健身房？我照備註開一份菜單。</span></div>
              <div className="chips-row">
                <button type="button" className="chip" aria-pressed="true" disabled={busy} onClick={() => void choose("home")}>在家</button>
                <button type="button" className="chip" disabled={busy} onClick={() => void choose("gym")}>健身房</button>
                <button type="button" className="chip" disabled={busy} onClick={() => { writeSkip(session.id, true); setSkipped(true); }}>今天跳過</button>
              </div>
              {routine?.status === "failed" ? <p className="hint">上一份沒開成{routine.error ? `（${routine.error}）` : ""}，再選一次。</p> : null}
            </>
          )}
          {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="strength-day">
        {head}
        <div className="strength-ask"><div className="wooline"><CoachAvatar size={20} badge="typing" /><span>Woo 在開菜單，幾秒就好…</span></div></div>
      </div>
    );
  }

  return (
    <div className="strength-day">
      {head}
      <div className="routine">
        {routine.rules ? <p className="rules">{routine.rules}</p> : null}
        <ul className="items">
          {items.map((it, i) => (
            <li key={i} className={ticks[i] ? "done" : ""}>
              <label>
                <input type="checkbox" checked={ticks[i]} onChange={() => void tick(i)} />
                <span className="box" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 7" /></svg></span>
                <span className="name">{it.name}</span>
              </label>
              {it.how ? <button type="button" className={`how${open === i ? " on" : ""}`} aria-label="怎麼做" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>?</button> : null}
              {open === i && it.how ? <p className="howtext">{it.how}</p> : null}
            </li>
          ))}
        </ul>
        <div className="foot">
          <span><CoachAvatar size={18} />Woo 開的菜單 · <button type="button" className="link" disabled={busy} onClick={() => void choose(routine.place, true)}>換一份</button></span>
          <button type="button" className="link" onClick={() => setSheet(true)}>先結束 ›</button>
        </div>
        {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
      </div>
      <BottomSheet open={sheetOpen} onClose={() => { setSheet(false); setSheetDismissed(true); }} label="完成肌力">
        <div className="done-head">
          <CoachAvatar size={36} badge={allDone ? "check" : null} />
          <div><div className="t">{allDone ? `${items.length} 項都做完了` : `做了 ${nDone} / ${items.length} 項`}</div><div className="s">{[title.replace(/^今天肌力日\s*·?\s*/, "") || "肌力", routine.minutes ? `${routine.minutes} 分` : null].filter(Boolean).join(" · ")}</div></div>
        </div>
        <div className="rpe-k">累的程度{rpe ? ` · ${rpe} ${RPE_WORDS[rpe]}` : ""}</div>
        <div className="rpe" role="group" aria-label="RPE 1 到 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" aria-pressed={rpe === n} onClick={() => setRpe(rpe === n ? null : n)}>{n}</button>
          ))}
        </div>
        <div className="rpe-scale"><span>很輕鬆</span><span>適中</span><span>極限</span></div>
        <input type="text" className="oneline" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="一句話（選填）：臀橋第三組大腿有抖…" aria-label="一句話" />
        <button type="button" className="btn primary" disabled={busy} onClick={() => void complete()}>{busy ? "送出中…" : "完成肌力"}</button>
        {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
        <p className="sheet-foot">關掉沒填的話，下次打開會再跳一次</p>
      </BottomSheet>
    </div>
  );
}
