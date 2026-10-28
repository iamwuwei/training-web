import { useEffect, useMemo, useState } from "react";
import { getCoach, getWeekly } from "./api";
import type { ApiProposal, ApiWeek } from "../types/api";

/**
 * One of Woo's proposal cards by id, found in his thread (the preview page needs it; there is
 * no per-proposal endpoint). `ready` is false while it loads; `proposal` is null when it is not
 * in the thread (or the thread could not be read).
 */
export function useProposal(id: string | null): { proposal: ApiProposal | null; ready: boolean } {
  const [found, setFound] = useState<{ id: string; proposal: ApiProposal | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    getCoach({ limit: 100 })
      .then((r) => { if (live) setFound({ id, proposal: r.messages.find((m) => m.proposal?.id === id)?.proposal ?? null }); })
      .catch(() => { if (live) setFound({ id, proposal: null }); });
    return () => { live = false; };
  }, [id]);
  if (!id) return { proposal: null, ready: true };
  return found?.id === id ? { proposal: found.proposal, ready: true } : { proposal: null, ready: false };
}

/**
 * The weeks (week_no) that already have a weekly review, for previewing a 補課: it counts in its original week
 * unless that week's review is written (then in the week it moves to). Only fetched when `on`; `ready` is false
 * while it loads. A failed read gives an empty set (= "not reviewed yet", the original week).
 */
export function useReviewedWeeks(on: boolean, weeks: ApiWeek[]): { reviewed: ReadonlySet<number>; ready: boolean } {
  const [starts, setStarts] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    getWeekly()
      .then((r) => { if (live) setStarts(new Set(r.reviews.map((x) => x.week_start))); })
      .catch(() => { if (live) setStarts(new Set()); });
    return () => { live = false; };
  }, [on]);
  const reviewed = useMemo(() => new Set(weeks.filter((w) => starts?.has(w.week_start)).map((w) => w.week_no)), [starts, weeks]);
  return { reviewed, ready: !on || starts != null };
}
