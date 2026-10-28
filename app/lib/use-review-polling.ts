import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

// While the coach's review is being written, reload the route data: every 5 s for the
// first minute, then every 15 s, and stop after 3 minutes. Returns whether we gave up.
// `fast` (a reply to the athlete is on its way, Woo's stage text should keep up): every 2 s for
// the first 90 s, then every 5 s; the 3 minutes stay.
export function useReviewPolling(waiting: boolean, fast = false): { timedOut: boolean; restart: () => void } {
  const { revalidate } = useRevalidator();
  const [round, setRound] = useState(0);
  const [gaveUpRound, setGaveUpRound] = useState(-1);

  useEffect(() => {
    if (!waiting) return;
    const startedAt = Date.now();
    let timer = 0;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= 180_000) { setGaveUpRound(round); return; }
      void revalidate();
      timer = window.setTimeout(tick, fast ? (elapsed < 90_000 ? 2_000 : 5_000) : elapsed < 60_000 ? 5_000 : 15_000);
    };
    timer = window.setTimeout(tick, fast ? 2_000 : 5_000);
    return () => window.clearTimeout(timer);
  }, [waiting, fast, round, revalidate]);

  return { timedOut: waiting && gaveUpRound === round, restart: () => setRound((n) => n + 1) };
}
