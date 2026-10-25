import { redirect } from "react-router";

// The 紀錄 tab is gone; old links and bookmarks land on the today dashboard.
// Loader-only route module: the redirect always fires, so there is nothing to render.

export function clientLoader() {
  throw redirect("/");
}
