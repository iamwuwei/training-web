import type { MeResponse, ShareSettings } from "../types/api";

/** What the settings layout hands to its sub pages (Outlet context): the loader's data, and the share switches as one state the main page's summary also reads. */
export interface SettingsContext {
  me: MeResponse;
  /** "ok": `share` is set; "missing": an api from before 群組 (the 隱私 row is left out); "error": it could not be read. */
  shareState: "ok" | "missing" | "error";
  share: ShareSettings | null;
  inGroups: boolean;
  /** A switch changed (or was put back): the next value from the last one. */
  updateShare: (f: (s: ShareSettings) => ShareSettings) => void;
  /** The layout's loader again (after unlinking Strava, or the 再試一次 of an unreadable share block). */
  reload: () => Promise<void>;
}
