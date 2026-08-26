import {
  BatchRecord, LifecycleState, PlaneActivity, PlaneItem, PlaneProject, ProjectContext,
  RecordKind, SourceEvent, eventId, lifecycleForEvent, recordKindForEvent, remoteSourceId, sourceFooter,
} from "@ambient/core";
import { Storage } from "@ambient/storage";
import { PlaneClient, State as PlaneSdkState, WorkItem as PlaneSdkWorkItem, WorkItemType as PlaneSdkWorkItemType } from "@makeplane/plane-node-sdk";

export interface CreateItemInput { title: string; description: string; kind: RecordKind; status: LifecycleState; dueDate?: string | null; parentId?: string; sourceEventId: string; }
export interface UpdateItemInput { title?: string; description?: string; kind?: RecordKind; status?: LifecycleState; dueDate?: string | null; }
export type PlaneTypeMode = "default" | "custom";
export interface PlaneSdkAdapterOptions { client?: PlaneClient; typeMode?: PlaneTypeMode; requestGate?: PlaneRequestGate; }

export interface PlaneRequestGate {
  acquire(): Promise<void>;
  rateLimited(error: unknown): void;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** A small interface hiding SQLite coordination and server reset parsing from SDK callers. */
export class SqlitePlaneRequestGate implements PlaneRequestGate {
  constructor(private readonly storage: Storage, private readonly rateKey: string, private readonly intervalMs = 2_000) {}

  async acquire(): Promise<void> {
    while (true) {
      const reservation = this.storage.reservePlaneRequest(this.rateKey, this.intervalMs);
      if (reservation.waitMs > 0) await delay(reservation.waitMs);
      if (this.storage.isPlaneRequestReservationValid(this.rateKey, reservation.epoch)) return;
    }
  }

  rateLimited(error: unknown): void {
    if (responseStatus(error) !== 429) return;
    const now = Date.now();
    let until = now + 60_000;
    const retryAfter = responseHeader(error, "retry-after");
    const reset = responseHeader(error, "x-ratelimit-reset");
    if (retryAfter) {
      const numeric = Number(retryAfter);
      if (Number.isFinite(numeric)) {
        until = Math.max(until, now + numeric * 1_000);
      } else {
        const date = Date.parse(retryAfter);
        if (Number.isFinite(date)) until = Math.max(until, date);
      }
    }
    if (reset) {
      const numeric = Number(reset);
      if (Number.isFinite(numeric)) {
        const timestamp = numeric > 1_000_000_000_000 ? numeric : numeric * 1_000;
        until = Math.max(until, timestamp);
      } else {
        const date = Date.parse(reset);
        if (Number.isFinite(date)) until = Math.max(until, date);
      }
    }
    this.storage.pausePlaneRequests(this.rateKey, new Date(until));
  }
}

function responseStatus(error: unknown): number {
  const value = error as { response?: { status?: unknown }; status?: unknown; statusCode?: unknown };
  return Number(value.response?.status ?? value.status ?? value.statusCode);
}

function responseHeader(error: unknown, name: string): string | undefined {
  const headers = (error as { response?: { headers?: unknown } }).response?.headers as { get?: (key: string) => unknown } | Record<string, unknown> | undefined;
  if (!headers) return undefined;
  const value = typeof headers.get === "function" ? headers.get(name) : (headers as Record<string, unknown>)[name] ?? (headers as Record<string, unknown>)[name.toLowerCase()];
  return value === undefined || value === null ? undefined : String(value);
}

export interface PlaneAdapter {
  listProjects(): Promise<PlaneProject[]>;
  listItems(context: ProjectContext): Promise<PlaneItem[]>;
  createItem(context: ProjectContext, input: CreateItemInput): Promise<PlaneItem>;
  updateItem(context: ProjectContext, itemId: string, input: UpdateItemInput): Promise<PlaneItem>;
  addActivity(context: ProjectContext, itemId: string, body: string, sourceEventId: string): Promise<PlaneActivity>;
  deleteItem(context: ProjectContext, itemId: string): Promise<void>;
  archiveItem(context: ProjectContext, itemId: string): Promise<void>;
}

export type FakePlaneOperation = "listItems" | "createItem" | "updateItem" | "addActivity";
export interface FakePlaneFailure {
  operation: FakePlaneOperation;
  call?: number;
  sourceEventId?: string;
  afterWrite?: boolean;
}

export const UNRESOLVED_RELATED_ITEM_ERROR_CODE = "UNRESOLVED_RELATED_ITEM" as const;

export class UnresolvedRelatedItemError extends Error {
  readonly code = UNRESOLVED_RELATED_ITEM_ERROR_CODE;

