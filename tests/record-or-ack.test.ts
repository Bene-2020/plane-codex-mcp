import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { FakePlaneAdapter } from "../packages/plane/src/index.js";
import { Storage } from "../packages/storage/src/index.js";
import { handleHook } from "../apps/hook-adapter/src/index.js";
import { createMcpServer } from "../apps/mcp/src/index.js";

const requireMcp = createRequire(new URL("../apps/mcp/package.json", import.meta.url));
const { Client } = requireMcp("@modelcontextprotocol/sdk/client/index.js") as typeof import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = requireMcp("@modelcontextprotocol/sdk/inMemory.js") as typeof import("@modelcontextprotocol/sdk/inMemory.js");

describe("record-or-ack integration", () => {
  it("allows an unreviewed turn to stop without creating a hook prompt", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter() });
    const client = new Client({ name: "ambient-record-or-ack-test", version: "0.1.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const stopInput = { hook_event_name: "Stop", cwd: "/work", session_id: "s", turn_id: "t", stop_hook_active: false };
      expect(await handleHook(JSON.stringify(stopInput), storage)).toEqual({});
      expect(storage.db.prepare("SELECT record_tool_called, binding_list_tool_called, capture_decision_recorded, binding_prompt_delivered, ended_at FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("s", "t")).toMatchObject({ record_tool_called: 0, binding_list_tool_called: 0, capture_decision_recorded: 0, binding_prompt_delivered: null, ended_at: expect.any(String) });

      const acknowledgement = await client.callTool({
        name: "acknowledge_no_project_events",
        arguments: { projectContextId: context.id, sessionId: "s", turnId: "t" },
      });
      expect(acknowledgement.isError).not.toBe(true);
      expect(await handleHook(JSON.stringify(stopInput), storage)).toEqual({});
      expect(storage.db.prepare("SELECT capture_decision_recorded, binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("s", "t")).toEqual({ capture_decision_recorded: 1, binding_prompt_delivered: null });
      expect(storage.listPendingBatches()).toHaveLength(0);
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });

  it("keeps duplicate ack and record-or-ack ordering visible across MCP and Stop", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter() });
    const client = new Client({ name: "ambient-record-or-ack-order-test", version: "0.1.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const call = async (name: string, arguments_: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: arguments_ });
        expect(result.isError).not.toBe(true);
        const content = result.content[0];
        if (!content || content.type !== "text") throw new Error(`Tool ${name} did not return text`);
        return JSON.parse(content.text) as Record<string, unknown>;
      };
      const review = { projectContextId: context.id, sessionId: "s", turnId: "t" };
      expect(await call("acknowledge_no_project_events", review)).toEqual({ status: "acknowledged", duplicate: false });
      expect(await call("acknowledge_no_project_events", review)).toEqual({ status: "acknowledged", duplicate: true });
      expect(await call("record_project_events", {
        ...review,
        events: [{ type: "bug", title: "白屏", summary: "登录偶尔白屏", userDirected: true, sourceExcerpt: "记录这个 Bug" }],
      })).toMatchObject({ status: "accepted", batchId: "batch_1", duplicate: false });
      expect(storage.didAcknowledgeNoProjectEvents(context.id, "s", "t")).toBe(false);
      expect(await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/work", session_id: "s", turn_id: "t", stop_hook_active: false }), storage)).toEqual({});

      const recordedFirst = { projectContextId: context.id, sessionId: "s", turnId: "t2" };
      await call("record_project_events", {
        ...recordedFirst,
        events: [{ type: "progress", title: "已完成", summary: "修复已完成", userDirected: false, sourceExcerpt: "完成" }],
      });
      expect(await call("acknowledge_no_project_events", recordedFirst)).toEqual({ status: "already_recorded", duplicate: false });
      expect(storage.didAcknowledgeNoProjectEvents(context.id, "s", "t2")).toBe(false);
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });
});
