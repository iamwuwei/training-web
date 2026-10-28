import type { ApiActivity } from "../types/api";
import { duration } from "./format";
import { isRunSport } from "./plan";

// The report's bottom block: what the activity carried (Strava) and what the athlete says
// about it, in groups instead of one grey line. Pure: the page draws whatever comes back.

export interface GearRow {
  k: string;
  v: string;
  /** 這趟: the number goes in `v`, its unit here ("W"), so it can be drawn as a big number with a small unit. */
  unit?: string;
  icon?: "shoe" | "watch" | "weather";
  /** 裝備: the athlete's own value is shown over Strava's ("鞋 · 手動"). */
  edited?: boolean;
}
export interface GearGroup { title: "這趟" | "裝備" | "天氣"; rows: GearRow[] }

const text = (v: string | null | undefined) => v?.trim() || null;

/**
 * Groups of rows for one activity; a missing value leaves no row, a group with no rows is left out,
 * nothing at all gives []. 這趟 is the Strava numbers (time, top heart rate, power, energy);
 * 裝備 and 天氣 are the shown values (`gear_name`, `device_name`, `weather`: the athlete's, else Strava's).
 */
export function gearGroups(a: ApiActivity): GearGroup[] {
  const stats: GearRow[] = [];
  // The time is the page's big number when there is no distance: do not say it twice.
  if (a.moving_time_sec > 0 && (isRunSport(a.sport_type) || a.distance_m > 0)) stats.push({ k: "時間", v: duration(a.moving_time_sec) });
  if (a.max_hr != null) stats.push({ k: "最高心拍", v: String(Math.round(a.max_hr)), unit: "bpm" });
  if (a.avg_watts != null && a.avg_watts > 0) stats.push({ k: "功率", v: String(Math.round(a.avg_watts)), unit: "W" });
  if (a.kcal != null && a.kcal > 0) stats.push({ k: "熱量", v: String(Math.round(a.kcal)), unit: "kcal" });

  const gear: GearRow[] = [];
  const shoe = text(a.gear_name), device = text(a.device_name);
  if (shoe) gear.push({ k: "鞋", v: shoe, icon: "shoe", edited: a.details?.gear_name.source === "user" });
  if (device) gear.push({ k: "裝置", v: device, icon: "watch", edited: a.details?.device_name.source === "user" });

  const weather = text(a.weather);
  const groups: GearGroup[] = [
    { title: "這趟", rows: stats },
    { title: "裝備", rows: gear },
    { title: "天氣", rows: weather ? [{ k: "天氣", v: weather, icon: "weather" }] : [] },
  ];
  return groups.filter((g) => g.rows.length > 0);
}
