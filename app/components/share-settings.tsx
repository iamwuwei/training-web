import { useState } from "react";
import { putShare } from "../lib/api";
import type { ShareSettings } from "../types/api";
import { Fold } from "./fold";

const ROWS: { key: keyof ShareSettings; name: string; desc: string }[] = [
  { key: "progress", name: "進度彙總", desc: "本週計畫幾公里、幾堂和你完成多少、整體進度、最長一次" },
  { key: "events", name: "完成事件", desc: "消息中心裡「你完成了○○」那一則和判定標籤" },
  { key: "plan", name: "我的課表內容", desc: "每週的課、配速、備註" },
  { key: "runs", name: "每趟跑步詳情", desc: "距離、時間、配速、心拍、每公里分段" },
  { key: "reviews", name: "Woo 的判定", desc: "判定、提醒和 Woo 的評論全文" },
];

/**
 * The folded row's one line: how many of the five switches are on right now. Someone in no group yet has no say yet to count: the api
 * cannot tell "never set" from "set, and these happen to be on", and the first create or join turns all five on, so the row says that.
 */
function shareSummary(share: ShareSettings, inGroups: boolean): string {
  if (!inGroups) return "第一次加入時全部打開";
  const on = ROWS.filter((r) => share[r.key]).length;
  return on === ROWS.length ? "5 項都開著" : on === 0 ? "都關著" : `${on} 項開著`;
}

/**
 * 設定 ·「隱私」(a Fold, folded by default; the page owns `open`): five switches for what the people of my groups see of me (the same for every group). A switch saves
 * at once — it flips first, stays disabled until the answer is back, and flips back with 沒有存到，再試一次 under its row if
 * the save fails. `inGroups` decides the first sentence and the folded row's line. The switches stay mounted while folded (their state is not lost), and the
 * folded row shows the count of the ones that are on.
 */
export function ShareSettingsSection({ initial, inGroups, open, onToggle }: { initial: ShareSettings; inGroups: boolean; open: boolean; onToggle: () => void }) {
  const [share, setShare] = useState(initial);
  const [busy, setBusy] = useState<Partial<Record<keyof ShareSettings, boolean>>>({});
  const [failed, setFailed] = useState<Partial<Record<keyof ShareSettings, boolean>>>({});

  async function toggle(key: keyof ShareSettings) {
    const was = share[key];
    setShare((s) => ({ ...s, [key]: !was }));
    setBusy((b) => ({ ...b, [key]: true }));
    setFailed((f) => ({ ...f, [key]: false }));
    try {
      const res = await putShare({ share: { [key]: !was } });
      setShare((s) => ({ ...s, [key]: res.share[key] }));
    } catch {
      setShare((s) => ({ ...s, [key]: was }));
      setFailed((f) => ({ ...f, [key]: true }));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  return (
    <Fold id="share" title="隱私" summary={shareSummary(share, inGroups)} open={open} onToggle={onToggle}>
      <div className="share">
        <p className="share-intro">{inGroups ? "同一個群組的人看得到你打開的項目；你在的每個群組都一樣。" : "你還沒有加入群組。第一次建立或加入群組時，這五項會全部打開，之後隨時可以關。加入前在這裡改過任何一項，或以前加入過群組，就照下面的開關。"}</p>
        {ROWS.map((r) => (
          <div key={r.key} className="share-row">
            <div>
              <div className="t" id={`share-${r.key}`}>{r.name}</div>
              <div className="s">{r.desc}</div>
              {r.key === "plan" ? <div className="risk">課表的備註和 Woo 的說明可能寫到調整的原因，例如受傷或出國。</div> : null}
              {r.key === "reviews" ? <div className="risk">Woo 的評論可能提到你寫的心得。</div> : null}
              {failed[r.key] ? <p className="err" role="alert">沒有存到，再試一次</p> : null}
            </div>
            <button type="button" role="switch" className="switch" aria-checked={share[r.key]} aria-labelledby={`share-${r.key}`} disabled={!!busy[r.key]} onClick={() => void toggle(r.key)} />
          </div>
        ))}
        <p className="share-note">切換就存好：關掉之後，群組裡的人下一次打開就看不到了（包含以前的）；打開也一樣馬上生效。</p>
        <div className="share-never"><b>永遠不會給別人看：</b>跟 Woo 的對話、週回顧、記住的限制與傷痛、你寫的心得和 RPE、Strava 的原始資料、裝備與天氣、email、你在哪些其他群組。打開「我的課表內容」「Woo 的判定」後，課表備註和 Woo 的評論別人看得到，裡面可能提到傷痛或行程。</div>
      </div>
    </Fold>
  );
}
