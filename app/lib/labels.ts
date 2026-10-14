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

export function labelStyle(session: Pick<ApiSession, "label" | "type"> | null | undefined): LabelStyle {
  if (!session) return { kind: "rest", short: "跑", name: "未排課" };
  return (session.label && BY_LABEL[session.label]) || BY_TYPE[session.type] || BY_TYPE.easy;
}

/** Filter groups on the history page, in display order. */
export const FILTERS: { key: string; name: string; kind: Kind | null; match: (s: LabelStyle | null) => boolean }[] = [
  { key: "all", name: "全部", kind: null, match: () => true },
  { key: "easy", name: "Easy", kind: "easy", match: (s) => s?.kind === "easy" },
  { key: "long", name: "Long", kind: "long", match: (s) => s?.kind === "long" },
  { key: "hard", name: "MP", kind: "hard", match: (s) => s?.kind === "hard" },
];

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
