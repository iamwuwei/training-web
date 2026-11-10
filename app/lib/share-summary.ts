import type { ShareSettings } from "../types/api";

/** The five switches of 設定 › 隱私: what the people of my groups see of me. Order is the order on the page. */
export const SHARE_ROWS: { key: keyof ShareSettings; name: string; desc: string }[] = [
  { key: "progress", name: "進度彙總", desc: "本週計畫幾公里、幾堂和你完成多少、整體進度、最長一次" },
  { key: "events", name: "完成事件", desc: "消息中心裡「你完成了○○」那一則和判定標籤" },
  { key: "plan", name: "我的課表內容", desc: "每週的課、配速、備註" },
  { key: "runs", name: "每趟跑步詳情", desc: "距離、時間、配速、心拍、每公里分段" },
  { key: "reviews", name: "Woo 的判定", desc: "判定、提醒和 Woo 的評論全文" },
];

/**
 * The 隱私 row's one line on the settings page: how many of the five switches are on right now. Someone in no group yet has no say yet to count: the api
 * cannot tell "never set" from "set, and these happen to be on", and the first create or join turns all five on, so the row says that.
 */
export function shareSummary(share: ShareSettings, inGroups: boolean): string {
  if (!inGroups) return "第一次加入時全部打開";
  const on = SHARE_ROWS.filter((r) => share[r.key]).length;
  return on === SHARE_ROWS.length ? "5 項都開著" : on === 0 ? "都關著" : `${on} 項開著`;
}
