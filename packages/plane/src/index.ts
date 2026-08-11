import {
  BatchRecord, LifecycleState, PlaneActivity, PlaneItem, PlaneProject, ProjectContext,
  RecordKind, SourceEvent, eventId, lifecycleForEvent, normalizeTitle, recordKindForEvent, sourceFooter,
} from "@ambient/core";
import { Storage } from "@ambient/storage";
import { PlaneClient, State as PlaneSdkState, WorkItem as PlaneSdkWorkItem } from "@makeplane/plane-node-sdk";

export interface CreateItemInput { title: string; description: string; kind: RecordKind; status: LifecycleState; dueDate?: string | null; parentId?: string; sourceEventId: string; }
export interface UpdateItemInput { title?: string; description?: string; kind?: RecordKind; status?: LifecycleState; dueDate?: string | null; }

export interface PlaneAdapter {
  listProjects(): Promise<PlaneProject[]>;
  listItems(context: ProjectContext): Promise<PlaneItem[]>;
  createItem(context: ProjectContext, input: CreateItemInput): Promise<PlaneItem>;
  updateItem(context: ProjectContext, itemId: string, input: UpdateItemInput): Promise<PlaneItem>;
  addActivity(context: ProjectContext, itemId: string, body: string, sourceEventId: string): Promise<PlaneActivity>;
  deleteItem(context: ProjectContext, itemId: string): Promise<void>;
  archiveItem(context: ProjectContext, itemId: string): Promise<void>;
}

function itemUrl(baseUrl: string, workspace: string, project: string, itemId: string): string { return `${baseUrl.replace(/\/$/, "")}/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/work-items/${encodeURIComponent(itemId)}`; }

export class PlaneSdkAdapter implements PlaneAdapter {
  private readonly client: PlaneClient;
  private readonly stateIds = new Map<string, string>();
  private readonly stateNames = new Map<string, string>();

  constructor(private readonly baseUrl: string, apiKey: string, private readonly defaultWorkspace: string) {
    this.client = new PlaneClient({ baseUrl, apiKey });
  }

  async listProjects(): Promise<PlaneProject[]> {
    const payload = await this.client.projects.list(this.defaultWorkspace, { limit: 100 });
    return payload.results.map((project) => ({ id: project.id, name: project.name, identifier: project.identifier, workspaceSlug: this.defaultWorkspace }));
  }

  async listItems(context: ProjectContext): Promise<PlaneItem[]> {
    await this.loadStates(context);
    const payload = await this.client.workItems.list(context.workspaceSlug, context.planeProjectId, { limit: 100 });
    return payload.results.map((item) => this.fromSdk(context, item));
  }

  async createItem(context: ProjectContext, input: CreateItemInput): Promise<PlaneItem> {
    const stateId = await this.resolveStateId(context, input.status);
    const payload = await this.client.workItems.create(context.workspaceSlug, context.planeProjectId, {
      name: input.title,
      description_html: input.description,
      state: stateId,
      target_date: input.dueDate ?? undefined,
      parent: input.parentId,
    });
    return {
      ...this.fromSdk(context, payload),
      isSystemCreated: true,
      url: itemUrl(this.baseUrl, context.workspaceSlug, context.planeProjectId, payload.id),
      kind: input.kind,
    };
  }

  async updateItem(context: ProjectContext, itemId: string, input: UpdateItemInput): Promise<PlaneItem> {
    const stateId = input.status ? await this.resolveStateId(context, input.status) : undefined;
    const payload = await this.client.workItems.update(context.workspaceSlug, context.planeProjectId, itemId, {
      name: input.title,
      description_html: input.description,
      state: stateId,
      target_date: input.dueDate ?? undefined,
    });
    return this.fromSdk(context, payload);
  }

  async addActivity(context: ProjectContext, itemId: string, body: string, sourceEventId: string): Promise<PlaneActivity> {
    const payload = await this.client.workItems.comments.create(context.workspaceSlug, context.planeProjectId, itemId, { comment_html: `${body}\n\n[ambient:${sourceEventId}]` });
    return { id: payload.id, itemId, body, createdAt: String(payload.created_at ?? new Date().toISOString()), sourceEventId };
  }