  constructor(
    readonly relatedItemId: string,
    readonly eventType: SourceEvent["type"],
    readonly sourceEventId: string,
  ) {
    super(`${UNRESOLVED_RELATED_ITEM_ERROR_CODE}: relatedItemId ${JSON.stringify(relatedItemId)} did not resolve to a Plane item for ${eventType} source event ${sourceEventId}.`);
    this.name = "UnresolvedRelatedItemError";
  }
}

export function sourceMarker(sourceEventId: string): string { return `[ambient-source:${sourceEventId}]`; }
function activityMarker(sourceEventId: string): string { return `[ambient:${sourceEventId}]`; }
function hasSourceMarker(value: string | undefined, sourceEventId: string): boolean {
  return Boolean(value && (value.includes(sourceMarker(sourceEventId)) || value.includes(`来源事件: ${sourceEventId}`)));
}
function stepSourceEventId(eventIdValue: string, index: number): string { return `${eventIdValue}:step_${index}`; }

function itemUrl(baseUrl: string, workspace: string, project: string, itemId: string): string { return `${baseUrl.replace(/\/$/, "")}/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/work-items/${encodeURIComponent(itemId)}`; }

function bypassPlainHttpsProxyForPlane(baseUrl: string): void {
  const proxy = process.env.https_proxy?.trim() || process.env.HTTPS_PROXY?.trim();
  if (!proxy || !proxy.toLowerCase().startsWith("http://")) return;
  const host = new URL(baseUrl).hostname;
  const entries = (process.env.no_proxy ?? process.env.NO_PROXY ?? "").split(/[,\s]+/).filter(Boolean);
  if (entries.includes("*") || entries.includes(host)) return;
  process.env.no_proxy = [...entries, host].join(",");
}

const offsetPageSize = 100;
type OffsetPage<T> = { results: T[]; next_page_results?: boolean; total_count?: number; total_results?: number };

async function listOffsetPages<T>(loadPage: (params: { limit: number; offset?: number }) => Promise<OffsetPage<T>>): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  while (true) {
    const page = await loadPage(offset === 0 ? { limit: offsetPageSize } : { limit: offsetPageSize, offset });
    results.push(...page.results);
    const total = page.total_results ?? page.total_count;
    const hasNext = page.next_page_results ?? (typeof total === "number" ? offset + page.results.length < total : page.results.length === offsetPageSize);
    if (!hasNext) return results;
    if (page.results.length === 0) throw new Error("Plane pagination returned next_page_results without results");
    offset += page.results.length;
  }
}

const planeTypeNames: Record<RecordKind, string> = {
  task: "Task",
  bug: "Bug",
  decision: "Decision",
  idea: "Idea",
  risk: "Risk",
  milestone: "Milestone",
};

const typeTitlePattern = /^\[(Task|Bug|Decision|Idea|Risk|Milestone)\]-/i;

function kindForPrefixedTitle(title: string): RecordKind | undefined {
  const match = typeTitlePattern.exec(title);
  return match ? kindForPlaneTypeName(match[1]!) : undefined;
}

function titleWithKindPrefix(title: string, kind: RecordKind): string {
  return `[${planeTypeNames[kind]}]-${title.replace(typeTitlePattern, "")}`;
}

function kindForPlaneTypeName(name: string): RecordKind | undefined {
  const normalized = name.trim().toLowerCase();
  return (Object.entries(planeTypeNames) as Array<[RecordKind, string]>).find(([, typeName]) => typeName.toLowerCase() === normalized)?.[0];
}

export class PlaneSdkAdapter implements PlaneAdapter {
  private readonly client: PlaneClient;
  private readonly typeMode: PlaneTypeMode;
  private readonly stateIds = new Map<string, string>();
  private readonly stateNames = new Map<string, string>();
  private readonly typeIds = new Map<string, string>();
  private readonly typeKinds = new Map<string, RecordKind>();
  private readonly itemKinds = new Map<string, RecordKind>();
  private readonly itemTitles = new Map<string, string>();
  private readonly requestGate?: PlaneRequestGate;

  constructor(private readonly baseUrl: string, apiKey: string, private readonly defaultWorkspace: string, options: PlaneSdkAdapterOptions = {}) {
    this.client = options.client ?? new PlaneClient({ baseUrl, apiKey });
    this.typeMode = options.typeMode ?? "custom";
    this.requestGate = options.requestGate;
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    await this.requestGate?.acquire();
    try { return await operation(); }
    catch (error) { this.requestGate?.rateLimited(error); throw error; }
  }

  async listProjects(): Promise<PlaneProject[]> {
    const projects = await listOffsetPages((params) => this.request(() => this.client.projects.list(this.defaultWorkspace, params)));
    return projects.map((project) => ({ id: project.id, name: project.name, identifier: project.identifier, workspaceSlug: this.defaultWorkspace }));
  }

  async listItems(context: ProjectContext): Promise<PlaneItem[]> {
    await this.loadStates(context);
    const items: PlaneSdkWorkItem[] = [];
    let cursor: string | undefined;
    do {
      const payload = await this.request(() => this.client.workItems.list(context.workspaceSlug, context.planeProjectId, { per_page: 100, expand: "type", ...(cursor ? { cursor } : {}) }));
      items.push(...payload.results);
      cursor = payload.next_page_results ? payload.next_cursor : undefined;
    } while (cursor);
    return items.map((item) => this.fromSdk(context, item));
  }

