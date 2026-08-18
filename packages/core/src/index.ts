import { z } from "zod";
export { isSessionToken, SESSION_TOKEN_LENGTH } from "./session.js";

export const eventTypes = ["task", "bug", "decision", "idea", "risk", "milestone", "progress", "completed", "plan"] as const;
export type EventType = (typeof eventTypes)[number];
export const recordKinds = ["task", "bug", "decision", "idea", "risk", "milestone"] as const;
export type RecordKind = (typeof recordKinds)[number];
export const lifecycleStates = ["captured", "planned", "in_progress", "done", "dropped"] as const;
export type LifecycleState = (typeof lifecycleStates)[number];
export const syncStates = ["pending", "synced", "corrected", "failed", "retrying"] as const;
export type SyncStatus = (typeof syncStates)[number];

export const relatedItemIdContract = "relatedItemId accepts an exact Plane work-item UUID or user-visible identifier; prefer the snapshot itemId and never infer a target from a title or fuzzy text.";

export const sourceEventSchema = z.object({
  type: z.enum(eventTypes),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(5000),
  relatedItemId: z.string().trim().min(1).max(200).nullable().optional().describe(relatedItemIdContract),
  userDirected: z.boolean().default(false),
  sourceExcerpt: z.string().trim().min(1).max(1000),
  observedAt: z.string().datetime().optional(),
  dueDate: z.string().date().nullable().optional(),
  steps: z.array(z.object({ title: z.string().trim().min(1).max(240), summary: z.string().trim().max(2000).optional() })).max(20).optional(),
  archiveAfterCompletion: z.boolean().optional(),
}).superRefine((event, context) => {
  if (!event.archiveAfterCompletion) return;
  if (event.type !== "completed" || !event.relatedItemId || !event.userDirected) {
    context.addIssue({ code: "custom", message: "archiveAfterCompletion requires a user-directed completed event with relatedItemId" });
  }
});
export type SourceEvent = z.infer<typeof sourceEventSchema>;

export const eventBatchSchema = z.object({
  projectContextId: z.string().regex(/^project_[0-9]+$/),
  sessionId: z.string().trim().min(1).max(200),
  turnId: z.string().trim().min(1).max(200),
  events: z.array(sourceEventSchema).min(1).max(50),
});
export type ProjectEventBatch = z.infer<typeof eventBatchSchema>;

export const noProjectEventsReviewSchema = z.object({
  projectContextId: z.string().regex(/^project_[0-9]+$/),
  sessionId: z.string().trim().min(1).max(200),
  turnId: z.string().trim().min(1).max(200),
});
export type NoProjectEventsReview = z.infer<typeof noProjectEventsReviewSchema>;

export const projectContextInputSchema = z.object({
  cwd: z.string().trim().min(1),
  planeBaseUrl: z.string().url(),
  workspaceSlug: z.string().trim().min(1).max(160),
  planeProjectId: z.string().trim().min(1).max(200),
  planeProjectName: z.string().trim().min(1).max(240).optional(),
  autoCaptureEnabled: z.boolean().optional(),
});
export type ProjectContextInput = z.infer<typeof projectContextInputSchema>;