  async deleteItem(context: ProjectContext, itemId: string): Promise<void> { await this.client.workItems.delete(context.workspaceSlug, context.planeProjectId, itemId); }

  async archiveItem(context: ProjectContext, itemId: string): Promise<void> { await this.client.workItems.archive(context.workspaceSlug, context.planeProjectId, itemId); }

  private async loadStates(context: ProjectContext): Promise<PlaneSdkState[]> {
    const payload = await this.client.states.list(context.workspaceSlug, context.planeProjectId, { limit: 100 });
    for (const state of payload.results) this.stateNames.set(this.stateKey(context, state.id), state.name);
    return payload.results;
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

  private fromSdk(context: ProjectContext, item: PlaneSdkWorkItem): PlaneItem {
    const stateId = typeof item.state === "string" ? item.state : undefined;
    const stateName = stateId ? this.stateNames.get(this.stateKey(context, stateId)) : undefined;
    const displayState = stateName ?? stateId ?? "captured";
    return {
      id: item.id,
      identifier: String(item.sequence_id),
      title: item.name,
      description: item.description_html,
      stateId,
      stateName: displayState,
      status: toLifecycle(displayState),
      dueDate: item.target_date ?? null,
      projectId: context.planeProjectId,
      url: itemUrl(this.baseUrl, context.workspaceSlug, context.planeProjectId, item.id),
      updatedAt: String(item.updated_at ?? new Date().toISOString()),
      archived: Boolean(item.archived_at),
    };
  }

  private stateKey(context: ProjectContext, stateId: string): string { return `${context.workspaceSlug}/${context.planeProjectId}/${stateId}`; }
}

function toLifecycle(status: string): LifecycleState {
  const normalized = status.toLowerCase();
  if (normalized.includes("done") || normalized.includes("complete")) return "done";
  if (normalized.includes("progress") || normalized.includes("started")) return "in_progress";
  if (normalized.includes("drop") || normalized.includes("cancel")) return "dropped";
  if (normalized.includes("plan")) return "planned";
  return "captured";
}

export class FakePlaneAdapter implements PlaneAdapter {
  private readonly projects: PlaneProject[] = [{ id: "demo-project", name: "Demo Project", identifier: "DEMO", workspaceSlug: "demo-workspace" }];
  private readonly items = new Map<string, PlaneItem>();
  private readonly activities = new Map<string, PlaneActivity[]>();
  private counter = 0;
  fail = false;
  calls: string[] = [];
  async listProjects(): Promise<PlaneProject[]> { this.calls.push("listProjects"); this.ensure(); return [...this.projects]; }
  async listItems(context: ProjectContext): Promise<PlaneItem[]> { this.calls.push("listItems"); this.ensure(); return [...this.items.values()].filter((item) => item.projectId === context.planeProjectId && !item.archived); }
  async createItem(context: ProjectContext, input: CreateItemInput): Promise<PlaneItem> { this.ensure(); const item: PlaneItem = { id: `fake-item-${++this.counter}`, identifier: `DEMO-${this.counter}`, title: input.title, description: input.description, kind: input.kind, status: input.status, dueDate: input.dueDate ?? null, projectId: context.planeProjectId, url: `https://plane.test/${this.counter}`, isSystemCreated: true, updatedAt: new Date().toISOString() }; this.items.set(item.id, item); this.calls.push(`create:${item.id}`); return item; }
  async updateItem(_context: ProjectContext, itemId: string, input: UpdateItemInput): Promise<PlaneItem> { this.ensure(); const item = this.items.get(itemId); if (!item) throw new Error("Fake Plane item not found"); Object.assign(item, input, { updatedAt: new Date().toISOString() }); this.calls.push(`update:${itemId}`); return { ...item }; }
  async addActivity(_context: ProjectContext, itemId: string, body: string, sourceEventId: string): Promise<PlaneActivity> { this.ensure(); const activity: PlaneActivity = { id: `fake-activity-${this.counter++}`, itemId, body, sourceEventId, createdAt: new Date().toISOString() }; this.activities.set(itemId, [...(this.activities.get(itemId) ?? []), activity]); this.calls.push(`activity:${itemId}`); return activity; }
  async deleteItem(_context: ProjectContext, itemId: string): Promise<void> { this.ensure(); this.items.delete(itemId); this.calls.push(`delete:${itemId}`); }
  async archiveItem(_context: ProjectContext, itemId: string): Promise<void> { await this.updateItem(_context, itemId, { status: "dropped" }); this.items.get(itemId)!.archived = true; }
  getActivities(itemId: string): PlaneActivity[] { return this.activities.get(itemId) ?? []; }
  private ensure(): void { if (this.fail) throw new Error("Fake Plane unavailable"); }
}

export class EventCoordinator {
  constructor(private readonly storage: Storage, private readonly plane: PlaneAdapter) {}

