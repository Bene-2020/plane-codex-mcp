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
export interface BindingProjectCandidate { name: string; identifier: string; }
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
export type ActiveItemChangeKind = "added" | "updated" | "removed";
export interface ActiveItemChange { kind: ActiveItemChangeKind; item: ActiveItemSnapshot; }

export type BindingOnboardingPhase = "session_start" | "first_user_prompt" | "continuing_session" | "permanently_declined";

export const projectBindingListProjectsToolName = "mcp__ambient_project__list_projects";
export const projectBindingGetBindingToolName = "mcp__ambient_project__get_binding";
export const projectBindingOpenPanelToolName = "mcp__ambient_project__open_project_panel";
export const projectBindingToolName = "mcp__ambient_project__bind_project";
export const projectBindingChangeToolName = "mcp__ambient_project__change_binding";
export const projectBindingDeclineToolName = "mcp__ambient_project__decline_project_binding";
export const projectBindingRestoreToolName = "mcp__ambient_project__restore_project_binding";
export const projectBindingRecordEventsToolName = "mcp__ambient_project__record_project_events";
export const projectBindingAcknowledgeEventsToolName = "mcp__ambient_project__acknowledge_no_project_events";
export const codexDesktopListProjectsToolName = "codex_app__list_projects";

export const projectBindingPromptHeader = "项目绑定（待确认）";
export const projectBindingPromptInstruction = "请选择一个项目，或回复‘稍后再说’。";
export const projectBindingPermanentRefusalRule = `An explicit long-term do-not-bind/do-not-ask-again instruction takes precedence over every onboarding instruction: call ${projectBindingDeclineToolName} without calling ${projectBindingListProjectsToolName}, do not ask about binding again, and do not emit the fixed project-binding block.`;
export const projectBindingSessionDeferralRule = `An explicit temporary later/skip/this-time refusal (including this-round/not-now) is quiet only for the current session: do not call ${projectBindingListProjectsToolName}, do not ask again, and do not write a binding preference; a new session may ask once again.`;
export const projectBindingPostPromptDeferralRule = `Continuing another task without choosing is a current-session deferral only after the visible conversation has already shown an actual binding question or ${projectBindingListProjectsToolName} result. In that case, do not call ${projectBindingListProjectsToolName} or ask again this session; if no binding question has been shown, treat a normal work request as the first onboarding prompt and call ${projectBindingListProjectsToolName}.`;
export const projectBindingRestoreRule = `Only an explicit request to restore or resume binding authorizes ${projectBindingRestoreToolName}; after restoring, call ${projectBindingListProjectsToolName} and wait for an explicit project choice before calling ${projectBindingToolName}.`;
export const projectBindingToolSourceRule = `During Ambient Plane binding, use only ${projectBindingListProjectsToolName} as the candidate source. ${codexDesktopListProjectsToolName} may still be used for an explicit Codex Projects request, but never as Plane binding evidence. Binding candidates may only come from the real return of ${projectBindingListProjectsToolName} in this turn. Never show or accept path, projectKind, or hostId, and never use a Codex local project name as a Plane candidate. Before an explicit user choice, do not call ${projectBindingToolName}; never guess from a directory name, Codex Project, Git remote, or history.`;
export const supersededPlanRule = "When the user explicitly overturns, abandons, or replaces a plan, include archiveAfterCompletion=true on a user-directed completed event for every affected plan item and generated step item. This completes each item before archiving it. Never delete the items.";
export const parentChildClosureRule = "Before completing, superseding, or archiving a parent item, inspect every known child item and resolve each child explicitly. Never leave planned or in-progress children behind only because their parent changed.";
export const projectBindingFinalDeliveryRule = [
  `After calling ${projectBindingListProjectsToolName}, its tool output, commentary, and thought are internal context, not user delivery.`,
  `The fixed block may contain only exact name+identifier pairs from that turn's real ${projectBindingListProjectsToolName} return. Each Markdown bullet must use this finite format: - **<identifier>** | <name> (plain fields or individually wrapped in Markdown bold, underscore-bold, or inline code are also allowed). Reject prefixes, suffixes, labels, extra separators, extra fields, path/projectKind/hostId, empty results, exceptional results, and results from another tool.`,
  "Before the final reply, last_assistant_message must contain this fixed block with the real returned Plane projects:",
  `### ${projectBindingPromptHeader}`,
  "- **<identifier>** | <name>",
  projectBindingPromptInstruction,
  "Continue the user's main task normally.",
].join("\n");
export const projectBindingConditionalFinalDeliveryRule = `Only when this turn actually calls ${projectBindingListProjectsToolName} and the cwd remains unbound with no permanent refusal or current-session deferral does the final binding-delivery rule apply:\n${projectBindingFinalDeliveryRule}`;

function hasForbiddenBindingMetadataLabel(value: string): boolean {
  return /(?:^|[^A-Za-z0-9_])(?:path|projectKind|hostId)(?:$|[^A-Za-z0-9_])/i.test(value);
}