  async createItem(context: ProjectContext, input: CreateItemInput): Promise<PlaneItem> {
    const existing = await this.findItemBySourceEventId(context, input.sourceEventId);
    if (existing) return { ...existing, isSystemCreated: true, kind: input.kind, parentId: input.parentId ?? existing.parentId };
    const stateId = await this.resolveStateId(context, input.status);
    const typeId = this.typeMode === "custom" ? await this.resolveTypeId(context, input.kind) : undefined;
    const title = this.typeMode === "default" ? titleWithKindPrefix(input.title, input.kind) : input.title;
    const description = `${input.description}\n\n${sourceMarker(input.sourceEventId)}`;
    let payload: PlaneSdkWorkItem;
    try {
      payload = await this.request(() => this.client.workItems.create(context.workspaceSlug, context.planeProjectId, {
        name: title,
        description_html: description,
        state: stateId,
        ...(typeId ? { type: typeId } : {}),
        target_date: input.dueDate ?? undefined,
        parent: input.parentId,
      }));
    } catch (error) {
      const recovered = await this.findItemBySourceEventId(context, input.sourceEventId);
      if (recovered) return { ...recovered, isSystemCreated: true, kind: input.kind, parentId: input.parentId ?? recovered.parentId };
      throw error;
    }
    const created = {
      ...this.fromSdk(context, payload),
      isSystemCreated: true,
      url: itemUrl(this.baseUrl, context.workspaceSlug, context.planeProjectId, payload.id),
      title,
      kind: input.kind,
      parentId: input.parentId,
    };
    this.rememberItem(context, created.id, created.title, input.kind);
    return created;
  }

  async updateItem(context: ProjectContext, itemId: string, input: UpdateItemInput): Promise<PlaneItem> {
    const stateId = input.status ? await this.resolveStateId(context, input.status) : undefined;
    const typeId = this.typeMode === "custom" && input.kind ? await this.resolveTypeId(context, input.kind) : undefined;
    const itemKey = this.itemKey(context, itemId);
    const kind = input.kind ?? this.itemKinds.get(itemKey);
    const sourceTitle = input.title ?? (input.kind ? this.itemTitles.get(itemKey) : undefined);
    const title = this.typeMode === "default" && sourceTitle && kind ? titleWithKindPrefix(sourceTitle, kind) : input.title;
    const payload = await this.request(() => this.client.workItems.update(context.workspaceSlug, context.planeProjectId, itemId, {
      ...(title !== undefined ? { name: title } : {}),
      ...(input.description !== undefined ? { description_html: input.description } : {}),
      ...(stateId ? { state: stateId } : {}),
      ...(typeId ? { type: typeId } : {}),
      ...(input.dueDate !== undefined ? { target_date: input.dueDate ?? undefined } : {}),
    }));
    const updated = this.fromSdk(context, payload);
    const result = input.kind ? { ...updated, kind: input.kind } : updated;
    this.rememberItem(context, itemId, result.title, result.kind);
    return result;
  }

  async addActivity(context: ProjectContext, itemId: string, body: string, sourceEventId: string): Promise<PlaneActivity> {
    const marker = activityMarker(sourceEventId);
    const existing = await this.findActivityBySourceEventId(context, itemId, marker);
    if (existing) return existing;
    let payload;
    try {
      payload = await this.request(() => this.client.workItems.comments.create(context.workspaceSlug, context.planeProjectId, itemId, { comment_html: `${body}\n\n${marker}` }));
    } catch (error) {
      const recovered = await this.findActivityBySourceEventId(context, itemId, marker);
      if (recovered) return recovered;
      throw error;
    }
    return { id: payload.id, itemId, body, createdAt: String(payload.created_at ?? new Date().toISOString()), sourceEventId };
  }

  async deleteItem(context: ProjectContext, itemId: string): Promise<void> { await this.request(() => this.client.workItems.delete(context.workspaceSlug, context.planeProjectId, itemId)); }

  async archiveItem(context: ProjectContext, itemId: string): Promise<void> { await this.request(() => this.client.workItems.archive(context.workspaceSlug, context.planeProjectId, itemId)); }

  private async findItemBySourceEventId(context: ProjectContext, sourceEventId: string): Promise<PlaneItem | null> {
    const items = await this.listItems(context);
    return items.find((item) => hasSourceMarker(item.description, sourceEventId)) ?? null;
  }

  private async findActivityBySourceEventId(context: ProjectContext, itemId: string, marker: string): Promise<PlaneActivity | null> {
    const comments = await listOffsetPages((params) => this.request(() => this.client.workItems.comments.list(context.workspaceSlug, context.planeProjectId, itemId, params)));
    const comment = comments.find((item) => item.comment_html?.includes(marker));
    return comment ? { id: comment.id, itemId, body: comment.comment_html?.replace(`\n\n${marker}`, "") ?? "", createdAt: String(comment.created_at ?? new Date().toISOString()), sourceEventId: marker.slice("[ambient:".length, -1) } : null;
  }

  private async loadStates(context: ProjectContext): Promise<PlaneSdkState[]> {
    const states = await listOffsetPages((params) => this.request(() => this.client.states.list(context.workspaceSlug, context.planeProjectId, params)));
    for (const state of states) this.stateNames.set(this.stateKey(context, state.id), state.name);
    return states;
  }

