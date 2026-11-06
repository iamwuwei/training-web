import type {
  AcceptInviteResponse,
  ActivitiesResponse,
  AdoptPlanDraftResponse,
  DeleteStravaResponse,
  ErrorResponse,
  GroupEventDetailResponse,
  GroupEventsResponse,
  GroupOkResponse,
  GroupResponse,
  GroupsResponse,
  InvitePreviewResponse,
  LatestPlanDraftResponse,
  MemberPlanResponse,
  PlanDraftOkResponse,
  PlanDraftResponse,
  PostPlanDraftRequest,
  PostGroupInviteResponse,
  PostGroupRequest,
  PostGroupResponse,
  PutShareRequest,
  ShareResponse,
  MatchStatus,
  MeResponse,
  PlanResponse,
  PutMemoRequest,
  PutMemoResponse,
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
  /** `code`: the api's own fixed code, kept only for the 503s in `KNOWN_503` (the message stays the Chinese line, so no page prints an English code). */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const SERVER_ERROR = "伺服器錯誤，稍後再試";

/** The three fixed codes the api sends with a 503: the plan-generation switch is off, an adopt that lost the lock, Aurora waking up. Any other 503 body is dropped like every 5xx body. */
const KNOWN_503 = new Set(["plan generation is off", "busy", "database starting, retry shortly"]);

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
    if (res.status >= 500) {
      let code: string | undefined;
      if (res.status === 503) {
        try { const e = ((await res.json()) as ErrorResponse).error; if (typeof e === "string" && KNOWN_503.has(e)) code = e; } catch { /* not JSON */ }
      }
      throw new ApiError(res.status, SERVER_ERROR, code);
    }
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
  if (useMock) return mock().then((m) => m.mockDisconnectStrava());
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

// ---- 群組 / group-race -------------------------------------------------------------------
// Every call about one group is answered only for a current member; anyone else (and an unknown id) gets the same 404.

/** My groups (the 群組 tab): oldest membership first, with the unread count of each. */
export function getGroups(): Promise<GroupsResponse> {
  if (useMock) return mock().then((m) => m.mockGetGroups());
  return request<GroupsResponse>("/groups");
}

/** Create a group (I am its owner). 409 `group limit`: already in max_groups. */
export function postGroup(body: PostGroupRequest): Promise<PostGroupResponse> {
  if (useMock) return mock().then((m) => m.mockPostGroup(body));
  return request<PostGroupResponse>("/groups", { method: "POST", body: JSON.stringify(body) });
}

/** The group's page: members with their dashboard numbers (as each one shares them), the newest 3 events, the owner's invite. */
export function getGroup(id: string): Promise<GroupResponse> {
  if (useMock) return mock().then((m) => m.mockGetGroup(id));
  return request<GroupResponse>(`/groups/${encodeURIComponent(id)}`);
}

/** Owner: disband. */
export function deleteGroup(id: string): Promise<GroupOkResponse> {
  if (useMock) return mock().then((m) => m.mockDeleteGroup(id));
  return request<GroupOkResponse>(`/groups/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Owner: a new invite link (the old one stops working). The plain token comes back only in this response. */
export function postGroupInvite(id: string): Promise<PostGroupInviteResponse> {
  if (useMock) return mock().then((m) => m.mockPostGroupInvite(id));
  return request<PostGroupInviteResponse>(`/groups/${encodeURIComponent(id)}/invite`, { method: "POST" });
}

/** Owner: revoke the live invite. */
export function deleteGroupInvite(id: string): Promise<GroupOkResponse> {
  if (useMock) return mock().then((m) => m.mockDeleteGroupInvite(id));
  return request<GroupOkResponse>(`/groups/${encodeURIComponent(id)}/invite`, { method: "DELETE" });
}

/** A member (not the owner) leaves. */
export function postGroupLeave(id: string): Promise<GroupOkResponse> {
  if (useMock) return mock().then((m) => m.mockPostGroupLeave(id));
  return request<GroupOkResponse>(`/groups/${encodeURIComponent(id)}/leave`, { method: "POST" });
}

/** Owner: remove a member (`mid` is the membership id from GroupResponse.members). */
export function postGroupMemberRemove(id: string, mid: string): Promise<GroupOkResponse> {
  if (useMock) return mock().then((m) => m.mockPostGroupMemberRemove(id, mid));
  return request<GroupOkResponse>(`/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}/remove`, { method: "POST" });
}

/** One member's plan, read-only, as far as he shares it (my own: everything). 404 `member not found`: not in this group (any more). */
export function getMemberPlan(id: string, mid: string): Promise<MemberPlanResponse> {
  if (useMock) return mock().then((m) => m.mockGetMemberPlan(id, mid));
  return request<MemberPlanResponse>(`/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}/plan`);
}

/** 消息中心, newest first; `before` is the id of the last event of the previous page. */
export function getGroupEvents(id: string, opts: { before?: string; limit?: number } = {}): Promise<GroupEventsResponse> {
  if (useMock) return mock().then((m) => m.mockGetGroupEvents(id, opts));
  const q = new URLSearchParams();
  if (opts.before) q.set("before", opts.before);
  if (opts.limit != null) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return request<GroupEventsResponse>(`/groups/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ""}`);
}

/** The detail of one session_done event, as far as its actor shares it. 404: gone, or hidden since. */
export function getGroupEvent(id: string, eid: string): Promise<GroupEventDetailResponse> {
  if (useMock) return mock().then((m) => m.mockGetGroupEvent(id, eid));
  return request<GroupEventDetailResponse>(`/groups/${encodeURIComponent(id)}/events/${encodeURIComponent(eid)}`);
}

/** The 消息中心 was opened: clears this group's unread count. */
export function putGroupSeen(id: string): Promise<GroupOkResponse> {
  if (useMock) return mock().then((m) => m.mockPutGroupSeen(id));
  return request<GroupOkResponse>(`/groups/${encodeURIComponent(id)}/seen`, { method: "PUT" });
}

/** What an invite link is, before accepting it. 404: no such invite. */
export function getInvite(token: string): Promise<InvitePreviewResponse> {
  if (useMock) return mock().then((m) => m.mockGetInvite(token));
  return request<InvitePreviewResponse>(`/invites/${encodeURIComponent(token)}`);
}

/** Join through an invite link. 409 with the state (`full`, `group_limit` …) when it can not be used. */
export function postInviteAccept(token: string): Promise<AcceptInviteResponse> {
  if (useMock) return mock().then((m) => m.mockPostInviteAccept(token));
  return request<AcceptInviteResponse>(`/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
}

