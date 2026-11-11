import { useState } from "react";
import { putShare } from "../lib/api";
import { SHARE_ROWS } from "../lib/share-summary";
import type { ShareSettings } from "../types/api";

/**
 * 設定 › 隱私 (its own page, 02 §2.6): five switches for what the people of my groups see of me (the same for every group), each row a `<label>` (the whole row
 * switches). A switch saves at once — it flips first, stays disabled until the answer is back, and flips back with 沒有存到，再試一次 under its row if the save fails.
 * `share` lives in the settings layout (the main page's 隱私 row counts the ones that are on); `update` changes it. `inGroups` decides the first sentence.
 */
export function ShareSettingsBody({ share, update, inGroups }: { share: ShareSettings; update: (f: (s: ShareSettings) => ShareSettings) => void; inGroups: boolean }) {
  const [busy, setBusy] = useState<Partial<Record<keyof ShareSettings, boolean>>>({});
  const [failed, setFailed] = useState<Partial<Record<keyof ShareSettings, boolean>>>({});

  async function toggle(key: keyof ShareSettings) {
    if (busy[key]) return;
    const was = share[key];
    update((s) => ({ ...s, [key]: !was }));
    setBusy((b) => ({ ...b, [key]: true }));
    setFailed((f) => ({ ...f, [key]: false }));
    try {
      const res = await putShare({ share: { [key]: !was } });
      update((s) => ({ ...s, [key]: res.share[key] }));
    } catch {
      update((s) => ({ ...s, [key]: was }));
      setFailed((f) => ({ ...f, [key]: true }));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  return (
    <div className="share">
      <p className="sf lead">{inGroups ? "同一個群組的人看得到你打開的項目；你在的每個群組都一樣。" : "你還沒有加入群組。第一次建立或加入群組時，這五項會全部打開，之後隨時可以關。加入前在這裡改過任何一項，或以前加入過群組，就照下面的開關。"}</p>
      <div className="grp">
        {SHARE_ROWS.map((r) => (
          <label key={r.key} className="row tall">
            <div>
              <div className="t" id={`share-${r.key}`}>{r.name}</div>
              <div className="s">{r.desc}</div>
              {r.key === "plan" ? <div className="risk">課表的備註和 Woo 的說明可能寫到調整的原因，例如受傷或出國。</div> : null}
              {r.key === "reviews" ? <div className="risk">Woo 的評論可能提到你寫的心得。</div> : null}
              {failed[r.key] ? <p className="err" role="alert">沒有存到，再試一次</p> : null}
            </div>
            <button type="button" role="switch" className="switch" aria-checked={share[r.key]} aria-labelledby={`share-${r.key}`} disabled={!!busy[r.key]} onClick={() => void toggle(r.key)} />
          </label>
        ))}
      </div>
      <p className="sf">切換就存好，馬上生效（包含以前的）。</p>
      <p className="sf never"><b>永遠不會給別人看：</b>跟 Woo 的對話、週回顧、記住的限制與傷痛、你寫的心得和 RPE、Strava 的原始資料、裝備與天氣、email、你在哪些其他群組。打開「我的課表內容」「Woo 的判定」後，課表備註和 Woo 的評論別人看得到，裡面可能提到傷痛或行程。</p>
    </div>
  );
}
