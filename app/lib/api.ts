import type {
  ActivitiesResponse,
  DeleteStravaResponse,
  ErrorResponse,
  MatchStatus,
  MeResponse,
  PlanResponse,
  PutMemoRequest,
  PutMemoResponse,
  PutReviewRequest,
  PutReviewResponse,
  PutSessionRequest,
  PutSessionResponse,
  CoachResponse,
  DetailOptionsResponse,
  PutDetailsRequest,
  PutDetailsResponse,
  PostAdjustmentRequest,
  PostAdjustmentResponse,
  PostCoachMessageRequest,
  PostCoachMessageResponse,
  PostCheckinPickRequest,
  PostCheckinPickResponse,
  PostCheckinResetResponse,
  PostConstraintResponse,
  PostProposalResponse,
  PostWeeklyAskRequest,
  PostWeeklyAskResponse,
  PostRoutineRequest,
  PostRoutineResponse,
  PutRoutineRequest,
  PutRoutineResponse,
  PutCoachSeenResponse,
  RereviewResponse,
  WeeklyResponse,
} from "../types/api";
import { clearSession, getIdToken } from "./auth";
import { config, useMock } from "./config";

// The mock is loaded only when VITE_API_URL is empty, so the production bundle
// never ships its demo data (Rollup splits a dynamic import into its own chunk).
const mock = () => import("../mock/mock");

/** 401: API Gateway rejected the token. 403: token fine, but this account is not in the users table. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const SERVER_ERROR = "伺服器錯誤，稍後再試";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new ApiError(401, "unauthorized");

  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(`${config.apiUrl}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearSession();
    throw new ApiError(401, "unauthorized");
  }
  if (!res.ok) {
    // 5xx bodies can carry pg / SDK / model error text; the UI never shows those.
    if (res.status >= 500) throw new ApiError(res.status, SERVER_ERROR);
    let message = res.statusText;
    try { message = ((await res.json()) as ErrorResponse).error ?? message; } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export function getMe(): Promise<MeResponse> {
  if (useMock) return mock().then((m) => m.mockMe());
  return request<MeResponse>("/me");
}

export function disconnectStrava(): Promise<DeleteStravaResponse> {
  if (useMock) return Promise.resolve({ ok: true });
  return request<DeleteStravaResponse>("/me/strava", { method: "DELETE" });
}

export function getPlan(): Promise<PlanResponse> {
  if (useMock) return mock().then((m) => m.mockPlan());
  return request<PlanResponse>("/plan");
}

export function getActivities(status?: MatchStatus): Promise<ActivitiesResponse> {
  if (useMock) return mock().then((m) => m.mockActivities(status));
  return request<ActivitiesResponse>(status ? `/activities?status=${status}` : "/activities");
}

/** The athlete's own note + RPE. A Claude-written review is regenerated afterwards (a few seconds). */
export function putMemo(activityId: string, body: PutMemoRequest): Promise<PutMemoResponse> {
  if (useMock) return mock().then((m) => m.mockPutMemo(activityId, body));
  return request<PutMemoResponse>(`/activities/${activityId}/memo`, { method: "PUT", body: JSON.stringify(body) });
}

/** Which planned session an activity fulfils (+ memo/RPE in the same call). The coach review is generated afterwards. */
export function putSession(activityId: string, body: PutSessionRequest): Promise<PutSessionResponse> {
  if (useMock) return mock().then((m) => m.mockPutSession(activityId, body));
  return request<PutSessionResponse>(`/activities/${activityId}/session`, { method: "PUT", body: JSON.stringify(body) });
}

export function putReview(activityId: string, body: PutReviewRequest): Promise<PutReviewResponse> {
  if (useMock) return Promise.reject(new ApiError(501, "mock mode: reviews are read-only"));
  return request<PutReviewResponse>(`/activities/${activityId}/review`, { method: "PUT", body: JSON.stringify(body) });
}

/** The athlete's own shoe / device / weather for one activity ("" or null clears it). Does not touch the memo or the review. */
export function putActivityDetails(activityId: string, body: PutDetailsRequest): Promise<PutDetailsResponse> {
  if (useMock) return mock().then((m) => m.mockPutDetails(activityId, body));
  return request<PutDetailsResponse>(`/activities/${encodeURIComponent(activityId)}/details`, { method: "PUT", body: JSON.stringify(body) });
}

/** Shoe / device names this athlete used before, for the editor's suggestions. */
export function getDetailOptions(): Promise<DetailOptionsResponse> {
  if (useMock) return mock().then((m) => m.mockDetailOptions());
  return request<DetailOptionsResponse>("/activities/detail-options");
}

/** Drop the coach's (failed or stale) review and queue a fresh one. */
export function rereview(activityId: string): Promise<RereviewResponse> {
  if (useMock) return mock().then((m) => m.mockRereview(activityId));
  return request<RereviewResponse>(`/activities/${activityId}/rereview`, { method: "POST" });
}

/** Weekly coach reviews with their adjustment proposals, newest first. */
export function getWeekly(): Promise<WeeklyResponse> {
  if (useMock) return mock().then((m) => m.mockWeekly());
  return request<WeeklyResponse>("/weekly");
}