  private async resolveStateId(context: ProjectContext, lifecycle: LifecycleState): Promise<string> {
    const key = `${context.workspaceSlug}/${context.planeProjectId}/${lifecycle}`;
    const cached = this.stateIds.get(key);
    if (cached) return cached;
    const states = await this.loadStates(context);
    const match = states.find((state) => toLifecycle(`${state.name} ${state.group ?? ""}`) === lifecycle) ?? states.find((state) => state.name.toLowerCase().includes(lifecycle.replace("_", " ")));
    if (!match) throw new Error(`Plane project has no state for ${lifecycle}`);
    this.stateIds.set(key, match.id);
    return match.id;
  }

  private async loadTypes(context: ProjectContext): Promise<PlaneSdkWorkItemType[]> {
    const types = await this.request(() => this.client.workItemTypes.list(context.workspaceSlug, context.planeProjectId));
    for (const type of types) {
      const kind = kindForPlaneTypeName(type.name);
      if (!kind) continue;
      this.typeIds.set(this.typeKindKey(context, kind), type.id);
      this.typeKinds.set(this.typeIdKey(context, type.id), kind);
    }
    return types;
  }

  private async resolveTypeId(context: ProjectContext, kind: RecordKind): Promise<string> {
    const key = this.typeKindKey(context, kind);
    const cached = this.typeIds.get(key);
    if (cached) return cached;
    const types = await this.loadTypes(context);
    const existing = types.find((type) => kindForPlaneTypeName(type.name) === kind);
    const type = existing ?? await this.request(() => this.client.workItemTypes.create(context.workspaceSlug, context.planeProjectId, {
      name: planeTypeNames[kind],
      description: `Ambient project ${kind} records`,
      is_active: true,
      is_epic: false,
    }));
    this.typeIds.set(key, type.id);
    this.typeKinds.set(this.typeIdKey(context, type.id), kind);
    return type.id;
  }

  private fromSdk(context: ProjectContext, item: PlaneSdkWorkItem): PlaneItem {
    const stateId = typeof item.state === "string" ? item.state : undefined;
    const stateName = stateId ? this.stateNames.get(this.stateKey(context, stateId)) : undefined;
    const displayState = stateName ?? stateId ?? "captured";
    const kind = this.kindFromSdk(context, item);
    const result = {
      id: item.id,
      identifier: String(item.sequence_id),
      title: item.name,
      description: item.description_html,
      stateId,
      stateName: displayState,
      status: toLifecycle(displayState),
      kind,
      dueDate: item.target_date ?? null,
      projectId: context.planeProjectId,
      parentId: item.parent,
      url: itemUrl(this.baseUrl, context.workspaceSlug, context.planeProjectId, item.id),
      updatedAt: String(item.updated_at ?? new Date().toISOString()),
      archived: Boolean(item.archived_at),
    };
    this.rememberItem(context, result.id, result.title, result.kind);
    return result;
  }

  private stateKey(context: ProjectContext, stateId: string): string { return `${context.workspaceSlug}/${context.planeProjectId}/${stateId}`; }
  private typeKindKey(context: ProjectContext, kind: RecordKind): string { return `${context.workspaceSlug}/${context.planeProjectId}/${kind}`; }
  private typeIdKey(context: ProjectContext, typeId: string): string { return `${context.workspaceSlug}/${context.planeProjectId}/${typeId}`; }
  private itemKey(context: ProjectContext, itemId: string): string { return `${context.workspaceSlug}/${context.planeProjectId}/${itemId}`; }
  private rememberItem(context: ProjectContext, itemId: string, title: string, kind?: RecordKind): void {
    const key = this.itemKey(context, itemId);
    this.itemTitles.set(key, title);
    if (kind) this.itemKinds.set(key, kind);
  }
  private kindFromSdk(context: ProjectContext, item: PlaneSdkWorkItem): RecordKind | undefined {
    if (this.typeMode === "default") {
      const prefixedKind = kindForPrefixedTitle(item.name);
      if (prefixedKind) return prefixedKind;
    }
    const value = item as unknown as { type?: unknown; type_id?: unknown };
    if (typeof value.type === "object" && value.type !== null) {
      const type = value.type as { id?: unknown; name?: unknown };
      if (typeof type.id === "string" && typeof type.name === "string") {
        const kind = kindForPlaneTypeName(type.name);
        if (kind) this.typeKinds.set(this.typeIdKey(context, type.id), kind);
        return kind;
      }
    }
    const typeId = typeof value.type === "string" ? value.type : typeof value.type_id === "string" ? value.type_id : undefined;
    return typeId ? this.typeKinds.get(this.typeIdKey(context, typeId)) : undefined;
  }
}

function toLifecycle(status: string): LifecycleState {
  const normalized = status.toLowerCase();
  if (normalized.includes("done") || normalized.includes("complete")) return "done";
  if (normalized.includes("drop") || normalized.includes("cancel")) return "dropped";
  if (normalized.includes("plan") || normalized.includes("todo") || normalized.includes("unstarted")) return "planned";
  if (normalized.includes("progress") || normalized.includes("started")) return "in_progress";
  return "captured";
}

