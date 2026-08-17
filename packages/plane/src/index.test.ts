import { describe, expect, it } from "vitest";
import { createPlaneAdapter, EventCoordinator, FakePlaneAdapter, PlaneSdkAdapter } from "./index.js";
import { Storage } from "@ambient/storage";
import { PlaneClient } from "@makeplane/plane-node-sdk";
import { recordKinds, remoteSourceId, type RecordKind } from "@ambient/core";

const bug = (title = "登录页面偶尔会白屏") => ({ type: "bug" as const, title, summary: title, userDirected: true, sourceExcerpt: title });

function sdkHarness(stateDefinitions = [{ id: "state-captured", name: "Backlog", group: "backlog" }]) {
  const types: Array<{ id: string; name: string; description?: string; is_active: boolean; is_epic: boolean }> = [];
  const items: Array<Record<string, unknown>> = [];
  const createPayloads: Array<Record<string, unknown>> = [];
  const updatePayloads: Array<Record<string, unknown>> = [];
  const client = {
    workItemTypes: {
      list: async () => types,
      create: async (_workspace: string, _project: string, input: Record<string, unknown>) => {
        const type = { id: `type-${types.length + 1}`, name: String(input.name), description: String(input.description ?? ""), is_active: true, is_epic: false };
        types.push(type);
        return type;
      },
    },
    states: { list: async () => ({ results: stateDefinitions }) },
    workItems: {
      list: async (_workspace: string, _project: string, params: Record<string, unknown> = {}) => {
        const start = Number(params.cursor ?? 0);
        const results = items.slice(start, start + 100);
        const nextPageResults = start + results.length < items.length;
        return { results, next_cursor: String(start + results.length), next_page_results: nextPageResults };
      },
      create: async (_workspace: string, project: string, input: Record<string, unknown>) => {
        createPayloads.push(input);
        const item = { id: `item-${items.length + 1}`, sequence_id: items.length + 1, project, ...input, updated_at: "2026-08-12T00:00:00.000Z" };
        items.push(item);
        return item;
      },
      update: async (_workspace: string, _project: string, itemId: string, input: Record<string, unknown>) => {
        updatePayloads.push(input);
        const item = items.find((candidate) => candidate.id === itemId)!;
        Object.assign(item, input);
        return item;
      },
    },
  };
  return { adapter: new PlaneSdkAdapter("https://api.plane.so", "test-key", "demo-workspace", client as unknown as PlaneClient), types, items, createPayloads, updatePayloads };
}

const sdkContext = { id: "project_1", cwd: "/work", canonicalCwd: "/work", planeBaseUrl: "https://api.plane.so", workspaceSlug: "demo-workspace", planeProjectId: "demo-project", autoCaptureEnabled: true, createdAt: "now", updatedAt: "now" };

