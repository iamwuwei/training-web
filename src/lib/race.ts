/** Race day in Japan Standard Time (YYYY-MM-DD). */
export const RACE_DAY = '2026-12-14'

/** Today's date in JST as YYYY-MM-DD, regardless of the viewer's time zone. */
export function todayJst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Whole days from today (JST) until the given YYYY-MM-DD date. */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const target = Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  )
  const today = todayJst(now)
  const base = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  )
  return Math.round((target - base) / 86_400_000)
}