export class FakePlaneAdapter implements PlaneAdapter {
  private readonly projects: PlaneProject[] = [{ id: "demo-project", name: "Demo Project", identifier: "DEMO", workspaceSlug: "demo-workspace" }];
  private readonly items = new Map<string, PlaneItem>();
  private readonly itemSources = new Map<string, string>();
  private readonly activities = new Map<string, PlaneActivity[]>();
  private readonly operationCalls = new Map<FakePlaneOperation, number>();
  private counter = 0;
  fail = false;
  failOnce: FakePlaneFailure | null = null;
  delayMs = 0;
  delayOperation: FakePlaneOperation | null = null;
  calls: string[] = [];
  injectFailure(failure: FakePlaneFailure): void { this.failOnce = failure; }
  async listProjects(): Promise<PlaneProject[]> { this.calls.push("listProjects"); this.ensure(); return [...this.projects]; }
  async listItems(context: ProjectContext): Promise<PlaneItem[]> {
    const call = this.nextCall("listItems");
    this.calls.push("listItems"); this.ensure(); await this.delay("listItems"); this.failIfRequested("listItems", call);
    return [...this.items.values()].filter((item) => item.projectId === context.planeProjectId && !item.archived).map((item) => ({ ...item }));
  }
  async createItem(context: ProjectContext, input: CreateItemInput): Promise<PlaneItem> {
    const call = this.nextCall("createItem");
    this.ensure(); await this.delay("createItem");
    const existingId = [...this.itemSources.entries()].find(([itemId, source]) => source === input.sourceEventId && this.items.get(itemId)?.projectId === context.planeProjectId)?.[0];
    if (existingId) { this.calls.push(`create-existing:${existingId}`); return { ...this.items.get(existingId)! }; }
    this.failIfRequested("createItem", call, input.sourceEventId);
    const item: PlaneItem = { id: `fake-item-${++this.counter}`, identifier: `DEMO-${this.counter}`, title: input.title, description: `${input.description}\n\n${sourceMarker(input.sourceEventId)}`, kind: input.kind, status: input.status, dueDate: input.dueDate ?? null, parentId: input.parentId, projectId: context.planeProjectId, url: `https://plane.test/${this.counter}`, isSystemCreated: true, updatedAt: new Date().toISOString() };
    this.items.set(item.id, item);
    this.itemSources.set(item.id, input.sourceEventId);
    this.calls.push(`create:${item.id}`);
    this.failIfRequested("createItem", call, input.sourceEventId, true);
    return { ...item };
  }
  async updateItem(_context: ProjectContext, itemId: string, input: UpdateItemInput): Promise<PlaneItem> {
    const call = this.nextCall("updateItem");
    this.ensure(); await this.delay("updateItem"); const item = this.items.get(itemId); if (!item) throw new Error("Fake Plane item not found");
    this.failIfRequested("updateItem", call);
    Object.assign(item, input, { updatedAt: new Date().toISOString() }); this.calls.push(`update:${itemId}`);
    this.failIfRequested("updateItem", call, undefined, true);
    return { ...item };
  }
  async addActivity(_context: ProjectContext, itemId: string, body: string, sourceEventId: string): Promise<PlaneActivity> {
    const call = this.nextCall("addActivity");
    this.ensure(); await this.delay("addActivity");
    const existing = this.getActivities(itemId).find((activity) => activity.sourceEventId === sourceEventId);
    if (existing) { this.calls.push(`activity-existing:${itemId}`); return { ...existing }; }
    this.failIfRequested("addActivity", call, sourceEventId);
    const activity: PlaneActivity = { id: `fake-activity-${this.counter++}`, itemId, body, sourceEventId, createdAt: new Date().toISOString() };
    this.activities.set(itemId, [...(this.activities.get(itemId) ?? []), activity]); this.calls.push(`activity:${itemId}`);
    this.failIfRequested("addActivity", call, sourceEventId, true);
    return { ...activity };
  }
  async deleteItem(_context: ProjectContext, itemId: string): Promise<void> { this.ensure(); this.items.delete(itemId); this.itemSources.delete(itemId); this.calls.push(`delete:${itemId}`); }
  async archiveItem(_context: ProjectContext, itemId: string): Promise<void> { await this.updateItem(_context, itemId, { status: "dropped" }); this.items.get(itemId)!.archived = true; }
  getActivities(itemId: string): PlaneActivity[] { return this.activities.get(itemId) ?? []; }
  private nextCall(operation: FakePlaneOperation): number { const call = (this.operationCalls.get(operation) ?? 0) + 1; this.operationCalls.set(operation, call); return call; }
  private async delay(operation: FakePlaneOperation): Promise<void> {
    if (this.delayMs > 0 && (!this.delayOperation || this.delayOperation === operation)) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
  private failIfRequested(operation: FakePlaneOperation, call: number, sourceEventId?: string, afterWrite = false): void {
    const failure = this.failOnce;
    if (!failure || failure.operation !== operation || failure.call !== undefined && failure.call !== call || failure.sourceEventId !== undefined && failure.sourceEventId !== sourceEventId || Boolean(failure.afterWrite) !== afterWrite) return;
    this.failOnce = null;
    throw new Error(`Fake Plane injected ${operation} failure`);
  }
  private ensure(): void { if (this.fail) throw new Error("Fake Plane unavailable"); }
}

export class EventCoordinator {
  constructor(private readonly storage: Storage, private readonly plane: PlaneAdapter) {}

