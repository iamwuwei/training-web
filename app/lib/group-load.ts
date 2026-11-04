import { redirect } from "react-router";
import { ApiError } from "./api";
import { hasSession } from "./auth";

/**
 * What a 群組 route's loader hands its page: the data, "this is not a group of yours" (404: unknown, disbanded, removed — one answer),
 * or a failed read. A 401 is the login redirect like everywhere else. `http` is the status of a failed read (0: no answer at all);
 * on the list page a 404 means the api has not got this feature yet.
 */
export type GroupLoad<T> = { status: "ok"; data: T } | { status: "notfound" } | { status: "error"; http: number };

export async function loadGroupData<T>(read: () => Promise<T>): Promise<GroupLoad<T>> {
  if (!hasSession()) throw redirect("/login");
  try {
    return { status: "ok", data: await read() };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) throw redirect("/login");
      // 404: not a group of yours. 400: the id in the address is not even an id (the api checks the shape first): the same page
      if (e.status === 404 || e.status === 400) return { status: "notfound" };
      return { status: "error", http: e.status };
    }
    return { status: "error", http: 0 };
  }
}
