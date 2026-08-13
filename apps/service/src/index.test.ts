import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventCoordinator, FakePlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { OutboxWorker, countProjectItems, createService } from "./index.js";

const sessionHeaders = (service: ReturnType<typeof createService>) => ({ "X-Ambient-Session-Token": service.sessionToken });

describe("local service and outbox worker", () => {
  it("counts every non-archived item mapped to the four Inline states", () => {
    expect(countProjectItems([
      { id: "1", identifier: "1", title: "Backlog", projectId: "p", status: "captured", updatedAt: "now" },
      { id: "2", identifier: "2", title: "Todo", projectId: "p", status: "planned", updatedAt: "now" },
      { id: "3", identifier: "3", title: "Done", projectId: "p", status: "done", updatedAt: "now" },
      { id: "4", identifier: "4", title: "Archived", projectId: "p", status: "done", archived: true, updatedAt: "now" },
      { id: "5", identifier: "5", title: "Cancelled", projectId: "p", status: "dropped", updatedAt: "now" },
    ])).toEqual({ total: 3, byStatus: { captured: 1, planned: 1, in_progress: 0, done: 1 } });
  });

  it("keeps health anonymous and minimal", async () => {
    const service = createService({ storage: new Storage(":memory:"), plane: new FakePlaneAdapter() });
    const response = await service.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(response.body).not.toContain(service.sessionToken);
    await service.app.close();
  });

  it("protects every API route with the temporary session token", async () => {
    const storage = new Storage(":memory:");
    const service = createService({ storage, plane: new FakePlaneAdapter(), sessionToken: "a".repeat(43) });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });

    const missing = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/items` });
    const wrong = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/items`, headers: { "X-Ambient-Session-Token": "b".repeat(43) } });
    const unicode = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/items`, headers: { "X-Ambient-Session-Token": "界".repeat(43) } });
    const correct = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/items`, headers: sessionHeaders(service) });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unicode.statusCode).toBe(401);
    expect(correct.statusCode).toBe(200);
    expect(missing.json()).toEqual({ error: "Unauthorized" });
    expect(missing.body).not.toContain(service.sessionToken);
    expect(JSON.stringify(missing.headers)).not.toContain(service.sessionToken);
    await service.app.close();
  });

  it("allows the Codex App and development origins, but rejects an unlisted origin", async () => {
    const storage = new Storage(":memory:");
    const service = createService({ storage, plane: new FakePlaneAdapter(), sessionToken: "a".repeat(43) });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const codexDesktopOrigin = "codex-sandbox://mcp-server-ambient-project-abc123.web-sandbox.oaiusercontent.com";
    const webSandboxSummary = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/summary`, headers: { origin: "https://web-sandbox.oaiusercontent.com", "X-Ambient-Session-Token": service.sessionToken } });
    const codexDesktopSummary = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/summary`, headers: { origin: codexDesktopOrigin, "X-Ambient-Session-Token": service.sessionToken } });
    const nullOrigin = await service.app.inject({ method: "GET", url: "/health", headers: { origin: "null" } });
    const loopback = await service.app.inject({ method: "GET", url: "/health", headers: { origin: "http://127.0.0.1:4318" } });
    const rejected = await service.app.inject({ method: "GET", url: "/health", headers: { origin: "https://not-the-panel.example" } });
    const preflight = await service.app.inject({ method: "OPTIONS", url: `/api/projects/${context.id}/summary`, headers: { origin: "https://web-sandbox.oaiusercontent.com", "access-control-request-method": "GET", "access-control-request-headers": "content-type,x-ambient-session-token" } });
    const codexDesktopPreflight = await service.app.inject({ method: "OPTIONS", url: `/api/projects/${context.id}/summary`, headers: { origin: codexDesktopOrigin, "access-control-request-method": "GET", "access-control-request-headers": "content-type,x-ambient-session-token" } });
    expect(webSandboxSummary.statusCode).toBe(200);
    expect(webSandboxSummary.headers["access-control-allow-origin"]).toBe("https://web-sandbox.oaiusercontent.com");
    expect(webSandboxSummary.json().context.id).toBe(context.id);
    expect(codexDesktopSummary.statusCode).toBe(200);
    expect(codexDesktopSummary.headers["access-control-allow-origin"]).toBe(codexDesktopOrigin);
    expect(nullOrigin.headers["access-control-allow-origin"]).toBe("null");
    expect(loopback.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4318");
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://web-sandbox.oaiusercontent.com");
    expect(preflight.headers["access-control-allow-headers"]).toBe("Content-Type, X-Ambient-Session-Token");
    expect(codexDesktopPreflight.statusCode).toBe(204);
    expect(codexDesktopPreflight.headers["access-control-allow-origin"]).toBe(codexDesktopOrigin);
    await service.app.close();
  });

  it("rejects an unauthorized write before it can change project state", async () => {
    const storage = new Storage(":memory:");
    const service = createService({ storage, plane: new FakePlaneAdapter() });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });

    const response = await service.app.inject({ method: "PATCH", url: `/api/projects/${context.id}/auto-capture`, payload: { enabled: false } });

    expect(response.statusCode).toBe(401);
    expect(storage.getContext(context.id)?.autoCaptureEnabled).toBe(true);
    await service.app.close();
  });

  it("rotates the token when a new service starts", async () => {
    const storageA = new Storage(":memory:");
    const serviceA = createService({ storage: storageA, plane: new FakePlaneAdapter() });
    const context = storageA.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const storageB = new Storage(":memory:");
    const serviceB = createService({ storage: storageB, plane: new FakePlaneAdapter() });
    storageB.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });

    expect(serviceA.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(serviceB.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(serviceA.sessionToken).not.toBe(serviceB.sessionToken);
    const oldToken = await serviceB.app.inject({ method: "GET", url: `/api/projects/${context.id}/items`, headers: { "X-Ambient-Session-Token": serviceA.sessionToken } });
    const newToken = await serviceB.app.inject({ method: "GET", url: `/api/projects/project_1/items`, headers: sessionHeaders(serviceB) });
    expect(oldToken.statusCode).toBe(401);
    expect(newToken.statusCode).toBe(200);
    await serviceA.app.close();
    await serviceB.app.close();
  });

  it("accepts a queued event, projects it, and exposes the panel summary", async () => {
    const storage = new Storage(":memory:");
    const plane = new FakePlaneAdapter();
    const service = createService({ storage, plane });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project", planeProjectName: "Demo" });
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [{ type: "task", title: "完成浏览器测试", summary: "还需要完成浏览器测试", userDirected: false, sourceExcerpt: "浏览器测试还没做" }] });
    await service.worker.processOnce();
    const response = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/summary`, headers: sessionHeaders(service) });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].title).toBe("完成浏览器测试");
    expect(response.json().projectCounts).toEqual({ total: 1, byStatus: { captured: 1, planned: 0, in_progress: 0, done: 0 } });
    await service.app.close();
  });

  it("persists an Inline status change through the narrow Service and Plane path", async () => {
    const storage = new Storage(":memory:");
    const plane = new FakePlaneAdapter();
    const service = createService({ storage, plane });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const item = await plane.createItem(context, { title: "状态操作", description: "状态操作", kind: "task", status: "captured", sourceEventId: "status-source" });
    storage.cacheItem(context.id, item, true);

    const response = await service.app.inject({ method: "PATCH", url: `/api/items/${item.id}/status`, headers: sessionHeaders(service), payload: { status: "in_progress" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: item.id, status: "in_progress" });
    expect(storage.getCachedItem(item.id)?.status).toBe("in_progress");
    expect(storage.getFieldOwnership(item.id, "status")?.owner).toBe("user");
    expect(plane.calls).toContain(`update:${item.id}`);
    await service.app.close();
  });

  it("returns the Plane error and leaves the cached status unchanged when a status write fails", async () => {
    const storage = new Storage(":memory:");
    const plane = new FakePlaneAdapter();
    const service = createService({ storage, plane });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const item = await plane.createItem(context, { title: "失败状态操作", description: "失败状态操作", kind: "task", status: "captured", sourceEventId: "status-failure-source" });
    storage.cacheItem(context.id, item, true);
    plane.injectFailure({ operation: "updateItem", call: 1 });

    const response = await service.app.inject({ method: "PATCH", url: `/api/items/${item.id}/status`, headers: sessionHeaders(service), payload: { status: "done" } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Fake Plane injected updateItem failure");
    expect(storage.getCachedItem(item.id)?.status).toBe("captured");
    expect(storage.getFieldOwnership(item.id, "status")?.owner).toBeUndefined();
    await service.app.close();
  });

  it("claims a batch once across two workers sharing one SQLite file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-workers-"));
    const filename = join(directory, "outbox.sqlite");
    const storageA = new Storage(filename);
    const context = storageA.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    storageA.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [{ type: "task", title: "只创建一次", summary: "只创建一次", userDirected: false, sourceExcerpt: "只创建一次" }] });
    const plane = new FakePlaneAdapter();
    const storageB = new Storage(filename);
    const workerA = new OutboxWorker(storageA, new EventCoordinator(storageA, plane));
    const workerB = new OutboxWorker(storageB, new EventCoordinator(storageB, plane));
    await Promise.all([workerA.processOnce(), workerB.processOnce()]);
    expect((await plane.listItems(context))).toHaveLength(1);
    expect(storageA.listPendingBatches()).toHaveLength(0);
    storageA.close(); storageB.close(); rmSync(directory, { recursive: true, force: true });
  });

  it("shares the in-flight run when one worker is re-entered", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [{ type: "task", title: "只处理一次", summary: "只处理一次", userDirected: false, sourceExcerpt: "只处理一次" }] });
    const plane = new FakePlaneAdapter();
    const worker = new OutboxWorker(storage, new EventCoordinator(storage, plane));
    const [first, second] = await Promise.all([worker.processOnce(), worker.processOnce()]);
    expect(first).toBe(1);
    expect(second).toBe(1);
    expect((await plane.listItems(context))).toHaveLength(1);
    storage.close();
  });

  it("claims and processes only one batch per run", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [{ type: "task", title: "第一批次", summary: "第一批次", userDirected: false, sourceExcerpt: "第一批次" }] });
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ type: "task", title: "第二批次", summary: "第二批次", userDirected: false, sourceExcerpt: "第二批次" }] });
    const plane = new FakePlaneAdapter();
    const worker = new OutboxWorker(storage, new EventCoordinator(storage, plane));
    expect(await worker.processOnce()).toBe(1);
    expect(storage.listPendingBatches()).toHaveLength(1);
    expect(await worker.processOnce()).toBe(1);
    expect(storage.listPendingBatches()).toHaveLength(0);
    storage.close();
  });

  it("renews a short lease while a remote operation is awaiting and prevents a second claim", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-heartbeat-"));
    const filename = join(directory, "outbox.sqlite");
    const storageA = new Storage(filename, { leaseMs: 20 });
    const context = storageA.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    storageA.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [{ type: "task", title: "续租中的远端写入", summary: "续租中的远端写入", userDirected: false, sourceExcerpt: "续租中的远端写入" }] });
    const storageB = new Storage(filename, { leaseMs: 20 });
    const plane = new FakePlaneAdapter();
    plane.delayMs = 70;
    plane.delayOperation = "createItem";
    const workerA = new OutboxWorker(storageA, new EventCoordinator(storageA, plane));
    const workerB = new OutboxWorker(storageB, new EventCoordinator(storageB, plane));
    const firstRun = workerA.processOnce();
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(await workerB.processOnce()).toBe(0);
    expect(await firstRun).toBe(1);
    expect(plane.calls.filter((call) => call.startsWith("create:")).length).toBe(1);
    expect((await plane.listItems(context))).toHaveLength(1);
    storageA.close(); storageB.close(); rmSync(directory, { recursive: true, force: true });
  });

  it("fails the batch and stops before the next event when heartbeat loses the claim", async () => {
    const storage = new Storage(":memory:", { leaseMs: 50 });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [
      { type: "task", title: "首个远端写入", summary: "首个远端写入", userDirected: false, sourceExcerpt: "首个远端写入" },
      { type: "task", title: "不应继续写入", summary: "不应继续写入", userDirected: false, sourceExcerpt: "不应继续写入" },
    ] });
    const plane = new FakePlaneAdapter();
    plane.delayMs = 30;
    plane.delayOperation = "createItem";
    const renew = vi.spyOn(storage, "renewBatchLease").mockReturnValue(false);
    const worker = new OutboxWorker(storage, new EventCoordinator(storage, plane));
    expect(await worker.processOnce()).toBe(1);
    expect(plane.calls.filter((call) => call.startsWith("create:")).length).toBe(1);
    expect(storage.getSourceReference("event_1_0")?.projectionStatus).toBe("failed");
    expect(storage.getSourceReference("event_1_1")?.projectionStatus).toBe("pending");
    expect(storage.listFailedBatches(context.id)[0]).toMatchObject({ status: "failed", last_error: "Outbox batch claim lost" });
    renew.mockRestore();
    storage.close();
  });

  it("does not clear or steal an active claim during manual retry", async () => {
    const storage = new Storage(":memory:", { leaseMs: 100 });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const queued = storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [{ type: "task", title: "活动租约", summary: "活动租约", userDirected: false, sourceExcerpt: "活动租约" }] });
    const service = createService({ storage, plane: new FakePlaneAdapter() });
    const claim = storage.claimPendingBatches()[0]!;
    const response = await service.app.inject({ method: "POST", url: `/api/projects/${context.id}/retry/${queued.batchId}`, headers: sessionHeaders(service) });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("currently claimed");
    expect((storage.db.prepare("SELECT status, claim_token FROM outbox_batches WHERE id=1").get() as { status: string; claim_token: string }).claim_token).toBe(claim.claimToken);
    expect(storage.listPendingBatches()).toHaveLength(0);
    await service.app.close();
  });

  it("rejects retrying a batch through another project context", async () => {
    const storage = new Storage(":memory:");
    const first = storage.bindContext({ cwd: "/work/one", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const second = storage.bindContext({ cwd: "/work/two", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "other-project" });
    const plane = new FakePlaneAdapter();
    const service = createService({ storage, plane });
    const queued = storage.enqueueBatch({ projectContextId: first.id, sessionId: "s", turnId: "t", events: [{ type: "task", title: "失败批次", summary: "失败批次", userDirected: false, sourceExcerpt: "失败批次" }] });
    plane.fail = true;
    await service.worker.processOnce();
    const response = await service.app.inject({ method: "POST", url: `/api/projects/${second.id}/retry/${queued.batchId}`, headers: sessionHeaders(service) });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("does not belong");
    expect(storage.listFailedBatches(first.id)[0]).toMatchObject({ batch_id: queued.batchId, status: "failed" });
    await service.app.close();
  });
});
