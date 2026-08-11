import { z } from "zod";

export const eventTypes = ["task", "bug", "decision", "idea", "risk", "milestone", "progress", "completed", "plan"] as const;
export type EventType = (typeof eventTypes)[number];
export const recordKinds = ["task", "bug", "decision", "idea", "risk", "milestone"] as const;
export type RecordKind = (typeof recordKinds)[number];
export const lifecycleStates = ["captured", "planned", "in_progress", "done", "dropped"] as const;
export type LifecycleState = (typeof lifecycleStates)[number];
export const syncStates = ["pending", "synced", "corrected", "failed", "retrying"] as const;
export type SyncStatus = (typeof syncStates)[number];

export const sourceEventSchema = z.object({
  type: z.enum(eventTypes),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(5000),
  relatedItemId: z.string().trim().min(1).max(200).nullable().optional(),
  userDirected: z.boolean().default(false),
  sourceExcerpt: z.string().trim().min(1).max(1000),
  observedAt: z.string().datetime().optional(),
  dueDate: z.string().date().nullable().optional(),
  steps: z.array(z.object({ title: z.string().trim().min(1).max(240), summary: z.string().trim().max(2000).optional() })).max(20).optional(),
});
export type SourceEvent = z.infer<typeof sourceEventSchema>;

export const eventBatchSchema = z.object({
  projectContextId: z.string().regex(/^project_[0-9]+$/),
  sessionId: z.string().trim().min(1).max(200),
  turnId: z.string().trim().min(1).max(200),
  events: z.array(sourceEventSchema).min(1).max(50),
});
export type ProjectEventBatch = z.infer<typeof eventBatchSchema>;

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

export interface ActiveItemSnapshot { id: string; identifier: string; title: string; status: string; kind?: string; updatedAt?: string; }

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
  activeItems?: ActiveItemSnapshot[];
  error?: string;
}): string {
  const lines = ["Ambient project layer: keep the user's main task uninterrupted."];
  if (args.error) return `${lines[0]} Project context is temporarily unavailable; continue normally.`;
  if (args.context) {
    lines.push(`Project context: ${args.context.id} (${args.context.planeProjectName ?? args.context.planeProjectId})`);
    lines.push(`cwd: ${args.context.canonicalCwd}; session: ${args.sessionId ?? "unknown"}; turn: ${args.turnId ?? "session"}`);
    lines.push(`Automatic capture: ${args.context.autoCaptureEnabled ? "enabled" : "disabled"}.`);
    lines.push("Before the final reply, decide from this turn's request, plan, tool results, and conclusion whether meaningful project events occurred. If so, call record_project_events once with all events; never send an empty batch.");
    const items = (args.activeItems ?? []).slice(0, 30);
    if (items.length) {
      lines.push("Active Plane items (identifier | title | status):");
      for (const item of items) lines.push(`- ${item.identifier} | ${item.title} | ${item.status}`);
    }
  } else {
    lines.push("No project context is bound for this cwd. If the user wants project capture, list available projects and ask them to choose; do not guess.");
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
