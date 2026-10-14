// All "days" in the app are Japan calendar days, independent of the viewer's time zone.

const JST = "Asia/Tokyo";
const DOW = ["日", "一", "二", "三", "四", "五", "六"];

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: JST, year: "numeric", month: "2-digit", day: "2-digit" });

/** 'YYYY-MM-DD' of an instant, in JST. */
export function toJstDate(d: Date | string): string {
  return ymd.format(typeof d === "string" ? new Date(d) : d);
}

export function todayJst(now: Date = new Date()): string {
  return toJstDate(now);
}

function utcMs(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

/** Whole days from `from` to `to` ('YYYY-MM-DD' both). */
export function dayDiff(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

export function addDays(iso: string, n: number): string {
  return new Date(utcMs(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

/** '10/14', '10/08' */
export function md(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${iso.slice(8, 10)}`;
}

/** '週三' */
export function dow(iso: string): string {
  return `週${DOW[new Date(utcMs(iso)).getUTCDay()]}`;
}

/** '10/14 週三' */
export function mdDow(iso: string): string {
  return `${md(iso)} ${dow(iso)}`;
}

/** '今天' / '明天' / '2 天後' / '3 天前' relative to `today`. */
export function relativeDay(iso: string, today: string): string {
  const n = dayDiff(today, iso);
  if (n === 0) return "今天";
  if (n === 1) return "明天";
  if (n === -1) return "昨天";
  return n > 0 ? `${n} 天後` : `${-n} 天前`;
}