  async syncBatch(batch: BatchRecord, claimToken?: string, assertClaim?: () => void): Promise<void> {
    assertClaim?.();
    const context = this.storage.getContext(batch.projectContextId);
    if (!context) throw new Error("Project context not found for batch");
    const pendingEvents: Array<{ event: SourceEvent; eventId: string; remoteSourceId: string }> = [];
    for (const [index, event] of batch.events.entries()) {
      const currentEventId = eventId(batch.rowId, index);
      const currentRemoteSourceId = remoteSourceId(batch.projectContextId, batch.sessionId, batch.turnId, index);
      const reference = this.storage.addSourceReference({ batchId: batch.id, eventId: currentEventId, remoteSourceId: currentRemoteSourceId, sessionId: batch.sessionId, turnId: batch.turnId, eventType: event.type, summary: event.summary, sourceExcerpt: event.sourceExcerpt, observedAt: event.observedAt ?? new Date().toISOString() });
      if (reference.projectionStatus !== "completed") pendingEvents.push({ event, eventId: currentEventId, remoteSourceId: currentRemoteSourceId });
    }
    if (!pendingEvents.length) {
      assertClaim?.();
      if (!this.storage.areBatchEventsComplete(batch.id, batch.events.length) || !this.storage.setBatchStatus(batch.id, "synced", undefined, claimToken)) throw new Error("Outbox batch claim lost");
      return;
    }
    assertClaim?.();
    const remoteItems = await this.plane.listItems(context);
    assertClaim?.();
    const cachedItems = this.storage.listCachedItems(context.id);
    const itemList = remoteItems.map((remote) => {
      const cached = cachedItems.find((item) => item.id === remote.id);
      return cached ? { ...remote, isSystemCreated: cached.isSystemCreated } : remote;
    });
    itemList.push(...cachedItems.filter((cached) => !remoteItems.some((remote) => remote.id === cached.id)));
    for (const { event, eventId: currentEventId, remoteSourceId: currentRemoteSourceId } of pendingEvents) {
      try {
        assertClaim?.();
        this.storage.markEventAttempt(currentEventId, claimToken);
        const planeItemId = await this.projectEvent(context, batch, currentEventId, currentRemoteSourceId, event, itemList, claimToken, assertClaim);
        assertClaim?.();
        this.storage.markEventCompleted(currentEventId, planeItemId, claimToken);
      } catch (error) {
        this.storage.markEventFailed(currentEventId, error instanceof Error ? error.message : String(error), claimToken);
        throw error;
      }
    }
    assertClaim?.();
    if (!this.storage.areBatchEventsComplete(batch.id, batch.events.length) || !this.storage.setBatchStatus(batch.id, "synced", undefined, claimToken)) throw new Error("Outbox batch claim lost");
  }

  private async projectEvent(context: ProjectContext, batch: BatchRecord, currentEventId: string, currentRemoteSourceId: string, event: SourceEvent, items: PlaneItem[], claimToken?: string, assertClaim?: () => void): Promise<string | null> {
    assertClaim?.();
    const existing = this.resolveItem(currentEventId, currentRemoteSourceId, event, items, claimToken);
    if (event.type === "progress" || event.type === "decision") {
      if (existing) {
        assertClaim?.();
        await this.plane.addActivity(context, existing.id, event.summary, currentRemoteSourceId);
        assertClaim?.();
        if (event.type === "progress" && event.relatedItemId && existing.isSystemCreated) {
          const owned = this.storage.getFieldOwnership(existing.id, "status");
          if (!owned || owned.owner === "system") {
            assertClaim?.();
            const updated = await this.plane.updateItem(context, existing.id, { status: "in_progress" });
            assertClaim?.();
            this.storage.cacheItem(context.id, updated, existing.isSystemCreated);
          }
        }
        this.storage.updateSourcePlaneItem(currentEventId, existing.id, claimToken);
        return existing.id;
      } else if (event.type === "decision") {
        const created = await this.create(context, batch, event, currentRemoteSourceId, "decision", assertClaim);
        this.storage.updateSourcePlaneItem(currentEventId, created.id, claimToken);
        items.push(created);
        return created.id;
      }
      return null;
    }
    if (event.type === "completed") {
      if (existing) {
        const owned = this.storage.getFieldOwnership(existing.id, "status");
        if (event.userDirected || (existing.isSystemCreated && (!owned || owned.owner === "system"))) {
          assertClaim?.();
          const updated = await this.plane.updateItem(context, existing.id, { status: "done" });
          assertClaim?.();
          this.storage.cacheItem(context.id, updated, existing.isSystemCreated);
        }
        if (event.archiveAfterCompletion) {
          if (!existing.isSystemCreated) throw new Error("Only system-created items can be archived after completion");
          assertClaim?.();
          await this.plane.archiveItem(context, existing.id);
          assertClaim?.();
          this.storage.markCacheArchived(existing.id);
          existing.archived = true;
        }
        assertClaim?.();
        this.storage.updateSourcePlaneItem(currentEventId, existing.id, claimToken);
        return existing.id;
      }
      return null;
    }
    if (event.type === "plan") {
      return this.projectPlan(context, batch, currentEventId, currentRemoteSourceId, event, items, existing, claimToken, assertClaim);
    }
    if (existing) {
      const update: UpdateItemInput = {};
      if (existing.isSystemCreated || event.userDirected) {
        if (this.storage.getFieldOwnership(existing.id, "description")?.owner !== "user") update.description = appendDescription(existing.description, event.summary);
        if (event.dueDate && this.storage.getFieldOwnership(existing.id, "dueDate")?.owner !== "user") update.dueDate = event.dueDate;
        if (Object.keys(update).length) {
          assertClaim?.();
          const updated = await this.plane.updateItem(context, existing.id, update);
          assertClaim?.();
          this.storage.cacheItem(context.id, updated, existing.isSystemCreated);
        }
      }
      assertClaim?.();
      await this.plane.addActivity(context, existing.id, event.summary, currentRemoteSourceId);
      assertClaim?.();
      this.storage.updateSourcePlaneItem(currentEventId, existing.id, claimToken);
      return existing.id;
    }
    const kind = recordKindForEvent(event);
    if (!kind) return null;
    const created = await this.create(context, batch, event, currentRemoteSourceId, kind, assertClaim);
    this.storage.updateSourcePlaneItem(currentEventId, created.id, claimToken);
    items.push(created);
    return created.id;
  }

