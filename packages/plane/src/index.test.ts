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
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [{ ...bug(), summary: "Token 过期时更容易发生" }] });
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
});