function normalizeBindingText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function escapeBindingRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bindingFieldPattern(value: string): string {
  const escaped = escapeBindingRegExp(normalizeBindingText(value));
  return `(?:${escaped}|\\*\\*${escaped}\\*\\*|__${escaped}__|\`${escaped}\`)`;
}

function matchesBindingCandidate(item: string, candidate: BindingProjectCandidate): boolean {
  const normalizedItem = normalizeBindingText(item);
  const identifier = normalizeBindingText(candidate.identifier);
  const name = normalizeBindingText(candidate.name);
  if (!normalizedItem || !identifier || !name || hasForbiddenBindingMetadataLabel(normalizedItem)) return false;
  return new RegExp(`^${bindingFieldPattern(identifier)}\\s*\\|\\s*${bindingFieldPattern(name)}$`, "u").test(normalizedItem);
}

export function hasCompleteProjectBindingPrompt(message: string | null | undefined, candidates?: BindingProjectCandidate[] | null): boolean {
  if (!message) return false;
  const visibleMessage = message.replace(/<!--[\s\S]*?-->/g, "");
  const headerIndex = visibleMessage.indexOf(projectBindingPromptHeader);
  if (headerIndex < 0) return false;
  const instructionIndex = visibleMessage.indexOf(projectBindingPromptInstruction, headerIndex);
  if (instructionIndex < 0) return false;
  const blockLines = visibleMessage.slice(headerIndex + projectBindingPromptHeader.length, instructionIndex).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!blockLines.length || blockLines.some((line) => !/^-\s+.+$/.test(line))) return false;
  const items = blockLines.map((line) => line.replace(/^-\s+/, ""));
  if (candidates === undefined) return true;
  if (!candidates?.length) return false;
  return items.every((item) => candidates.some((candidate) => matchesBindingCandidate(item, candidate)));
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
    lines.push(`Before the final reply, if automatic capture is enabled, decide from this turn's request, plan, tool results, and conclusion whether meaningful project events occurred. If so, call ${projectBindingRecordEventsToolName} once with all events; otherwise call ${projectBindingAcknowledgeEventsToolName} once. Never send an empty batch.`);
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
    lines.push(`When ${projectBindingGetBindingToolName} returns null for this cwd, do not call ${projectBindingOpenPanelToolName}; continue the binding flow and open the panel only after a real project context is returned.`);
    lines.push(`While this cwd is unbound, do not call ${projectBindingRecordEventsToolName} or ${projectBindingAcknowledgeEventsToolName}. The Stop Hook only audits this turn and always allows it to end; it never blocks on capture or binding delivery, injects a follow-up prompt, or asks for a second reply.`);
    lines.push(projectBindingToolSourceRule);
    switch (args.onboardingPhase) {
      case "session_start":
        lines.push("This is SessionStart; it cannot interact with the user. On the next UserPromptSubmit, use the visible conversation and the current user message to choose one onboarding branch.");
        lines.push(projectBindingPermanentRefusalRule);
        lines.push(projectBindingSessionDeferralRule);
        lines.push(projectBindingRestoreRule);
        lines.push(`The next prompt is a normal first onboarding prompt unless it explicitly refuses, defers, or asks to restore; even a normal work request must call ${projectBindingListProjectsToolName}, show the real returned Plane projects, and ask the user to choose one. The fixed final binding block is required only after ${projectBindingListProjectsToolName} actually runs while the selection flow remains valid.`);
        lines.push(`Do not guess from a Codex Project name, directory name, Git remote, or conversation, and do not call ${projectBindingToolName} before the user explicitly chooses a returned project.`);
        break;
      case "first_user_prompt":
        lines.push("This is the first user prompt of this session. Prioritize the current user message and apply the onboarding branches in this order.");
        lines.push(projectBindingPermanentRefusalRule);
        lines.push(projectBindingSessionDeferralRule);
        lines.push(projectBindingRestoreRule);
        lines.push(`Otherwise, in this first user-visible reply immediately call ${projectBindingListProjectsToolName}, show the real returned Plane projects, and ask the user to choose one; a normal work request is not a current-session deferral. The fixed final binding block is required only after ${projectBindingListProjectsToolName} actually runs while the selection flow remains valid.`);
        lines.push(`Do not guess from a Codex Project name, directory name, Git remote, or conversation, and do not call ${projectBindingToolName} before the user explicitly chooses a returned project.`);
        lines.push(`Only an explicit project choice authorizes ${projectBindingToolName}. After a binding question is visible, a vague answer, ignoring the question, or continuing another task is not a project choice.`);
        break;
      case "continuing_session":
        lines.push("This is a later UserPromptSubmit, but this lifecycle hint does not prove that onboarding was actually asked. Use the visible conversation and current user message, applying the explicit refusal and deferral branches before any fallback onboarding.");
        lines.push(projectBindingPermanentRefusalRule);
        lines.push(projectBindingSessionDeferralRule);
        lines.push(projectBindingPostPromptDeferralRule);
        lines.push(projectBindingRestoreRule);
        lines.push(`If no actual onboarding question has appeared yet, now call ${projectBindingListProjectsToolName}, show the real returned Plane projects, and ask the user to choose one. The fixed final binding block is required only after ${projectBindingListProjectsToolName} actually runs while the selection flow remains valid. Do not bind before an explicit choice.`);
        break;
      case "permanently_declined":
        lines.push(`This cwd is unbound and has an explicit permanent do-not-ask-again preference. Keep the user's task uninterrupted. Do not proactively discover projects, ask about binding, or include the fixed project-binding block. Only if the current user message explicitly asks to restore or resume project selection, follow ${projectBindingRestoreToolName}, then ${projectBindingListProjectsToolName}, wait for an explicit project choice, and call ${projectBindingToolName} only after that choice.`);
        break;
      default:
        lines.push("This cwd is unbound. Inspect the visible conversation and apply the explicit refusal, temporary deferral, and restore branches before fallback onboarding.");
        lines.push(projectBindingPermanentRefusalRule);
        lines.push(projectBindingSessionDeferralRule);
        lines.push(projectBindingPostPromptDeferralRule);
        lines.push(projectBindingRestoreRule);
        lines.push(`If onboarding has not actually been asked, call ${projectBindingListProjectsToolName}, show the real returned Plane projects, and ask the user to choose one. The fixed final binding block is required only after ${projectBindingListProjectsToolName} actually runs while the selection flow remains valid. Do not guess or call ${projectBindingToolName} before an explicit choice.`);
        break;
    }
  }
  return lines.join("\n").slice(0, 6000);
}