  private async projectPlan(context: ProjectContext, batch: BatchRecord, currentEventId: string, currentRemoteSourceId: string, event: SourceEvent, items: PlaneItem[], existing: PlaneItem | null, claimToken?: string, assertClaim?: () => void): Promise<string> {
    const parent = existing ?? await this.create(context, batch, event, currentRemoteSourceId, "task", assertClaim);
    assertClaim?.();
    if (!items.some((item) => item.id === parent.id)) items.push(parent);
    this.storage.updateSourcePlaneItem(currentEventId, parent.id, claimToken);
    for (const [index, step] of (event.steps ?? []).entries()) {
      assertClaim?.();
      const child = await this.plane.createItem(context, { title: step.title, description: step.summary ?? "执行步骤", kind: "task", status: "planned", parentId: parent.id, sourceEventId: stepSourceEventId(currentRemoteSourceId, index) });
      assertClaim?.();
      this.storage.cacheItem(context.id, child, true);
      if (!items.some((item) => item.id === child.id)) items.push(child);
    }
    return parent.id;
  }

  private async create(context: ProjectContext, batch: BatchRecord, event: SourceEvent, currentRemoteSourceId: string, kind: RecordKind, assertClaim?: () => void): Promise<PlaneItem> {
    assertClaim?.();
    const created = await this.plane.createItem(context, { title: event.title, description: `${event.summary}${sourceFooter(currentRemoteSourceId, batch.sessionId, batch.turnId)}`, kind, status: lifecycleForEvent(event), dueDate: event.dueDate ?? null, sourceEventId: currentRemoteSourceId });
    assertClaim?.();
    this.storage.cacheItem(context.id, created, true);
    for (const field of ["title", "description", "kind", "status", "dueDate"] as const) {
      const value = field === "title" ? created.title : field === "description" ? created.description ?? null : field === "kind" ? created.kind ?? null : field === "status" ? created.status ?? null : created.dueDate ?? null;
      this.storage.setFieldOwnership(created.id, field, "system", value);
    }
    return created;
  }

  private resolveItem(currentEventId: string, currentRemoteSourceId: string, event: SourceEvent, planeItems: PlaneItem[], claimToken?: string): PlaneItem | null {
    const reference = this.storage.getSourceReference(currentEventId);
    const relatedItemId = reference?.planeItemId ?? event.relatedItemId?.trim();
    // relatedItemId is an exact Plane UUID or user-visible identifier; titles are never used as references.
    if (relatedItemId) {
      const resolved = planeItems.find((item) => item.id === relatedItemId)
        ?? planeItems.find((item) => item.identifier === relatedItemId)
        ?? this.storage.getCachedItem(relatedItemId);
      if (!resolved) throw new UnresolvedRelatedItemError(relatedItemId, event.type, currentEventId);
      if (resolved && reference?.planeItemId !== resolved.id) this.storage.updateSourcePlaneItem(currentEventId, resolved.id, claimToken);
      return resolved;
    }
    if (event.type === "plan") return planeItems.find((item) => hasSourceMarker(item.description, currentRemoteSourceId)) ?? null;
    return null;
  }

  async refreshCache(context: ProjectContext): Promise<PlaneItem[]> {
    const remoteItems = await this.plane.listItems(context);
    const cached = this.storage.listAllCachedItems(context.id);
    for (const item of remoteItems) {
      const old = this.storage.getCachedItem(item.id);
      if (old) {
        for (const field of ["title", "description", "kind", "status", "dueDate"] as const) {
          const remoteValue = field === "title" ? item.title : field === "description" ? item.description ?? null : field === "kind" ? item.kind ?? null : field === "status" ? item.status ?? null : item.dueDate ?? null;
          const ownership = this.storage.getFieldOwnership(item.id, field);
          if (ownership?.owner === "system" && ownership.systemValue !== remoteValue) this.storage.setFieldOwnership(item.id, field, "user", remoteValue);
        }
      }
      this.storage.cacheItem(context.id, item, old?.isSystemCreated ?? item.isSystemCreated ?? false);
    }
    for (const old of cached) if (!remoteItems.some((item) => item.id === old.id)) this.storage.markCacheArchived(old.id, true);
    return this.storage.listAllCachedItems(context.id);
  }

