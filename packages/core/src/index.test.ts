import { describe, expect, it } from "vitest";
import { buildAdditionalContext, canonicalizeCwd, eventBatchSchema, normalizeTitle } from "./index.js";

describe("core project contracts", () => {
  it("normalizes cwd without changing its identity", () => {
    expect(canonicalizeCwd(" C:\\work\\demo\\ ")).toBe("C:/work/demo");
    expect(canonicalizeCwd("/work/demo///")).toBe("/work/demo");
  });

  it("normalizes titles for conservative exact deduplication", () => {
    expect(normalizeTitle("  登录页面：偶尔会白屏。 ")).toBe("登录页面 偶尔会白屏");
  });

  it("rejects empty event batches at the MCP boundary", () => {
    expect(() => eventBatchSchema.parse({ projectContextId: "project_1", sessionId: "s", turnId: "t", events: [] })).toThrow();
  });

  it("keeps injected context compact and omits source content", () => {
    const context = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_1", turnId: "turn_1", context: { id: "project_1", canonicalCwd: "/work", cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", autoCaptureEnabled: true, createdAt: "now", updatedAt: "now" }, activeItems: [{ id: "p1", identifier: "DEMO-1", title: "Fix login", status: "captured" }] });
    expect(context).toContain("DEMO-1 | Fix login | captured");
    expect(context).toContain("acknowledge_no_project_events");
    expect(context).not.toContain("description");
    expect(context.length).toBeLessThan(9000);
  });
});
