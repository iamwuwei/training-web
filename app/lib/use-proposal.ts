import { useEffect, useState } from "react";
import { getCoach } from "./api";
import type { ApiProposal } from "../types/api";

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
