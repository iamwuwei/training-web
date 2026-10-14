/** metres → '6.01' / '12' / '30.5' (up to two decimals, trailing zeros dropped). */
export function km(m: number | null | undefined, decimals = 2): string {
  if (m == null) return "–";
  return (m / 1000).toFixed(decimals).replace(/\.?0+$/, "");
}

/** Planned totals: one decimal at most ('423.2', '36'). */
export function kmPlan(m: number | null | undefined): string {
  return km(m, 1);
}

/** seconds per km → '7:25' */
export function pace(sec: number | null | undefined): string {
  if (!sec) return "–";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** '7:15–7:45' from min/max sec per km; falls back to one value or '–'. */
export function paceRange(min: number | null, max: number | null): string {
  if (min && max && min !== max) return `${pace(min)}–${pace(max)}`;
  return pace(min ?? max);
}

/** seconds → '44:36' or '1:31:07' */
export function duration(sec: number | null | undefined): string {
  if (sec == null) return "–";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function int(n: number | null | undefined): string {
  return n == null ? "–" : String(Math.round(n));
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}
