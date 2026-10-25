import type { ApiSession, SessionType, Verdict } from "../types/api";

/** Colour family for the type avatar. Only these get colour; everything else stays grey. */
export type Kind = "easy" | "long" | "hard" | "race" | "rest";

export interface LabelStyle {
  kind: Kind;
  /** 1–2 characters shown inside the avatar. */
  short: string;
  /** Human label for chips / filters. */
  name: string;
}

const BY_LABEL: Record<string, LabelStyle> = {
  Easy: { kind: "easy", short: "E", name: "Easy" },
  Recovery: { kind: "easy", short: "R", name: "Recovery" },
  Long: { kind: "long", short: "L", name: "Long" },
  "Peak Long": { kind: "long", short: "PL", name: "Peak Long" },
  MP: { kind: "hard", short: "MP", name: "MP" },
  坡跑: { kind: "hard", short: "坡", name: "坡跑" },
  "坡跑+MP": { kind: "hard", short: "坡", name: "坡跑+MP" },
  快步: { kind: "hard", short: "快", name: "快步" },
  走跑Easy: { kind: "easy", short: "走", name: "走跑" },
  走跑Recovery: { kind: "easy", short: "走", name: "走跑" },
  走跑Long: { kind: "long", short: "走", name: "走跑 Long" },
  走跑: { kind: "easy", short: "走", name: "走跑" },
  比賽: { kind: "race", short: "賽", name: "比賽" },
  休息: { kind: "rest", short: "休", name: "休息" },
  完全休息: { kind: "rest", short: "休", name: "完全休息" },
  肌力: { kind: "rest", short: "肌", name: "肌力" },
};

const BY_TYPE: Record<SessionType, LabelStyle> = {
  easy: { kind: "easy", short: "E", name: "Easy" },
  long: { kind: "long", short: "L", name: "Long" },
  tempo: { kind: "hard", short: "T", name: "Tempo" },
  interval: { kind: "hard", short: "I", name: "Interval" },
  race: { kind: "race", short: "賽", name: "比賽" },
  rest: { kind: "rest", short: "休", name: "休息" },
};

const SPORTS: Record<string, { short: string; name: string }> = {
  Run: { short: "跑", name: "跑步" },
  TrailRun: { short: "越", name: "越野跑" },
  VirtualRun: { short: "跑", name: "跑步機" },
  Walk: { short: "走", name: "走路" },
  Hike: { short: "山", name: "健行" },
  Ride: { short: "騎", name: "騎車" },
  VirtualRide: { short: "騎", name: "騎車" },
  Swim: { short: "泳", name: "游泳" },
  WeightTraining: { short: "肌", name: "重訓" },
  Workout: { short: "練", name: "訓練" },
  Crossfit: { short: "練", name: "CrossFit" },
  HighIntensityIntervalTraining: { short: "練", name: "HIIT" },
  Yoga: { short: "瑜", name: "瑜珈" },
};

export function sportName(sport: string | null | undefined): string {
  return (sport && SPORTS[sport]?.name) || "運動";
}

export function labelStyle(session: Pick<ApiSession, "label" | "type"> | null | undefined, sport?: string | null): LabelStyle {
  if (!session) {
    const sp = sport ? SPORTS[sport] : undefined;
    return { kind: "rest", short: sp?.short ?? "動", name: sp?.name ?? "未排課" };
  }
  // A rest day whose note opens with 肌力日 is a strength day: the 肌 ring, not 休.
  if (session.type === "rest" && "note" in session && isStrengthDay(session as Pick<ApiSession, "label" | "type" | "content" | "note">)) return BY_LABEL.肌力;
  return (session.label && BY_LABEL[session.label]) || BY_TYPE[session.type] || BY_TYPE.easy;
}

/** 'MP 7 km', 'Easy 6 km', '肌力': the type name plus planned distance, for one-line rows. */
export function shortName(session: Pick<ApiSession, "label" | "type" | "target_distance_m">): string {
  const name = labelStyle(session).name;
  const m = session.target_distance_m;
  return m ? `${name} ${Math.round(m / 100) / 10} km` : name;
}

const STRENGTH_SPORTS = new Set(["WeightTraining", "Workout", "Crossfit", "HighIntensityIntervalTraining"]);

/** A strength day: typed 肌力 / Hyrox, or a rest day whose note opens with 肌力日. */
export function isStrengthDay(s: Pick<ApiSession, "label" | "type" | "content" | "note">): boolean {
  if (/肌力|重訓|Hyrox/i.test(`${s.label ?? ""} ${s.content ?? ""}`)) return true;
  return s.type === "rest" && /^肌力/.test((s.note ?? "").trim());
}

/** The one-line name of a session: its content when short ('輕鬆跑 6 km'), else type + distance ('坡跑 約 8 km'). */
export function rowName(s: Pick<ApiSession, "label" | "type" | "content" | "note" | "target_distance_m">): string {
  if (s.type === "rest") return isStrengthDay(s) ? (s.label === "肌力" && s.content ? s.content : "肌力日") : s.content ?? s.label ?? "休息";
  const c = (s.content ?? "").replace(/^🏁\s*/, "");
  if (c && !c.includes("+") && !/[，,（(★]/.test(c) && c.length <= 14) return c;
  const approx = s.type === "interval" || /×|秒/.test(c);
  const n = shortName(s);
  return approx ? n.replace(/ (\d)/, " 約 $1") : n;
}

export const isStrengthSport = (sport: string | null | undefined) => !!sport && STRENGTH_SPORTS.has(sport);

export type VerdictKind = "good" | "warn" | "bad" | "skip";

export function verdictKind(v: Verdict | "跳過" | null | undefined): VerdictKind | null {
  switch (v) {
    case "達成": return "good";
    case "達成但有提醒": return "warn";
    case "未達成": return "bad";
    case "跳過": return "skip";
    default: return null;
  }
}