function comparableActiveItem(item: ActiveItemSnapshot): string {
  return JSON.stringify({
    identifier: item.identifier,
    title: item.title,
    status: item.status,
    parentId: item.parentId ?? null,
  });
}

/**
 * Compare the current cache with the last snapshot delivered to this Codex
 * session. A null previous snapshot means that SessionStart has not delivered
 * a baseline yet, so the next UserPromptSubmit remains a plain turn envelope.
 */
export function diffActiveItemSnapshots(previous: ActiveItemSnapshot[] | null, current: ActiveItemSnapshot[]): ActiveItemChange[] {
  if (previous === null) return [];
  const previousById = new Map(previous.map((item) => [item.itemId, item]));
  const currentById = new Map(current.map((item) => [item.itemId, item]));
  const changes: ActiveItemChange[] = [];
  for (const item of current) {
    const oldItem = previousById.get(item.itemId);
    if (!oldItem) changes.push({ kind: "added", item });
    else if (comparableActiveItem(oldItem) !== comparableActiveItem(item)) changes.push({ kind: "updated", item });
  }
  for (const item of previous) {
    if (!currentById.has(item.itemId)) changes.push({ kind: "removed", item });
  }
  return changes;
}

/**
 * The per-turn envelope deliberately contains only the three local protocol
 * IDs and the record-or-ack obligation. Stable binding and lifecycle rules
 * live in the MCP server instructions and are not repeated on every prompt.
 */
export function buildTurnAdditionalContext(args: {
  sessionId: string;
  turnId?: string;
  context: ProjectContext;
  activeItemChanges?: ActiveItemChange[];
  activeItems?: ActiveItemSnapshot[];
}): string {
  const lines = [
    "Ambient project turn context.",
    `projectContextId=${args.context.id}; sessionId=${args.sessionId}; turnId=${args.turnId ?? "unknown"}.`,
    `Before the final reply, if automatic capture is enabled, call ${projectBindingRecordEventsToolName} once with one non-empty batch when this turn created meaningful project events; otherwise call ${projectBindingAcknowledgeEventsToolName} once.`,
  ];
  if (args.activeItemChanges?.length) {
    const changes = args.activeItemChanges;
    const activeItems = args.activeItems ?? [];
    const parentIds = new Set(activeItems.flatMap((item) => item.parentId ? [item.parentId] : []));
    const relationship = (item: ActiveItemSnapshot): string => item.parentId ? `child of ${item.parentId}` : parentIds.has(item.itemId) ? "parent" : "standalone";
    const changeLine = (change: ActiveItemChange): string => {
      const item = change.item;
      return `- ${change.kind} | ${item.identifier} | ${item.itemId} | ${item.title} | ${item.status} | parentId=${item.parentId ?? "none"} | relationship=${relationship(item)}`;
    };
    const total = changes.length;
    const renderChanges = (shown: number): string => [
      ...lines,
      `Active Plane item changes since the last delivered snapshot (showing ${shown} of ${total}; change | identifier | itemId | title | status | parentId | relationship):`,
      ...changes.slice(0, shown).map(changeLine),
    ].join("\n");
    let shown = Math.min(30, total);
    while (shown > 0 && renderChanges(shown).length > 6000) shown -= 1;
    return renderChanges(shown);
  }
  return lines.join("\n");
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
