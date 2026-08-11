import { describe, expect, it } from "vitest";
import { EventCoordinator, FakePlaneAdapter } from "./index.js";
import { Storage } from "@ambient/storage";

const bug = (title = "登录页面偶尔会白屏") => ({ type: "bug" as const, title, summary: title, userDirected: true, sourceExcerpt: title });

describe("Plane projection", () => {
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

  it("does not overwrite a user-owned description", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "demo-workspace", planeProjectId: "demo-project" });
    const plane = new FakePlaneAdapter();
    const coordinator = new EventCoordinator(storage, plane);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t1", events: [bug()] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    const item = (await plane.listItems(context))[0]!;
    await coordinator.editItem(context, item.id, { description: "用户接管的描述" });
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ ...bug(), summary: "系统后续补充" }] });
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    expect((await plane.listItems(context))[0]!.description).toBe("用户接管的描述");
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
    plane.injectFailure({ operation: "createItem", sourceEventId: "event_1_1" });
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
    plane.injectFailure({ operation: "createItem", sourceEventId: "event_1_0:step_1" });
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
    plane.injectFailure({ operation: "addActivity", sourceEventId: "event_2_0", afterWrite: true });
    await expect(coordinator.syncBatch(storage.listPendingBatches()[0]!)).rejects.toThrow("injected addActivity failure");
    await coordinator.syncBatch(storage.listPendingBatches()[0]!);
    expect(plane.getActivities(item.id)).toHaveLength(1);
    expect(storage.listPendingBatches()).toHaveLength(0);
    storage.close();
  });
});
