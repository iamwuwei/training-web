import type {
  ActivitiesResponse,
  AppleLoginRequest,
  ErrorResponse,
  LoginResponse,
  MatchStatus,
  MeResponse,
  PlanResponse,
  PutReviewRequest,
  PutReviewResponse,
} from "../types/api";
import { clearSession, getToken } from "./auth";
import { config, useMock } from "./config";
import { mockActivities, mockPlan } from "../mock/mock";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(`${base}${path}`, { ...init, headers });
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

const api = <T>(path: string, init?: RequestInit) => request<T>(config.apiUrl, path, init);
const auth = <T>(path: string, init?: RequestInit) => request<T>(config.authUrl, path, init);

export function getPlan(): Promise<PlanResponse> {
  if (useMock) return Promise.resolve(mockPlan());
  return api<PlanResponse>("/plan");
}

export function getActivities(status?: MatchStatus): Promise<ActivitiesResponse> {
  if (useMock) return Promise.resolve(mockActivities(status));
  return api<ActivitiesResponse>(status ? `/activities?status=${status}` : "/activities");
}

export function putReview(activityId: string, body: PutReviewRequest): Promise<PutReviewResponse> {
  if (useMock) return Promise.reject(new ApiError(501, "mock mode: reviews are read-only"));
  return api<PutReviewResponse>(`/activities/${activityId}/review`, { method: "PUT", body: JSON.stringify(body) });
}

export function loginWithApple(idToken: string): Promise<LoginResponse> {
  const body: AppleLoginRequest = { id_token: idToken };
  return auth<LoginResponse>("/apple", { method: "POST", body: JSON.stringify(body) });
}

export function me(): Promise<MeResponse> {
  return auth<MeResponse>("/me");
}
