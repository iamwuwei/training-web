import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

// While the coach's review is being written, reload the route data: every 5 s for the
// first minute, then every 15 s, and stop after 3 minutes. Returns whether we gave up.
export function useReviewPolling(waiting: boolean): { timedOut: boolean; restart: () => void } {
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
      timer = window.setTimeout(tick, elapsed < 60_000 ? 5_000 : 15_000);
    };
    timer = window.setTimeout(tick, 5_000);
    return () => window.clearTimeout(timer);
  }, [waiting, round, revalidate]);

  return { timedOut: waiting && gaveUpRound === round, restart: () => setRound((n) => n + 1) };
}
