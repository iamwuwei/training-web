import { useState } from "react";
import type { ApiActivity } from "../types/api";
import { ApiError, putMemo } from "../lib/api";

const RPE_WORDS: Record<number, string> = { 1: "很輕鬆", 3: "輕鬆", 5: "適中", 7: "吃力", 9: "很吃力", 10: "極限" };
export const rpeWord = (n: number | null | undefined) => (n ? RPE_WORDS[n] ?? RPE_WORDS[n - 1] ?? "" : "");

/** RPE 1–10 buttons + the free-text box. Controlled; the parent owns state and saving. */
export function MemoFields({ memo, rpe, onMemo, onRpe }: { memo: string; rpe: number | null; onMemo: (v: string) => void; onRpe: (v: number | null) => void }) {
  return (
    <>
      <div className="rpe-k">今天跑起來的感受（RPE）{rpe ? ` · ${rpe} ${rpeWord(rpe)}` : ""}</div>
      <div className="rpe" role="group" aria-label="RPE 1 到 10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" aria-pressed={rpe === n} onClick={() => onRpe(rpe === n ? null : n)}>{n}</button>
        ))}
      </div>
      <div className="rpe-scale"><span>很輕鬆</span><span>適中</span><span>極限</span></div>
      <textarea
        value={memo}
        onChange={(e) => onMemo(e.target.value)}
        maxLength={4000}
        placeholder="身體狀況、哪一段最累、配速感覺、天氣路線、下次想試什麼…"
        aria-label="心得"
      />
    </>
  );
}

/**
 * 我的心得：the athlete's own note + RPE on one activity. Saves through PUT …/memo and
 * hands the updated activity back; the parent decides whether to poll for a new review.
 */
export function MemoEditor({ activity, onSaved }: { activity: ApiActivity; onSaved: (a: ApiActivity) => void }) {
  const [editing, setEditing] = useState(!activity.memo && activity.rpe == null);
  const [memo, setMemo] = useState(activity.memo ?? "");
  const [rpe, setRpe] = useState<number | null>(activity.rpe);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The parent mounts this with key={activity.id}, so a different report starts fresh.
  function startEditing() {
    setMemo(activity.memo ?? "");
    setRpe(activity.rpe);
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await putMemo(activity.id, { memo: memo.trim() || null, rpe });
      onSaved(res.activity);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "儲存失敗，再試一次");
    } finally {
      setBusy(false);
    }
  }

  const claudeReview = activity.review?.source === "claude" || !activity.review;

  if (!editing) {
    return (
      <section className="memo">
        <div className="head">
          <h2>我的心得</h2>
          <button type="button" className="chip" onClick={startEditing}>編輯</button>
        </div>
        <p className="body">
          {activity.rpe ? <span className="rpe-chip">RPE {activity.rpe}<span style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 500, color: "var(--ink-2)" }}> {rpeWord(activity.rpe)}</span></span> : null}
          {activity.memo ?? <span className="placeholder">（只有感受，沒寫文字）</span>}
        </p>
      </section>
    );
  }

  return (
    <section className="memo">
      <div className="head">
        <h2>我的心得</h2>
        {activity.memo || activity.rpe != null ? <button type="button" className="chip" onClick={() => { setMemo(activity.memo ?? ""); setRpe(activity.rpe); setEditing(false); }}>取消</button> : null}
      </div>
      <MemoFields memo={memo} rpe={rpe} onMemo={setMemo} onRpe={setRpe} />
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || (!memo.trim() && rpe == null)}>
          {busy ? "儲存中…" : "儲存"}
        </button>
      </div>
      {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
      <p className="hint">{claudeReview ? "存檔後教練判定會參考這段心得重新評一次，幾秒後更新。" : "這筆是手動判定，心得只記錄，不會改變判定。"}</p>
    </section>
  );
}
