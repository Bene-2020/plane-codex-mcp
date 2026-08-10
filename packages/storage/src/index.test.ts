import { describe, expect, it } from "vitest";
import { Storage } from "./index.js";

const event = { type: "bug" as const, title: "白屏", summary: "登录偶尔白屏", userDirected: true, sourceExcerpt: "记录这个 Bug" };

describe("SQLite storage", () => {
  it("persists a cwd binding and rejects duplicate work-turn batches", () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work/demo/", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    expect(context.id).toBe("project_1");
    const first = storage.enqueueBatch({ projectContextId: context.id, sessionId: "session_1", turnId: "turn_1", events: [event] });
    const duplicate = storage.enqueueBatch({ projectContextId: context.id, sessionId: "session_1", turnId: "turn_1", events: [event] });
    expect(first).toEqual({ batchId: "batch_1", duplicate: false });
    expect(duplicate).toEqual({ batchId: "batch_1", duplicate: true });
    expect(storage.listPendingBatches()).toHaveLength(1);
    storage.close();
  });

  it("keeps only a field ownership marker, not a project-record replica", () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    storage.cacheItem(context.id, { id: "item-1", identifier: "P-1", title: "System title", kind: "task", status: "captured" }, true);
    storage.setFieldOwnership("item-1", "title", "system", "System title");
    storage.setUserFields("item-1", { title: "User title" });
    expect(storage.getFieldOwnership("item-1", "title")?.owner).toBe("user");
    expect(storage.listAllCachedItems(context.id)).toHaveLength(1);
    storage.close();
  });
});
