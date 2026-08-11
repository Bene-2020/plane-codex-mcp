import { describe, expect, it } from "vitest";
import { handleHook } from "./index.js";
import { Storage } from "@ambient/storage";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

describe("hook adapter", () => {
  it("uses hookSpecificOutput.additionalContext for session context", async () => {
    const storage = new Storage(":memory:");
    storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", planeProjectName: "Demo" });
    for (const eventName of ["SessionStart", "UserPromptSubmit"]) {
      const result = await handleHook(JSON.stringify({ hook_event_name: eventName, cwd: "/work", session_id: "s", turn_id: "t", source: "startup", prompt: "continue" }), storage);
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: expect.any(String),
        },
      });
    }
    storage.close();
  });

  it("audits the canonical MCP tool name from PostToolUse", async () => {
    const storage = new Storage(":memory:");
    await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", session_id: "s", turn_id: "t", tool_name: "mcp__ambient-project__record_project_events", tool_response: { status: "accepted" } }), storage);
    expect(storage.listAudits("s")[0]).toMatchObject({ record_tool_called: 1, hook_event_name: "PostToolUse" });
    storage.close();
  });

  it("does not emit legacy top-level context fields", async () => {
    const storage = new Storage(":memory:");
    const result = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/work", session_id: "s", turn_id: "t" }), storage);
    expect(result).not.toHaveProperty("additionalContext");
    expect(result).not.toHaveProperty("statusMessage");
    expect(result).not.toHaveProperty("systemMessage");
    storage.close();
  });

  it("returns an empty fail-open response for malformed JSON", async () => {
    expect(await handleHook("not json")).toEqual({});
  });

  it("keeps plugin hooks silent", async () => {
    const hooksPath = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));
    const hooks = JSON.parse(await readFile(hooksPath, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> };
    const handlers = Object.values(hooks.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
    expect(handlers).toHaveLength(5);
    expect(handlers.every((handler) => !Object.hasOwn(handler, "statusMessage"))).toBe(true);
  });
});
