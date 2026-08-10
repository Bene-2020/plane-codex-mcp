import { describe, expect, it } from "vitest";
import { FakePlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { createService } from "./index.js";

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
});
