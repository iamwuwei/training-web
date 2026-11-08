import { useCallback, useEffect, useState } from "react";
import { ApiError, getCoach } from "./api";
import { markWeeklyDirty } from "./use-weekly";
import type { ApiCoachMessage, ApiProposal, ApiWeeklyReview } from "../types/api";

// A weekly review's proposal card and its question live only on its message in Woo's thread (GET /coach), which is paged:
// the newest 100, then 100 before the oldest one seen. The message is looked for page by page, at most JUMP_MAX_PAGES pages
// (600 messages), and not past the review's own `created_at` (the message is written with it, never before it).

/** Messages per page while looking for a weekly message (the api's maximum). */
export const JUMP_PAGE = 100;
/** Pages looked at most, for a sheet and for the thread's jump alike. */
export const JUMP_MAX_PAGES = 6;
const TTL_MS = 60_000;

interface Store {
  at: number;
  pages: number;
  hasMore: boolean;
  oldest: Pick<ApiCoachMessage, "id" | "created_at"> | null;
  /** Every weekly message seen so far, by its review's id. */
  weekly: Map<string, ApiCoachMessage>;
}

let store: Store | null = null;
let chain: Promise<unknown> = Promise.resolve();

const fresh = (): Store => ({ at: Date.now(), pages: 0, hasMore: true, oldest: null, weekly: new Map() });
const current = (): Store => {
  if (!store || Date.now() - store.at > TTL_MS) store = fresh();
  return store;
};

/** Forget what was read (the thread page changed things, or a retry was asked for) and mark the reviews for a new read. */
export function resetWeeklyCaches() {
  store = null;
  markWeeklyDirty();
}

/** The weekly message for a review if it was read in the last minute, else undefined. */
function peekWeeklyMessage(review: Pick<ApiWeeklyReview, "id">): ApiCoachMessage | undefined {
  return store && Date.now() - store.at <= TTL_MS ? store.weekly.get(review.id) : undefined;
}

/** A card was decided in a sheet: every cached copy of it says so, for the next time the sheet opens. */
export function patchProposalStatus(proposalId: string, status: ApiProposal["status"]) {
  if (!store) return;
  for (const [k, m] of store.weekly) if (m.proposal?.id === proposalId) store.weekly.set(k, { ...m, proposal: { ...m.proposal, status } });
}

async function look(review: Pick<ApiWeeklyReview, "id" | "created_at">): Promise<ApiCoachMessage | null> {
  const s = current();
  for (;;) {
    const hit = s.weekly.get(review.id);
    if (hit) return hit;
    if (s.pages > 0 && (!s.hasMore || s.pages >= JUMP_MAX_PAGES || !s.oldest || s.oldest.created_at < review.created_at)) return null;
    let r;
    try {
      r = await getCoach(s.oldest ? { before: s.oldest.id, limit: JUMP_PAGE } : { limit: JUMP_PAGE });
    } catch (e) {
      if (s.oldest && e instanceof ApiError && e.status === 400) return null; // `before` unknown: nothing older to follow, so not found
      throw e;
    }
    s.pages += 1;
    s.hasMore = r.has_more && r.messages.length > 0;
    if (r.messages.length) s.oldest = r.messages[0];
    for (const m of r.messages) if (m.kind === "weekly" && m.weekly_review_id) s.weekly.set(m.weekly_review_id, m);
  }
}

/** The weekly message of a review, from the cache or by looking page by page; null when it is not within the limits (or never was). One look at a time. */
export function findWeeklyMessage(review: Pick<ApiWeeklyReview, "id" | "created_at">): Promise<ApiCoachMessage | null> {
  const run = chain.then(() => look(review));
  chain = run.catch(() => undefined);
  return run;
}

export type WeeklyMessageState = "idle" | "loading" | "ready" | "missing" | "error";

/**
 * Looks for the weekly message of `review` (null: idle). `refresh()` reads it again with the sheet showing the loading state;
 * `refresh({ silent: true })` reads it again behind what is on screen (a card turned stale after a 409).
 */
export function useWeeklyMessage(review: ApiWeeklyReview | null): { message: ApiCoachMessage | null; state: WeeklyMessageState; refresh: (opts?: { silent?: boolean }) => void } {
  const [res, setRes] = useState<{ id: string; state: "ready" | "missing" | "error"; message: ApiCoachMessage | null } | null>(null);
  const [tick, setTick] = useState(0);
  const id = review?.id ?? null;
  const createdAt = review?.created_at ?? null;
  useEffect(() => {
    if (!id || !createdAt) return;
    let live = true;
    findWeeklyMessage({ id, created_at: createdAt })
      .then((m) => { if (live) setRes({ id, state: m ? "ready" : "missing", message: m }); })
      .catch(() => { if (live) setRes({ id, state: "error", message: null }); });
    return () => { live = false; };
  }, [id, createdAt, tick]);
  const refresh = useCallback((opts?: { silent?: boolean }) => {
    store = null; // read from the newest page again: the message may sit on a page that was already passed
    if (!opts?.silent) setRes(null);
    setTick((n) => n + 1);
  }, []);
  if (!review) return { message: null, state: "idle", refresh };
  const cached = peekWeeklyMessage(review); // a card decided in the sheet since is patched there, so the cached copy is the newer one
  if (res && res.id === review.id) return { message: res.state === "ready" ? cached ?? res.message : res.message, state: res.state, refresh };
  return cached ? { message: cached, state: "ready", refresh } : { message: null, state: "loading", refresh };
}
