import type { ApiConstraint } from "../types/api";
import { md } from "./date";

/** "11/21〜23", "到 10/31 為止", "長期": when a constraint holds, as the 記下來 card says it. */
export function periodLabel(c: Pick<ApiConstraint, "start_date" | "end_date">): string {
  const { start_date: a, end_date: b } = c;
  if (a && b) return a === b ? md(a) : `${md(a)}〜${a.slice(5, 7) === b.slice(5, 7) ? Number(b.slice(8, 10)) : md(b)}`;
  if (b) return `到 ${md(b)} 為止`;
  if (a) return `${md(a)} 起`;
  return "長期";
}

/** The settings list's version: "11/21–11/23", "到 10/31", "長期"; "已過期 · 10/31" once the end date has passed. */
export function periodMeta(c: Pick<ApiConstraint, "start_date" | "end_date">, today: string): { text: string; expired: boolean } {
  const { start_date: a, end_date: b } = c;
  if (b && b < today) return { text: `已過期 · ${md(b)}`, expired: true };
  if (a && b) return { text: a === b ? md(a) : `${md(a)}–${md(b)}`, expired: false };
  if (b) return { text: `到 ${md(b)}`, expired: false };
  if (a) return { text: `${md(a)} 起`, expired: false };
  return { text: "長期", expired: false };
}