export interface ProjectContext extends ProjectContextInput {
  id: string;
  canonicalCwd: string;
  workspaceIdentity?: string;
  autoCaptureEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlaneProject { id: string; name: string; identifier?: string; workspaceSlug?: string; }
export interface PlaneStatus { id: string; name: string; color?: string; category?: string; }
export interface PlaneItem {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  parentId?: string;
  stateId?: string;
  stateName?: string;
  status?: LifecycleState;
  kind?: RecordKind;
  dueDate?: string | null;
  projectId?: string;
  url?: string;
  isSystemCreated?: boolean;
  updatedAt?: string;
  archived?: boolean;
}
export interface PlaneActivity { id: string; itemId: string; body: string; createdAt: string; sourceEventId?: string; }
export type ProjectionStatus = "pending" | "failed" | "completed";
export interface SourceReference {
  id: number;
  batchId: string;
  eventId: string;
  remoteSourceId: string;
  planeItemId: string | null;
  sessionId: string;
  turnId: string;
  eventType: EventType;
  summary: string;
  sourceExcerpt: string;
  observedAt: string;
  createdAt: string;
  projectionStatus: ProjectionStatus;
  projectionAttempts: number;
  projectionError: string | null;
  projectedAt: string | null;
}
export type FieldName = "title" | "description" | "kind" | "status" | "dueDate" | "assignee" | "priority";
export type FieldOwner = "system" | "user";
export interface FieldOwnership { planeItemId: string; field: FieldName; owner: FieldOwner; systemValue: string | null; updatedAt: string; }

export interface ActiveItemSnapshot { itemId: string; identifier: string; title: string; status: string; parentId?: string; kind?: string; updatedAt?: string; }

export type BindingOnboardingPhase = "session_start" | "first_user_prompt" | "continuing_session" | "permanently_declined";

export const projectBindingPromptHeader = "项目绑定（待确认）";
export const projectBindingPromptInstruction = "请选择一个项目，或回复‘稍后再说’。";
export const projectBindingPermanentRefusalRule = "An explicit long-term do-not-bind/do-not-ask-again instruction takes precedence over every onboarding instruction: call decline_project_binding without calling list_projects, do not ask about binding again, and do not emit the fixed project-binding block.";
export const projectBindingSessionDeferralRule = "An explicit temporary later/skip/this-time refusal (including this-round/not-now) is quiet only for the current session: do not call list_projects, do not ask again, and do not write a binding preference; a new session may ask once again.";
export const projectBindingPostPromptDeferralRule = "Continuing another task without choosing is a current-session deferral only after the visible conversation has already shown an actual binding question or list_projects result. In that case, do not call list_projects or ask again this session; if no binding question has been shown, treat a normal work request as the first onboarding prompt and call list_projects.";
export const projectBindingRestoreRule = "Only an explicit request to restore or resume binding authorizes restore_project_binding; after restoring, call list_projects and wait for an explicit project choice before calling bind_project.";
export const supersededPlanRule = "When the user explicitly overturns, abandons, or replaces a plan, include archiveAfterCompletion=true on a user-directed completed event for every affected plan item and generated step item. This completes each item before archiving it. Never delete the items.";
export const parentChildClosureRule = "Before completing, superseding, or archiving a parent item, inspect every known child item and resolve each child explicitly. Never leave planned or in-progress children behind only because their parent changed.";
export const projectBindingFinalDeliveryRule = [
  "After calling list_projects, its tool output, commentary, and thought are internal context, not user delivery.",
  "Before the final reply, last_assistant_message must contain this fixed block with the real returned Plane projects:",
  `### ${projectBindingPromptHeader}`,
  "- <真实返回的 Plane 项目>",
  projectBindingPromptInstruction,
  "Continue the user's main task normally.",
].join("\n");
export const projectBindingConditionalFinalDeliveryRule = `Only when this turn actually calls list_projects and the cwd remains unbound with no permanent refusal or current-session deferral does the final binding-delivery rule apply:\n${projectBindingFinalDeliveryRule}`;

export function hasCompleteProjectBindingPrompt(message: string | null | undefined): boolean {
  if (!message) return false;
  const visibleMessage = message.replace(/<!--[\s\S]*?-->/g, "");
  const headerIndex = visibleMessage.indexOf(projectBindingPromptHeader);
  if (headerIndex < 0) return false;
  const instructionIndex = visibleMessage.indexOf(projectBindingPromptInstruction, headerIndex);
  if (instructionIndex < 0) return false;
  return /^\s*[-*+]\s+\S+/m.test(visibleMessage.slice(headerIndex, instructionIndex));
}

export function canonicalizeCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) throw new Error("cwd must not be empty");
  if (trimmed === "/") return "/";
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function normalizeTitle(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function eventId(batchRowId: number, index: number): string { return `event_${batchRowId}_${index}`; }
export function batchId(batchRowId: number): string { return `batch_${batchRowId}`; }
export function remoteSourceId(projectContextId: string, sessionId: string, turnId: string, index: number): string {
  return [projectContextId, sessionId, turnId, String(index)].map(encodeURIComponent).join(":");
}

export function lifecycleForEvent(event: SourceEvent): LifecycleState {
  if (event.type === "completed") return "done";
  if (event.type === "progress") return "in_progress";
  if (event.type === "plan") return "planned";
  return "captured";
}

export function recordKindForEvent(event: SourceEvent): RecordKind | null {
  if (recordKinds.includes(event.type as RecordKind)) return event.type as RecordKind;
  if (event.type === "completed" || event.type === "progress" || event.type === "plan") return "task";
  return null;
}

export function sourceFooter(eventIdValue: string, sessionId: string, turnId: string): string {
  return `\n\n---\n来源事件: ${eventIdValue} · 工作会话 ${sessionId} · 工作回合 ${turnId}`;
}

export function buildAdditionalContext(args: {
  eventName: string;
  sessionId?: string;
  turnId?: string;
  context?: ProjectContext | null;
  currentCwd?: string;
  activeItems?: ActiveItemSnapshot[];
  onboardingPhase?: BindingOnboardingPhase;
  error?: string;
}): string {
  const lines = ["Ambient project layer: keep the user's main task uninterrupted."];
  if (args.error) return `${lines[0]} Project context is temporarily unavailable; continue normally.`;
  if (args.context) {
    lines.push(`Project context: ${args.context.id} (${args.context.planeProjectName ?? args.context.planeProjectId})`);
    lines.push(`Current cwd: ${args.currentCwd ?? "unknown"}; binding root: ${args.context.canonicalCwd}; session: ${args.sessionId ?? "unknown"}; turn: ${args.turnId ?? "session"}`);
    lines.push(`Automatic capture: ${args.context.autoCaptureEnabled ? "enabled" : "disabled"}.`);
    lines.push(relatedItemIdContract);
    lines.push("Before the final reply, if automatic capture is enabled, decide from this turn's request, plan, tool results, and conclusion whether meaningful project events occurred. If so, call record_project_events once with all events; otherwise call acknowledge_no_project_events once. Never send an empty batch.");
    lines.push(supersededPlanRule);
    lines.push(parentChildClosureRule);
    lines.push("The Stop Hook only audits this turn and always allows it to end; it never blocks, injects a follow-up prompt, or asks for a second reply.");
    const allItems = args.activeItems ?? [];
    const items = allItems.slice(0, 30);
    if (items.length) {
      const identifiers = new Map(allItems.map((item) => [item.itemId, item.identifier]));
      const parentIds = new Set(allItems.flatMap((item) => item.parentId ? [item.parentId] : []));
      lines.push("Active Plane items (identifier | itemId | title | status | relationship):");
      for (const item of items) {
        const relationship = item.parentId ? `child of #${identifiers.get(item.parentId) ?? item.parentId}` : parentIds.has(item.itemId) ? "parent" : "standalone";
        lines.push(`- ${item.identifier} | ${item.itemId} | ${item.title} | ${item.status} | ${relationship}`);
      }
    }
  } else {
    lines.push(`Current cwd: ${args.currentCwd ?? "unknown"}; no Plane project is bound.`);
    lines.push("When get_binding returns null for this cwd, do not call open_project_panel; continue the binding flow and open the panel only after a real project context is returned.");
    lines.push("While this cwd is unbound, do not call record_project_events or acknowledge_no_project_events. The Stop Hook only audits this turn and always allows it to end; it never blocks on capture or binding delivery, injects a follow-up prompt, or asks for a second reply.");
    switch (args.onboardingPhase) {
      case "session_start":
        lines.push("This is SessionStart; it cannot interact with the user. On the next UserPromptSubmit, use the visible conversation and the current user message to choose one onboarding branch.");
        lines.push(projectBindingPermanentRefusalRule);
        lines.push(projectBindingSessionDeferralRule);
        lines.push(projectBindingRestoreRule);
        lines.push("The next prompt is a normal first onboarding prompt unless it explicitly refuses, defers, or asks to restore; even a normal work request must call list_projects, show the real returned Plane projects, and ask the user to choose one. The fixed final binding block is required only after list_projects actually runs while the selection flow remains valid.");
        lines.push("Do not guess from a Codex Project name, directory name, Git remote, or conversation, and do not call bind_project before the user explicitly chooses a returned project.");
        break;
      case "first_user_prompt":
        lines.push("This is the first user prompt of this session. Prioritize the current user message and apply the onboarding branches in this order.");
        lines.push(projectBindingPermanentRefusalRule);
        lines.push(projectBindingSessionDeferralRule);
        lines.push(projectBindingRestoreRule);
        lines.push("Otherwise, in this first user-visible reply immediately call list_projects, show the real returned Plane projects, and ask the user to choose one; a normal work request is not a current-session deferral. The fixed final binding block is required only after list_projects actually runs while the selection flow remains valid.");
        lines.push("Do not guess from a Codex Project name, directory name, Git remote, or conversation, and do not call bind_project before the user explicitly chooses a returned project.");
        lines.push("Only an explicit project choice authorizes bind_project. After a binding question is visible, a vague answer, ignoring the question, or continuing another task is not a project choice.");
        break;
      case "continuing_session":
        lines.push("This is a later UserPromptSubmit, but this lifecycle hint does not prove that onboarding was actually asked. Use the visible conversation and current user message, applying the explicit refusal and deferral branches before any fallback onboarding.");
        lines.push(projectBindingPermanentRefusalRule);
        lines.push(projectBindingSessionDeferralRule);
        lines.push(projectBindingPostPromptDeferralRule);
        lines.push(projectBindingRestoreRule);
        lines.push("If no actual onboarding question has appeared yet, now call list_projects, show the real returned Plane projects, and ask the user to choose one. The fixed final binding block is required only after list_projects actually runs while the selection flow remains valid. Do not bind before an explicit choice.");
        break;
      case "permanently_declined":
        lines.push("This cwd is unbound and has an explicit permanent do-not-ask-again preference. Keep the user's task uninterrupted. Do not proactively discover projects, ask about binding, or include the fixed project-binding block. Only if the current user message explicitly asks to restore or resume project selection, follow restore_project_binding, then list_projects, wait for an explicit project choice, and call bind_project only after that choice.");
        break;
      default:
        lines.push("This cwd is unbound. Inspect the visible conversation and apply the explicit refusal, temporary deferral, and restore branches before fallback onboarding.");
        lines.push(projectBindingPermanentRefusalRule);
        lines.push(projectBindingSessionDeferralRule);
        lines.push(projectBindingPostPromptDeferralRule);
        lines.push(projectBindingRestoreRule);
        lines.push("If onboarding has not actually been asked, call list_projects, show the real returned Plane projects, and ask the user to choose one. The fixed final binding block is required only after list_projects actually runs while the selection flow remains valid. Do not guess or call bind_project before an explicit choice.");
        break;
    }
  }
  return lines.join("\n").slice(0, 6000);
}

export interface BatchRecord {
  rowId: number;
  id: string;
  projectContextId: string;
  sessionId: string;
  turnId: string;
  events: SourceEvent[];
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  claimToken?: string;
  leaseUntil?: string | null;
}
