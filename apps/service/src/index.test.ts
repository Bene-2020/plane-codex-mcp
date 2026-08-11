import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventCoordinator, FakePlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { OutboxWorker, createService } from "./index.js";

describe("local service and outbox worker", () => {
  it("accepts a queued event, projects it, and exposes the panel summary", async () => {
    const storage = new Storage(":memory:");
    const plane = new FakePlaneAdapter();
    const service = createService({ storage, plane });
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project", planeProjectName: "Demo" });
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [{ type: "task", title: "完成浏览器测试", summary: "还需要完成浏览器测试", userDirected: false, sourceExcerpt: "浏览器测试还没做" }] });
    await service.worker.processOnce();
    const response = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/summary` });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].title).toBe("完成浏览器测试");
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
    const response = await service.app.inject({ method: "POST", url: `/api/projects/${context.id}/retry/${queued.batchId}` });
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
    const response = await service.app.inject({ method: "POST", url: `/api/projects/${second.id}/retry/${queued.batchId}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("does not belong");
    expect(storage.listFailedBatches(first.id)[0]).toMatchObject({ batch_id: queued.batchId, status: "failed" });
    await service.app.close();
  });
});
