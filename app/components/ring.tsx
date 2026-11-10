import { useEffect, useRef, useState, type ReactNode } from "react";

// The ring of the 今天 hero (01b §6.5, 02 §2.3-2): this week's run so far against the plan. r=40, stroke 10, from 12 o'clock clockwise.
// (at 0 the arc is not drawn: a round cap of no length is still a dot.) It grows 400 ms from the value it last showed (0 on a first visit): `lastRingPct` is a module-level memory, never stored.
const R = 40;
const C = 2 * Math.PI * R;
const lastRingPct = new Map<string, number>();

export function Ring({ value, max, complete, size = 96, label, ringKey, children }: { value: number; max: number; complete: boolean; size?: number; label: string; /** What the value belongs to (the week's start), so the ring starts from what it showed last time. */ ringKey?: string; children?: ReactNode }) {
  // over 100 % is still one circle; a complete week is closed all the way round
  const pct = complete ? 1 : max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const [shown, setShown] = useState(() => (ringKey != null ? lastRingPct.get(ringKey) ?? 0 : 0));
  const latest = useRef(pct);
  useEffect(() => { latest.current = pct; });
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  useEffect(() => () => { if (ringKey != null) lastRingPct.set(ringKey, latest.current); }, [ringKey]);
  return (
    <div className={`ring${complete ? " done" : ""}`} role="img" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true">
        <circle className="track" cx="48" cy="48" r={R} fill="none" strokeWidth="10" />
        <circle className="arc" cx="48" cy="48" r={R} fill="none" strokeWidth="10" strokeLinecap={complete ? "butt" : "round"} transform="rotate(-90 48 48)" strokeDasharray={C} strokeDashoffset={C * (1 - shown)} style={shown > 0 ? undefined : { opacity: 0 }} />
      </svg>
      <div className="mid">{children}</div>
    </div>
  );
}