/** What the people of my groups may see of me (defaults when never set). */
export function getShare(): Promise<ShareResponse> {
  if (useMock) return mock().then((m) => m.mockGetShare());
  return request<ShareResponse>("/me/share");
}

/** Change some of my switches; it takes effect on the next request of anyone. */
export function putShare(body: PutShareRequest): Promise<ShareResponse> {
  if (useMock) return mock().then((m) => m.mockPutShare(body));
  return request<ShareResponse>("/me/share", { method: "PUT", body: JSON.stringify(body) });
}

// ---- ai-plan-generation -------------------------------------------------------------------
// Woo writes a whole plan from an intake form and the athlete's Strava history. 4xx errors carry the api's fixed code in
// `ApiError.message` (see app/lib/draft.ts for the sentences); a 5xx is always 伺服器錯誤，稍後再試, its status is all there is.

/** Start a draft (202). 400 a code per field, 409 `generating` | `has active plan` | `strava not connected`, 429 `daily limit`, 503 plan generation is off. */
export function postPlanDraft(body: PostPlanDraftRequest): Promise<PlanDraftResponse> {
  if (useMock) return mock().then((m) => m.mockPostPlanDraft(body));
  return request<PlanDraftResponse>("/plan-drafts", { method: "POST", body: JSON.stringify(body) });
}

/** The newest draft worth showing (pending, ready or failed), for the entry on 今天／課表; `{ draft: null }` when there is none. 404 = an api from before this. */
export function getLatestPlanDraft(): Promise<LatestPlanDraftResponse> {
  if (useMock) return mock().then((m) => m.mockGetLatestPlanDraft());
  return request<LatestPlanDraftResponse>("/plan-drafts/latest");
}

/** One draft, for polling and the preview. 404: not mine, or no such draft. */
export function getPlanDraft(id: string): Promise<PlanDraftResponse> {
  if (useMock) return mock().then((m) => m.mockGetPlanDraft(id));
  return request<PlanDraftResponse>(`/plan-drafts/${encodeURIComponent(id)}`);
}

/** Take the draft as my plan (one transaction; again on an adopted draft answers the same plan). 409 `has active plan` | `draft is <status>`, 503 busy. */
export function adoptPlanDraft(id: string): Promise<AdoptPlanDraftResponse> {
  if (useMock) return mock().then((m) => m.mockAdoptPlanDraft(id));
  return request<AdoptPlanDraftResponse>(`/plan-drafts/${encodeURIComponent(id)}/adopt`, { method: "POST" });
}

/** 繼續: pick a failed draft up where it stopped (202, back to pending). 409 `calls exhausted` | `resume limit` | `draft is <status>`. */
export function resumePlanDraft(id: string): Promise<PlanDraftResponse> {
  if (useMock) return mock().then((m) => m.mockResumePlanDraft(id));
  return request<PlanDraftResponse>(`/plan-drafts/${encodeURIComponent(id)}/resume`, { method: "POST" });
}

/** 不要這份. 409 `draft is adopted`. */
export function discardPlanDraft(id: string): Promise<PlanDraftOkResponse> {
  if (useMock) return mock().then((m) => m.mockDiscardPlanDraft(id));
  return request<PlanDraftOkResponse>(`/plan-drafts/${encodeURIComponent(id)}/discard`, { method: "POST" });
}
