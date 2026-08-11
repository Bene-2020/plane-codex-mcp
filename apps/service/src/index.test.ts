import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
