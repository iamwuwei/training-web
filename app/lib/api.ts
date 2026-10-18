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
  PostAdjustmentRequest,
  PostAdjustmentResponse,
  PostCoachMessageRequest,
  PostCoachMessageResponse,
  RereviewResponse,
  WeeklyResponse,
} from "../types/api";
import { clearSession, getIdToken } from "./auth";
import { config, useMock } from "./config";
import { mockActivities, mockCoach, mockMe, mockPlan, mockPostAdjustment, mockPostCoachMessage, mockPutMemo, mockPutSession, mockRereview, mockWeekly } from "../mock/mock";

/** 401: API Gateway rejected the token. 403: token fine, but this account is not in the users table. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

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
    let message = res.statusText;
    try { message = ((await res.json()) as ErrorResponse).error ?? message; } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export function getMe(): Promise<MeResponse> {
  if (useMock) return Promise.resolve(mockMe());
  return request<MeResponse>("/me");
}

export function disconnectStrava(): Promise<DeleteStravaResponse> {
  if (useMock) return Promise.resolve({ ok: true });
  return request<DeleteStravaResponse>("/me/strava", { method: "DELETE" });
}

export function getPlan(): Promise<PlanResponse> {
  if (useMock) return Promise.resolve(mockPlan());
  return request<PlanResponse>("/plan");
}

export function getActivities(status?: MatchStatus): Promise<ActivitiesResponse> {
  if (useMock) return Promise.resolve(mockActivities(status));
  return request<ActivitiesResponse>(status ? `/activities?status=${status}` : "/activities");
}

/** The athlete's own note + RPE. A Claude-written review is regenerated afterwards (a few seconds). */
export function putMemo(activityId: string, body: PutMemoRequest): Promise<PutMemoResponse> {
  if (useMock) return Promise.resolve(mockPutMemo(activityId, body));
  return request<PutMemoResponse>(`/activities/${activityId}/memo`, { method: "PUT", body: JSON.stringify(body) });
}

/** Which planned session an activity fulfils (+ memo/RPE in the same call). The coach review is generated afterwards. */
export function putSession(activityId: string, body: PutSessionRequest): Promise<PutSessionResponse> {
  if (useMock) return Promise.resolve(mockPutSession(activityId, body));
  return request<PutSessionResponse>(`/activities/${activityId}/session`, { method: "PUT", body: JSON.stringify(body) });
}

export function putReview(activityId: string, body: PutReviewRequest): Promise<PutReviewResponse> {
  if (useMock) return Promise.reject(new ApiError(501, "mock mode: reviews are read-only"));
  return request<PutReviewResponse>(`/activities/${activityId}/review`, { method: "PUT", body: JSON.stringify(body) });
}

/** Drop the coach's (failed or stale) review and queue a fresh one. */
export function rereview(activityId: string): Promise<RereviewResponse> {
  if (useMock) return Promise.resolve(mockRereview(activityId));
  return request<RereviewResponse>(`/activities/${activityId}/rereview`, { method: "POST" });
}

/** Weekly coach reviews with their adjustment proposals, newest first. */
export function getWeekly(): Promise<WeeklyResponse> {
  if (useMock) return Promise.resolve(mockWeekly());
  return request<WeeklyResponse>("/weekly");
}

/** Apply or dismiss one proposal. Apply rewrites that planned session; reload /plan afterwards. */
export function postAdjustment(weeklyId: string, index: number, body: PostAdjustmentRequest): Promise<PostAdjustmentResponse> {
  if (useMock) return Promise.resolve(mockPostAdjustment(weeklyId, index, body));
  return request<PostAdjustmentResponse>(`/weekly/${weeklyId}/adjustments/${index}`, { method: "POST", body: JSON.stringify(body) });
}

/** The coach's thread, oldest first. */
export function getCoach(): Promise<CoachResponse> {
  if (useMock) return Promise.resolve(mockCoach());
  return request<CoachResponse>("/coach");
}

/** Say something to the coach; the reply arrives later on getCoach (poll while the message is pending). */
export function postCoachMessage(body: PostCoachMessageRequest): Promise<PostCoachMessageResponse> {
  if (useMock) return Promise.resolve(mockPostCoachMessage(body));
  return request<PostCoachMessageResponse>("/coach/messages", { method: "POST", body: JSON.stringify(body) });
}
