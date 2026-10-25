import { redirect } from "react-router";

// The 紀錄 tab is gone; old links and bookmarks land on the today dashboard.

export function clientLoader() {
  throw redirect("/");
}

export default function History() {
  return null;
}