  async editItem(context: ProjectContext, itemId: string, input: UpdateItemInput): Promise<PlaneItem> {
    const current = this.storage.getCachedItem(itemId);
    if (!current) throw new Error("Project item not found");
    const editable = { ...input };
    if (editable.title !== undefined) this.storage.setFieldOwnership(itemId, "title", "user", editable.title);
    if (editable.description !== undefined) this.storage.setFieldOwnership(itemId, "description", "user", editable.description);
    if (editable.kind !== undefined) this.storage.setFieldOwnership(itemId, "kind", "user", editable.kind);
    if (editable.status !== undefined) this.storage.setFieldOwnership(itemId, "status", "user", editable.status);
    if (editable.dueDate !== undefined) this.storage.setFieldOwnership(itemId, "dueDate", "user", editable.dueDate);
    const updated = await this.plane.updateItem(context, itemId, editable);
    this.storage.cacheItem(context.id, updated, current.isSystemCreated);
    return updated;
  }

  async changeStatus(context: ProjectContext, itemId: string, status: LifecycleState): Promise<PlaneItem> {
    const current = this.storage.getCachedItem(itemId);
    if (!current) throw new Error("Project item not found");
    const updated = await this.plane.updateItem(context, itemId, { status });
    const result = { ...current, ...updated, status: updated.status ?? status, kind: updated.kind ?? current.kind, isSystemCreated: current.isSystemCreated };
    this.storage.setFieldOwnership(itemId, "status", "user", result.status ?? status);
    this.storage.cacheItem(context.id, result, current.isSystemCreated);
    return result;
  }

  async archiveItem(context: ProjectContext, itemId: string): Promise<void> { const current = this.storage.getCachedItem(itemId); if (!current?.isSystemCreated) throw new Error("Only system-created items can be archived by the panel"); await this.plane.archiveItem(context, itemId); this.storage.markCacheArchived(itemId); }
  async deleteItem(context: ProjectContext, itemId: string): Promise<void> { const current = this.storage.getCachedItem(itemId); if (!current?.isSystemCreated) throw new Error("Only system-created items can be deleted by the panel"); await this.plane.deleteItem(context, itemId); this.storage.markCacheArchived(itemId); }
  async mergeItems(context: ProjectContext, sourceId: string, targetId: string): Promise<void> { const source = this.storage.getCachedItem(sourceId); const target = this.storage.getCachedItem(targetId); if (!source?.isSystemCreated || !target) throw new Error("Merge requires a system-created source and an existing target"); await this.plane.addActivity(context, targetId, `已合并记录：${source.identifier} ${source.title}`, `merge_${sourceId}_${targetId}`); await this.deleteItem(context, sourceId); }
}

function appendDescription(existing: string | undefined, next: string): string { return existing?.includes(next) ? existing : `${existing ? `${existing}\n\n` : ""}${next}`; }

export interface CreatePlaneAdapterOptions { storage?: Storage; requestIntervalMs?: number; }

export type PlaneConfiguration =
  | { mode: "fake" }
  | { mode: "sdk"; baseUrl: string; apiKey: string; workspaceSlug: string; typeMode: PlaneTypeMode };

/** Pure configuration seam shared by runtimes so invalid setup fails before Storage opens a database. */
export function validatePlaneConfiguration(env: Record<string, string | undefined> = process.env): PlaneConfiguration {
  const mode = env.PLANE_MODE?.trim();
  if (!mode) throw new Error("PLANE_MODE is required; use PLANE_MODE=sdk for the formal plugin or PLANE_MODE=fake only for explicit tests");
  if (mode === "fake") return { mode: "fake" };
  if (mode !== "sdk") throw new Error(`Unsupported PLANE_MODE: ${mode}; use fake or sdk`);
  const baseUrl = env.PLANE_BASE_URL;
  const apiKey = env.PLANE_API_KEY;
  const workspaceSlug = env.PLANE_WORKSPACE_SLUG;
  if (!baseUrl || !apiKey || !workspaceSlug) throw new Error("PLANE_BASE_URL, PLANE_API_KEY, and PLANE_WORKSPACE_SLUG are required when PLANE_MODE=sdk");
  const typeMode = env.PLANE_TYPE_MODE?.trim() || "default";
  if (typeMode !== "default" && typeMode !== "custom") throw new Error("PLANE_TYPE_MODE must be default or custom");
  return { mode: "sdk", baseUrl, apiKey, workspaceSlug, typeMode };
}

export function createPlaneAdapter(options: CreatePlaneAdapterOptions = {}): PlaneAdapter {
  const configuration = validatePlaneConfiguration();
  if (configuration.mode === "fake") return new FakePlaneAdapter();
  const { baseUrl, apiKey, workspaceSlug, typeMode } = configuration;
  bypassPlainHttpsProxyForPlane(baseUrl);
  const requestGate = options.storage ? new SqlitePlaneRequestGate(options.storage, `plane:${baseUrl}`, options.requestIntervalMs ?? 2_000) : undefined;
  return new PlaneSdkAdapter(baseUrl, apiKey, workspaceSlug, { typeMode, requestGate });
}