  async syncBatch(batch: BatchRecord): Promise<void> {
    const context = this.storage.getContext(batch.projectContextId);
    if (!context) throw new Error("Project context not found for batch");
    const remoteItems = await this.plane.listItems(context);
    const cachedItems = this.storage.listCachedItems(context.id);
    const itemList = remoteItems.map((remote) => {
      const cached = cachedItems.find((item) => item.id === remote.id);
      return cached ? { ...remote, isSystemCreated: cached.isSystemCreated } : remote;
    });
    itemList.push(...cachedItems.filter((cached) => !remoteItems.some((remote) => remote.id === cached.id)));
    for (const [index, event] of batch.events.entries()) {
      const currentEventId = eventId(batch.rowId, index);
      this.storage.addSourceReference({ batchId: batch.id, eventId: currentEventId, planeItemId: event.relatedItemId ?? null, sessionId: batch.sessionId, turnId: batch.turnId, eventType: event.type, summary: event.summary, sourceExcerpt: event.sourceExcerpt, observedAt: event.observedAt ?? new Date().toISOString() });
      await this.projectEvent(context, batch, currentEventId, event, itemList);
    }
    this.storage.setBatchStatus(batch.id, "synced");
  }

  private async projectEvent(context: ProjectContext, batch: BatchRecord, currentEventId: string, event: SourceEvent, items: PlaneItem[]): Promise<void> {
    const existing = this.resolveItem(context.id, event, items);
    if (event.type === "progress" || event.type === "decision") {
      if (existing) {
        await this.plane.addActivity(context, existing.id, event.summary, currentEventId);
        this.storage.updateSourcePlaneItem(currentEventId, existing.id);
      } else if (event.type === "decision") {
        const created = await this.create(context, batch, event, currentEventId, "decision");
        this.storage.updateSourcePlaneItem(currentEventId, created.id);
        items.push(created);
      }
      return;
    }
    if (event.type === "completed") {
      if (existing) {
        const owned = this.storage.getFieldOwnership(existing.id, "status");
        if (event.userDirected || (existing.isSystemCreated && (!owned || owned.owner === "system"))) await this.plane.updateItem(context, existing.id, { status: "done" });
        this.storage.updateSourcePlaneItem(currentEventId, existing.id);
      }
      return;
    }
    if (existing && (event.relatedItemId || this.isSameSystemTitle(existing, event))) {
      const update: UpdateItemInput = {};
      if (existing.isSystemCreated || event.userDirected) {
        if (this.storage.getFieldOwnership(existing.id, "description")?.owner !== "user") update.description = appendDescription(existing.description, event.summary);
        if (event.dueDate && this.storage.getFieldOwnership(existing.id, "dueDate")?.owner !== "user") update.dueDate = event.dueDate;
        if (Object.keys(update).length) await this.plane.updateItem(context, existing.id, update);
      }
      await this.plane.addActivity(context, existing.id, event.summary, currentEventId);
      this.storage.updateSourcePlaneItem(currentEventId, existing.id);
      return;
    }
    const kind = recordKindForEvent(event);
    if (!kind) return;
    const created = await this.create(context, batch, event, currentEventId, kind);
    this.storage.updateSourcePlaneItem(currentEventId, created.id);
    items.push(created);
    if (event.type === "plan" && event.steps?.length) {
      for (const step of event.steps) {
        const child = await this.plane.createItem(context, { title: step.title, description: step.summary ?? "执行步骤", kind: "task", status: "planned", parentId: created.id, sourceEventId: currentEventId });
        this.storage.cacheItem(context.id, child, true);
      }
    }
  }

