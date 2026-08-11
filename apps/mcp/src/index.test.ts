import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { FakePlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { createMcpServer } from "./index.js";

describe("ambient MCP tool list", () => {
  it("advertises all five tools with current behavior annotations", async () => {
    const storage = new Storage(":memory:");
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter() });
    const client = new Client({ name: "ambient-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "list_projects",
        "get_binding",
        "bind_project",
        "change_binding",
        "record_project_events",
      ]);
      expect(Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]))).toEqual({
        list_projects: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        get_binding: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        bind_project: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        change_binding: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        record_project_events: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      });
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });
});
