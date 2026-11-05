// Small pieces shared by the 群組 pages: the fixed sentences, the countdown, how a member's dashboard row is classified.
// The sentences live here once so every page says them the same way (01b §6 固定句).

import type { ApiGroup, ApiGroupMember } from "../types/api";
import { ApiError, getGroup } from "./api";
import { dayDiff, dow, timeJst, toJstDate } from "./date";

/** People per group (the api's GROUP_MAX_MEMBERS); the join page has only `member_count` to go with it. */
export const MAX_MEMBERS = 5;

/** One sentence for "you are in the maximum number of groups": the disabled ＋, a 409 on create, the join page. */
export const limitText = (max: number) => `已經有 ${max} 個群組了，先離開一個才能再建立或加入`;
export const LIMIT_TEXT = limitText(3);

export const SEND_FAILED = "送出失敗，再試一次";
export const NOTICE_GONE = (name: string) => `你已經不在「${name}」裡了。`;

export const isStatus = (e: unknown, status: number): e is ApiError => e instanceof ApiError && e.status === status;

/**
 * A 404 on an action inside a group says "group not found" or "member not found" (the api's two sentences, which the page never
 * shows or parses). Which one it was is read from the status of the group itself: gone → true, still there → false (the member was).
 * A read that fails some other way counts as "still there": the page then reads again and shows its own failure.
 */
export async function groupIsGone(id: string): Promise<boolean> {
  try {
    await getGroup(id);
    return false;
  } catch (e) {
    return isStatus(e, 404);
  }
}

/** Days to the race as the pages show it: a number, 比賽日, or 已完賽. */
export function countdown(raceDate: string, today: string): { kind: "days"; n: number } | { kind: "today" } | { kind: "done" } {
  const n = dayDiff(today, raceDate);
  return n > 0 ? { kind: "days", n } : n === 0 ? { kind: "today" } : { kind: "done" };
}

/** '11/1' (the day is not padded: the 群組 pages write dates the short way). */
export const mdPlain = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
/** '11/1 週日' */
export const mdDowPlain = (iso: string) => `${mdPlain(iso)} ${dow(iso)}`;

/** 今天 07:41 · 昨天 19:20 · 11/1 10:12 (JST). */
export function eventTime(iso: string, today: string): string {
  const day = toJstDate(iso);
  const diff = dayDiff(day, today);
  const hm = timeJst(iso);
  return diff === 0 ? `今天 ${hm}` : diff === 1 ? `昨天 ${hm}` : `${mdPlain(day)} ${hm}`;
}

/** The six kinds of dashboard row (01 D3). `range_no_week`: inside his plan's range but today is not in a plan week. */
export type MemberRowKind = "week" | "range_no_week" | "ahead" | "finished" | "no_plan" | "hidden";

export function memberRowKind(group: Pick<ApiGroup, "race_date">, m: Pick<ApiGroupMember, "progress">, today: string): MemberRowKind {
  const p = m.progress;
  if (!p) return "hidden";
  if (p.plan_state === "no_plan") return "no_plan";
  if (p.plan_state === "out_of_range") return group.race_date < today ? "finished" : "ahead";
  return p.plan?.week ? "week" : "range_no_week";
}
