import type {
  ActivitiesResponse,
  ErrorResponse,
  MatchStatus,
  PlanResponse,
  PutReviewRequest,
  PutReviewResponse,
} from "../types/api";
import { clearSession, getIdToken } from "./auth";
import { config, useMock } from "./config";
import { mockActivities, mockPlan } from "../mock/mock";

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

export function getPlan(): Promise<PlanResponse> {
  if (useMock) return Promise.resolve(mockPlan());
  return request<PlanResponse>("/plan");
}

export function getActivities(status?: MatchStatus): Promise<ActivitiesResponse> {
  if (useMock) return Promise.resolve(mockActivities(status));
  return request<ActivitiesResponse>(status ? `/activities?status=${status}` : "/activities");
}

export function putReview(activityId: string, body: PutReviewRequest): Promise<PutReviewResponse> {
  if (useMock) return Promise.reject(new ApiError(501, "mock mode: reviews are read-only"));
  return request<PutReviewResponse>(`/activities/${activityId}/review`, { method: "PUT", body: JSON.stringify(body) });
}