describe("Plane projection", () => {
  it("loads every Plane work-item page for authoritative project counts", async () => {
    const { adapter, items } = sdkHarness();
    for (let index = 0; index < 101; index += 1) items.push({ id: `item-${index}`, sequence_id: index + 1, project: "demo-project", name: `Item ${index}`, state: "state-captured", updated_at: "2026-08-13T00:00:00.000Z" });

    expect(await adapter.listItems(sdkContext)).toHaveLength(101);
  });

  it("stops when Plane returns a terminal cursor with no next-page results", async () => {
    const { adapter, items } = sdkHarness();
    items.push({ id: "item-1", sequence_id: 1, project: "demo-project", name: "Only item", state: "state-captured", updated_at: "2026-08-13T00:00:00.000Z" });

    await expect(adapter.listItems(sdkContext)).resolves.toHaveLength(1);
  });

  it("requires an explicit Plane mode instead of silently creating a Demo Project", () => {
    const previousMode = process.env.PLANE_MODE;
    delete process.env.PLANE_MODE;
    try {
      expect(() => createPlaneAdapter()).toThrow("PLANE_MODE is required");
    } finally {
      if (previousMode === undefined) delete process.env.PLANE_MODE;
      else process.env.PLANE_MODE = previousMode;
    }
  });

  it("uses the SDK only when the host supplies an explicit SDK configuration", () => {
    const previous = {
      mode: process.env.PLANE_MODE,
      baseUrl: process.env.PLANE_BASE_URL,
      apiKey: process.env.PLANE_API_KEY,
      workspace: process.env.PLANE_WORKSPACE_SLUG,
    };
    process.env.PLANE_MODE = "sdk";
    process.env.PLANE_BASE_URL = "https://api.plane.so";
    process.env.PLANE_API_KEY = "test-only-key";
    process.env.PLANE_WORKSPACE_SLUG = "test-workspace";
    try {
      expect(createPlaneAdapter()).toBeInstanceOf(PlaneSdkAdapter);
    } finally {
      for (const [name, value] of Object.entries({
        PLANE_MODE: previous.mode,
        PLANE_BASE_URL: previous.baseUrl,
        PLANE_API_KEY: previous.apiKey,
        PLANE_WORKSPACE_SLUG: previous.workspace,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("bypasses an HTTP HTTPS proxy for the Plane SDK host", () => {
    const previous = {
      mode: process.env.PLANE_MODE,
      baseUrl: process.env.PLANE_BASE_URL,
      apiKey: process.env.PLANE_API_KEY,
      workspace: process.env.PLANE_WORKSPACE_SLUG,
      httpsProxy: process.env.https_proxy,
      httpsProxyUpper: process.env.HTTPS_PROXY,
      noProxy: process.env.no_proxy,
      noProxyUpper: process.env.NO_PROXY,
    };
    process.env.PLANE_MODE = "sdk";
    process.env.PLANE_BASE_URL = "https://api.plane.so";
    process.env.PLANE_API_KEY = "test-only-key";
    process.env.PLANE_WORKSPACE_SLUG = "test-workspace";
    process.env.https_proxy = "http://127.0.0.1:10808";
    delete process.env.HTTPS_PROXY;
    delete process.env.no_proxy;
    delete process.env.NO_PROXY;
    try {
      expect(createPlaneAdapter()).toBeInstanceOf(PlaneSdkAdapter);
      expect(process.env.no_proxy).toBe("api.plane.so");
    } finally {
      for (const [name, value] of Object.entries({
        PLANE_MODE: previous.mode,
        PLANE_BASE_URL: previous.baseUrl,
        PLANE_API_KEY: previous.apiKey,
        PLANE_WORKSPACE_SLUG: previous.workspace,
        https_proxy: previous.httpsProxy,
        HTTPS_PROXY: previous.httpsProxyUpper,
        no_proxy: previous.noProxy,
        NO_PROXY: previous.noProxyUpper,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it.each(recordKinds)("writes and restores the %s classification through a Plane work item type", async (kind: RecordKind) => {
    const { adapter, types, createPayloads } = sdkHarness();
    const created = await adapter.createItem(sdkContext, { title: `${kind} record`, description: "record", kind, status: "captured", sourceEventId: `event-${kind}` });
    const type = types.find((candidate) => candidate.id === createPayloads[0]?.type);
    expect(type?.name.toLowerCase()).toBe(kind);
    expect(created.kind).toBe(kind);
    expect((await adapter.listItems(sdkContext))[0]?.kind).toBe(kind);
  });

  it("writes a Panel reclassification back to the Plane work item type", async () => {
    const { adapter, items, updatePayloads } = sdkHarness();
    const created = await adapter.createItem(sdkContext, { title: "record", description: "record", kind: "task", status: "captured", sourceEventId: "event-task" });
    const updated = await adapter.updateItem(sdkContext, created.id, { kind: "risk" });
    expect(updatePayloads[0]?.type).toBe(items[0]?.type);
    expect(updated.kind).toBe("risk");
    expect((await adapter.listItems(sdkContext))[0]?.kind).toBe("risk");
  });

  it("maps real Plane Todo/unstarted states for plan parents and steps", async () => {
    const { adapter, items, createPayloads } = sdkHarness([
      { id: "state-backlog", name: "Backlog", group: "backlog" },
      { id: "state-todo", name: "Todo", group: "unstarted" },
      { id: "state-progress", name: "In Progress", group: "started" },
      { id: "state-done", name: "Done", group: "completed" },
      { id: "state-cancelled", name: "Cancelled", group: "cancelled" },
    ]);
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://api.plane.so", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const coordinator = new EventCoordinator(storage, adapter);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "plan", events: [{ type: "plan", title: "发布计划", summary: "按步骤发布", userDirected: true, sourceExcerpt: "发布计划", steps: [{ title: "准备", summary: "准备环境" }, { title: "发布", summary: "发布版本" }] }] });

    await coordinator.syncBatch(storage.listPendingBatches()[0]!);

    expect(createPayloads.map((payload) => payload.state)).toEqual(["state-todo", "state-todo", "state-todo"]);
    expect(items.filter((item) => item.parent).map((item) => item.state)).toEqual(["state-todo", "state-todo"]);
    const refreshed = await coordinator.refreshCache(context);
    expect(refreshed).toHaveLength(3);
    expect(refreshed.every((item) => item.status === "planned")).toBe(true);
    storage.close();
  });

  it("completes then archives an explicitly superseded system plan item", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "plan", events: [{ type: "plan", title: "Old plan", summary: "Old plan", userDirected: true, sourceExcerpt: "make a plan" }] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const item = (await plane.listItems(context))[0]!;
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "replace", events: [{ type: "completed", title: "Retire old plan", summary: "The plan was replaced", relatedItemId: item.id, userDirected: true, sourceExcerpt: "replace it", archiveAfterCompletion: true }] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    expect(storage.getCachedItem(item.id)).toMatchObject({ status: "done", archived: true });
    expect(await plane.listItems(context)).toHaveLength(0);
    storage.close();
  });

  it.each([
    ["captured", "state-backlog"],
    ["planned", "state-todo"],
    ["in_progress", "state-progress"],
    ["done", "state-done"],
    ["dropped", "state-cancelled"],
  ] as const)("maps the %s lifecycle through the real Plane state groups", async (status, stateId) => {
    const { adapter, createPayloads } = sdkHarness([
      { id: "state-backlog", name: "Backlog", group: "backlog" },
      { id: "state-todo", name: "Todo", group: "unstarted" },
      { id: "state-progress", name: "In Progress", group: "started" },
      { id: "state-done", name: "Done", group: "completed" },
      { id: "state-cancelled", name: "Cancelled", group: "cancelled" },
    ]);

    const created = await adapter.createItem(sdkContext, { title: status, description: status, kind: "task", status, sourceEventId: `event-${status}` });

    expect(createPayloads[0]?.state).toBe(stateId);
    expect(created.status).toBe(status);
    expect((await adapter.listItems(sdkContext))[0]?.status).toBe(status);
  });

  it("creates one item and appends a later duplicate as activity", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug()] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const item = (await plane.listItems(context))[0]!;
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ ...bug(), summary: "Token 过期时更容易发生", relatedItemId: item.id }] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    expect((await plane.listItems(context))).toHaveLength(1);
    expect(plane.calls.filter((call) => call.startsWith("activity:"))).toHaveLength(1);
    storage.close();
  });

  it("does not collide when separate databases both allocate event_1_0", async () => {
    const plane = new FakePlaneAdapter();
    const first = new Storage(":memory:");
    const second = new Storage(":memory:");
    const firstContext = first.bindContext({ cwd: "/work/first", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const secondContext = second.bindContext({ cwd: "/work/second", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    first.enqueueBatch({ projectContextId: firstContext.id, sessionId: "session-one", turnId: "turn-one", events: [bug("第一条记录")] });
    second.enqueueBatch({ projectContextId: secondContext.id, sessionId: "session-two", turnId: "turn-two", events: [bug("第二条记录")] });

    await new EventCoordinator(first, plane).syncBatch(first.listPendingBatches()[0]!);
    await new EventCoordinator(second, plane).syncBatch(second.listPendingBatches()[0]!);

    expect(first.getSourceReference("event_1_0")?.remoteSourceId).toBe("project_1:session-one:turn-one:0");
    expect(second.getSourceReference("event_1_0")?.remoteSourceId).toBe("project_1:session-two:turn-two:0");
    expect(await plane.listItems(firstContext)).toHaveLength(2);
    first.close(); second.close();
  });

  it("advances a related system item to in_progress while recording one progress activity", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug()] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const item = (await plane.listItems(context))[0]!;
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ type: "progress", title: "修复白屏", summary: "开始修复", userDirected: false, relatedItemId: item.id, sourceExcerpt: "开始修复" }] });

    await coordinator.syncBatch(storage.listPendingBatches()[0]!);

    expect(plane.getActivities(item.id)).toHaveLength(1);
    expect((await plane.listItems(context)).find((candidate) => candidate.id === item.id)?.status).toBe("in_progress");
    expect(plane.calls.filter((call) => call === `update:${item.id}`)).toHaveLength(1);
    storage.close();
  });

  it("records progress activity without overwriting a user-owned status", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug()] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const item = (await plane.listItems(context))[0]!;
    await coordinator.editItem(context, item.id, { status: "done" });
    plane.calls.length = 0;
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ type: "progress", title: "修复白屏", summary: "继续修复", userDirected: false, relatedItemId: item.id, sourceExcerpt: "继续修复" }] });

    await coordinator.syncBatch(storage.listPendingBatches()[0]!);

    expect(plane.getActivities(item.id)).toHaveLength(1);
    expect((await plane.listItems(context)).find((candidate) => candidate.id === item.id)?.status).toBe("done");
    expect(plane.calls.filter((call) => call === `update:${item.id}`)).toHaveLength(0);
    storage.close();
  });

  it("does not create an item for an unrelated progress event", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [{ type: "progress", title: "无关联进展", summary: "记录进展", userDirected: false, sourceExcerpt: "记录进展" }] });

    await coordinator.syncBatch(storage.listPendingBatches()[0]!);

    expect(await plane.listItems(context)).toHaveLength(0);
    expect(storage.listPendingBatches()).toHaveLength(0);
    storage.close();
  });

  it("does not overwrite a user-owned description", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug()] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const item = (await plane.listItems(context))[0]!;
    await coordinator.editItem(context, item.id, { description: "用户接管的描述" });
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ ...bug(), summary: "系统后续补充", relatedItemId: item.id }] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const items = await plane.listItems(context);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(item.id);
    expect(items[0]?.description).toBe("用户接管的描述");
    storage.close();
  });

  it("leaves an outbox batch available when Plane is unavailable", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter(); plane.fail = true;
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug()] });
    await expect(coordinator.syncBatch(storage.listPendingBatches()[0]!)).rejects.toThrow("unavailable");
    expect(storage.listPendingBatches()).toHaveLength(1);
    storage.close();
  });

  it("skips completed events when a later event fails", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug("第一个事件"), { ...bug("第二个事件"), type: "task" }] });
    plane.injectFailure({ operation: "createItem", sourceEventId: remoteSourceId(context.id, "s", "t1", 1) });
    await expect(coordinator.syncBatch(storage.listPendingBatches()[0]!)).rejects.toThrow("injected createItem failure");
    expect(storage.getSourceReference("event_1_0")?.projectionStatus).toBe("completed");
    expect(storage.getSourceReference("event_1_1")?.projectionStatus).toBe("failed");
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    expect((await plane.listItems(context))).toHaveLength(2);
    expect(plane.calls.filter((call) => call.startsWith("create:"))).toHaveLength(2);
    expect(storage.listPendingBatches()).toHaveLength(0);
    storage.close();
  });

  it("reconciles a plan parent and missing steps by stable step source ids", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [{ type: "plan", title: "发布计划", summary: "按步骤发布", userDirected: true, sourceExcerpt: "发布计划", steps: [{ title: "准备", summary: "准备环境" }, { title: "发布", summary: "发布版本" }, { title: "验证", summary: "验证结果" }] }] });
    plane.injectFailure({ operation: "createItem", sourceEventId: `${remoteSourceId(context.id, "s", "t1", 0)}:step_1` });
    await expect(coordinator.syncBatch(storage.listPendingBatches()[0]!)).rejects.toThrow("injected createItem failure");
    expect((await plane.listItems(context))).toHaveLength(2);
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    expect((await plane.listItems(context))).toHaveLength(4);
    expect(plane.calls.filter((call) => call.startsWith("create:"))).toHaveLength(4);
    expect(plane.calls.filter((call) => call.startsWith("create-existing:")).length).toBeGreaterThanOrEqual(1);
    storage.close();
  });

  it("does not duplicate an activity written before the client saw a failure", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug()] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const item = (await plane.listItems(context))[0]!;
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ ...bug(), title: "登录页面偶尔会白屏", summary: "已经修复白屏", relatedItemId: item.id, sourceExcerpt: "已经修复" }] });
    plane.injectFailure({ operation: "addActivity", sourceEventId: remoteSourceId(context.id, "s", "t2", 0), afterWrite: true });
    await expect(coordinator.syncBatch(storage.listPendingBatches()[0]!)).rejects.toThrow("injected addActivity failure");
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    expect(plane.getActivities(item.id)).toHaveLength(1);
    expect(storage.listPendingBatches()).toHaveLength(0);
    storage.close();
  });

  it("replays a partially written progress without duplicating its activity", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug()] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const item = (await plane.listItems(context))[0]!;
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ type: "progress", title: "修复白屏", summary: "开始修复", userDirected: false, relatedItemId: item.id, sourceExcerpt: "开始修复" }] });
    plane.injectFailure({ operation: "addActivity", sourceEventId: remoteSourceId(context.id, "s", "t2", 0), afterWrite: true });

    await expect(coordinator.syncBatch(storage.listPendingBatches()[0]!)).rejects.toThrow("injected addActivity failure");
    expect(plane.getActivities(item.id)).toHaveLength(1);
    expect((await plane.listItems(context)).find((candidate) => candidate.id === item.id)?.status).toBe("captured");

    await coordinator.syncBatch(storage.listPendingBatches()[0]!);

    expect(plane.getActivities(item.id)).toHaveLength(1);
    expect((await plane.listItems(context)).find((candidate) => candidate.id === item.id)?.status).toBe("in_progress");
    expect(plane.calls.filter((call) => call === `update:${item.id}`)).toHaveLength(1);
    expect(storage.listPendingBatches()).toHaveLength(0);
    storage.close();
  });
});
