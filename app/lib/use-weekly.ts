import { useEffect, useState } from "react";
import { getWeekly } from "./api";
import { addDays } from "./date";
import type { ApiWeek, ApiWeeklyReview } from "../types/api";

// The weekly reviews (GET /weekly, newest first) for the entries on 課表 and 今天. One answer is kept for 60 seconds so
// moving between the two pages does not ask again; after the thread page was visited (it changes reviews: 沒跑 rewrites one,
// a card is decided) or a decision was made in a sheet, the kept answer is shown at once and read again behind it.

const TTL_MS = 60_000;
let kept: { at: number; reviews: ApiWeeklyReview[]; dirty: boolean } | null = null;
/** Every page that shows the reviews (the page and its sheet each ask): a new answer reaches all of them. */
const listeners = new Set<(reviews: ApiWeeklyReview[]) => void>();

/** The kept answer is out of date (something changed a review): the next page that asks shows it and reads it again. */
export function markWeeklyDirty() {
  if (kept) kept.dirty = true;
}

/** The weeks of the plan that a review's 7 days (`week_start`…+6) hold the first day of: the api's own question "is there a review whose 7 days hold this day". */
const holds = (r: Pick<ApiWeeklyReview, "week_start">, day: string) => r.week_start <= day && addDays(r.week_start, 6) >= day;

/** The review for a plan week, or null; `reviews` is newest first, so `find` is the latest one. */
export function reviewForWeek(week: Pick<ApiWeek, "week_start">, reviews: ApiWeeklyReview[]): ApiWeeklyReview | null {
  return reviews.find((r) => holds(r, week.week_start)) ?? null;
}

/** The plan week a review is about (the first one that starts inside its 7 days), or null. */
export function weekOfReview(r: Pick<ApiWeeklyReview, "week_start">, weeks: ApiWeek[]): ApiWeek | null {
  return weeks.find((w) => holds(r, w.week_start)) ?? null;
}

/** The number of the plan week a review is about, or null. */
export function weekNoOfReview(r: Pick<ApiWeeklyReview, "week_start">, weeks: ApiWeek[]): number | null {
  return weekOfReview(r, weeks)?.week_no ?? null;
}

/** Read /weekly again and hand the answer to every page showing the reviews; a failed read keeps what they show. */
export async function refreshWeekly(): Promise<void> {
  try {
    const r = await getWeekly();
    kept = { at: Date.now(), reviews: r.reviews, dirty: false };
    for (const l of listeners) l(r.reviews);
  } catch {
    for (const l of listeners) l(kept?.reviews ?? []);
  }
}

let reading: Promise<void> | null = null;

/**
 * Start reading /weekly unless the kept answer is fresh (or a read is already on its way) and return that read. The `_app` loader
 * calls this next to /plan, so the 週回顧 entries get their answer at about the same time as the page's data and are not a
 * late arrival that pushes the page down; it is not waited for, a slow /weekly still comes in late. The pages call it too (a no-op then).
 */
export function ensureWeekly(): Promise<void> {
  if (kept && !kept.dirty && Date.now() - kept.at < TTL_MS) return Promise.resolve();
  if (!reading) reading = refreshWeekly().finally(() => { reading = null; });
  return reading;
}

/**
 * The reviews of the active plan, newest first. A failed read leaves the last answer or an empty list
 * (no entry, no error: the entries are only a shortcut).
 */
export function useWeeklyReviews(): { reviews: ApiWeeklyReview[] } {
  const [reviews, setReviews] = useState<ApiWeeklyReview[]>(() => kept?.reviews ?? []);
  useEffect(() => {
    listeners.add(setReviews);
    void ensureWeekly();
    return () => { listeners.delete(setReviews); };
  }, []);
  return { reviews };
}