/** Apply or dismiss one proposal. Apply rewrites that planned session; reload /plan afterwards. */
export function postAdjustment(weeklyId: string, index: number, body: PostAdjustmentRequest): Promise<PostAdjustmentResponse> {
  if (useMock) return mock().then((m) => m.mockPostAdjustment(weeklyId, index, body));
  return request<PostAdjustmentResponse>(`/weekly/${weeklyId}/adjustments/${index}`, { method: "POST", body: JSON.stringify(body) });
}

/**
 * Answer the weekly review's question about a key session without a record.
 * synced: nothing changes; skipped: the session is marked skipped and the review is
 * regenerated in place a few seconds later (poll getCoach for the message's `weekly.updated`).
 */
export function postWeeklyAsk(weeklyId: string, sessionId: string, body: PostWeeklyAskRequest): Promise<PostWeeklyAskResponse> {
  if (useMock) return mock().then((m) => m.mockPostWeeklyAsk(weeklyId, sessionId, body));
  return request<PostWeeklyAskResponse>(`/weekly/${encodeURIComponent(weeklyId)}/asks/${encodeURIComponent(sessionId)}`, { method: "POST", body: JSON.stringify(body) });
}

/**
 * Apply (every change at once) or dismiss one of Woo's proposal cards in chat. Woo posts a
 * confirmation line on apply, and the other cards of an A／B group come back in `superseded`;
 * reload /plan and the thread afterwards. 409 = the plan changed since: the card is now `stale`.
 */
export function postProposal(proposalId: string, action: "apply" | "dismiss"): Promise<PostProposalResponse> {
  if (useMock) return mock().then((m) => m.mockPostProposal(proposalId, action));
  return request<PostProposalResponse>(`/proposals/${encodeURIComponent(proposalId)}/${action}`, { method: "POST" });
}

/**
 * Woo's "記下來" card: accept stores the constraint (it goes into every later briefing), dismiss
 * drops it. The settings page's 刪除 is the same dismiss call on an active one.
 */
export function postConstraint(constraintId: string, action: "accept" | "dismiss"): Promise<PostConstraintResponse> {
  if (useMock) return mock().then((m) => m.mockPostConstraint(constraintId, action));
  return request<PostConstraintResponse>(`/constraints/${encodeURIComponent(constraintId)}/${action}`, { method: "POST" });
}

/**
 * The coach's thread, oldest first: the newest `limit` messages (the api's default is 10, max 100), or
 * with `before` (a message id) the `limit` messages older than it. `has_more`: older ones exist.
 */
export function getCoach(opts: { limit?: number; before?: string } = {}): Promise<CoachResponse> {
  if (useMock) return mock().then((m) => m.mockCoach(opts));
  const q = new URLSearchParams();
  if (opts.limit != null) q.set("limit", String(opts.limit));
  if (opts.before) q.set("before", opts.before);
  const qs = q.toString();
  return request<CoachResponse>(qs ? `/coach?${qs}` : "/coach");
}

/** A chip on Woo's check-in: which activity (or session) it was, or none. */
export function postCheckinPick(checkinId: string, body: PostCheckinPickRequest): Promise<PostCheckinPickResponse> {
  if (useMock) return mock().then((m) => m.mockPostCheckinPick(checkinId, body));
  return request<PostCheckinPickResponse>(`/coach/checkins/${checkinId}/pick`, { method: "POST", body: JSON.stringify(body) });
}

/** 選錯了 / 重新選: the pick is undone and Woo asks again (a new open check-in). */
export function postCheckinReset(checkinId: string): Promise<PostCheckinResetResponse> {
  if (useMock) return mock().then((m) => m.mockPostCheckinReset(checkinId));
  return request<PostCheckinResetResponse>(`/coach/checkins/${checkinId}/reset`, { method: "POST" });
}

/** 肌力 day: ask Woo for the checklist (home / gym). Pending until the worker writes it; poll getPlan. */
export function postRoutine(sessionId: string, body: PostRoutineRequest): Promise<PostRoutineResponse> {
  if (useMock) return mock().then((m) => m.mockPostRoutine(sessionId, body));
  return request<PostRoutineResponse>(`/sessions/${sessionId}/routine`, { method: "POST", body: JSON.stringify(body) });
}

/** Tick items, set RPE / note, complete the checklist (Woo posts one line). */
export function putRoutine(sessionId: string, body: PutRoutineRequest): Promise<PutRoutineResponse> {
  if (useMock) return mock().then((m) => m.mockPutRoutine(sessionId, body));
  return request<PutRoutineResponse>(`/sessions/${sessionId}/routine`, { method: "PUT", body: JSON.stringify(body) });
}

/** The thread was opened: clears `coach_unread` on the next GET /plan. */
export function putCoachSeen(): Promise<PutCoachSeenResponse> {
  if (useMock) return mock().then((m) => m.mockPutCoachSeen());
  return request<PutCoachSeenResponse>("/coach/seen", { method: "PUT" });
}

/**
 * Say something to the coach; the reply arrives later on getCoach (poll while the message is pending).
 * With `answer_to` it answers Woo's open question: the feel question (with `rpe`), or the
 * mismatch question with `confirm_match` (true: the pick stands; false: same as a check-in reset).
 * With `re_propose` (a stale proposal's id) it is 請 Woo 重看: he sends a new card against today's plan.
 */
export function postCoachMessage(body: PostCoachMessageRequest): Promise<PostCoachMessageResponse> {
  if (useMock) return mock().then((m) => m.mockPostCoachMessage(body));
  return request<PostCoachMessageResponse>("/coach/messages", { method: "POST", body: JSON.stringify(body) });
}