  private async create(context: ProjectContext, batch: BatchRecord, event: SourceEvent, currentEventId: string, kind: RecordKind): Promise<PlaneItem> {
    const created = await this.plane.createItem(context, { title: event.title, description: `${event.summary}${sourceFooter(currentEventId, batch.sessionId, batch.turnId)}`, kind, status: lifecycleForEvent(event), dueDate: event.dueDate ?? null, sourceEventId: currentEventId });
    this.storage.cacheItem(context.id, created, true);
    for (const field of ["title", "description", "kind", "status", "dueDate"] as const) {
      const value = field === "title" ? created.title : field === "description" ? created.description ?? null : field === "kind" ? created.kind ?? null : field === "status" ? created.status ?? null : created.dueDate ?? null;
      this.storage.setFieldOwnership(created.id, field, "system", value);
    }
    return created;
  }

  private resolveItem(contextId: string, event: SourceEvent, planeItems: PlaneItem[]): PlaneItem | null {
    if (event.relatedItemId) return planeItems.find((item) => item.id === event.relatedItemId || item.identifier === event.relatedItemId) ?? this.storage.getCachedItem(event.relatedItemId);
    const wanted = normalizeTitle(event.title);
    return planeItems.find((item) => item.isSystemCreated && normalizeTitle(item.title) === wanted) ?? null;
  }

  private isSameSystemTitle(item: PlaneItem, event: SourceEvent): boolean { return Boolean(item.isSystemCreated) && normalizeTitle(item.title) === normalizeTitle(event.title); }

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

  async archiveItem(context: ProjectContext, itemId: string): Promise<void> { const current = this.storage.getCachedItem(itemId); if (!current?.isSystemCreated) throw new Error("Only system-created items can be archived by the panel"); await this.plane.archiveItem(context, itemId); this.storage.markCacheArchived(itemId); }
  async deleteItem(context: ProjectContext, itemId: string): Promise<void> { const current = this.storage.getCachedItem(itemId); if (!current?.isSystemCreated) throw new Error("Only system-created items can be deleted by the panel"); await this.plane.deleteItem(context, itemId); this.storage.markCacheArchived(itemId); }
  async mergeItems(context: ProjectContext, sourceId: string, targetId: string): Promise<void> { const source = this.storage.getCachedItem(sourceId); const target = this.storage.getCachedItem(targetId); if (!source?.isSystemCreated || !target) throw new Error("Merge requires a system-created source and an existing target"); await this.plane.addActivity(context, targetId, `已合并记录：${source.identifier} ${source.title}`, `merge_${sourceId}_${targetId}`); await this.deleteItem(context, sourceId); }
}

function appendDescription(existing: string | undefined, next: string): string { return existing?.includes(next) ? existing : `${existing ? `${existing}\n\n` : ""}${next}`; }

export function createPlaneAdapter(): PlaneAdapter {
  const mode = process.env.PLANE_MODE ?? "fake";
  if (mode === "fake") return new FakePlaneAdapter();
  if (mode !== "sdk") throw new Error(`Unsupported PLANE_MODE: ${mode}; use fake or sdk`);
  const baseUrl = process.env.PLANE_BASE_URL;
  const apiKey = process.env.PLANE_API_KEY;
  const workspaceSlug = process.env.PLANE_WORKSPACE_SLUG;
  if (!baseUrl || !apiKey || !workspaceSlug) throw new Error("PLANE_BASE_URL, PLANE_API_KEY, and PLANE_WORKSPACE_SLUG are required when PLANE_MODE=sdk");
  return new PlaneSdkAdapter(baseUrl, apiKey, workspaceSlug);
}
