import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it } from "vitest";
import { parentChildClosureRule, projectBindingFinalDeliveryRule, projectBindingPromptInstruction, supersededPlanRule } from "@ambient/core";
import { FakePlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { createMcpServer, PANEL_BOOTSTRAP_META_KEY, PANEL_PROXY_TOOL_NAME, PANEL_RESOURCE_URI, startMcpRuntime } from "./index.js";

describe("ambient MCP tools and App bootstrap", () => {
  it("advertises the project tools and App bootstrap with current behavior annotations", async () => {
    const storage = new Storage(":memory:");
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter() });
    const client = new Client({ name: "ambient-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect(client.getInstructions()).toContain(projectBindingFinalDeliveryRule);
      expect(client.getInstructions()).toContain(projectBindingPromptInstruction);
      expect(client.getInstructions()).toContain("When get_binding returns null for the cwd, do not call open_project_panel");
      expect(client.getInstructions()).toContain(supersededPlanRule);
      expect(client.getInstructions()).toContain(parentChildClosureRule);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "list_projects",
        "get_binding",
        "open_project_panel",
        "bind_project",
        "change_binding",
        "decline_project_binding",
        "restore_project_binding",
        "record_project_events",
        "acknowledge_no_project_events",
      ]);
      expect(Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]))).toEqual({
        list_projects: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        get_binding: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        open_project_panel: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        bind_project: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        change_binding: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        decline_project_binding: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        restore_project_binding: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        record_project_events: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        acknowledge_no_project_events: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      });
      expect(tools.find((tool) => tool.name === "open_project_panel")?._meta).toEqual({ ui: { resourceUri: PANEL_RESOURCE_URI, visibility: ["model"] }, "ui/resourceUri": PANEL_RESOURCE_URI });
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });

  it("keeps the service bootstrap in component metadata instead of model-visible content", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter(), panelSession: { serviceBaseUrl: "http://127.0.0.1:4317", sessionToken: "a".repeat(43) } });
    const client = new Client({ name: "ambient-bootstrap-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: "open_project_panel", arguments: { projectContextId: context.id } });
      expect(result.content).toEqual([{ type: "text", text: "Project panel initialized." }]);
      expect(result._meta).toEqual({
        [PANEL_BOOTSTRAP_META_KEY]: {
          serviceBaseUrl: "http://127.0.0.1:4317",
          sessionToken: "a".repeat(43),
          projectContextId: context.id,
        },
      });
      expect(JSON.stringify(result.content)).not.toContain("a".repeat(43));
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });

  it("keeps the App resource association on an unbound tool error without bootstrap metadata", async () => {
    const storage = new Storage(":memory:");
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter(), panelSession: { serviceBaseUrl: "http://127.0.0.1:4317", sessionToken: "a".repeat(43) } });
    const client = new Client({ name: "ambient-unbound-panel-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const binding = await client.callTool({ name: "get_binding", arguments: { cwd: "/work/test-project" } });
      const result = await client.callTool({ name: "open_project_panel", arguments: { cwd: "/work/test-project" } });
      const { tools } = await client.listTools();
      expect(JSON.parse((binding.content as Array<{ text: string }>)[0]!.text)).toBeNull();
      expect(tools.find((tool) => tool.name === "open_project_panel")?._meta).toEqual({ ui: { resourceUri: PANEL_RESOURCE_URI, visibility: ["model"] }, "ui/resourceUri": PANEL_RESOURCE_URI });
      expect(result.isError).toBe(true);
      expect(result._meta).toBeUndefined();
      expect(JSON.stringify(result)).toContain("Project context not found");
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });

  it("exposes binding conflicts at the MCP boundary and reserves replacement for change_binding", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "first" });
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter() });
    const client = new Client({ name: "ambient-binding-conflict-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const sameTarget = await client.callTool({ name: "bind_project", arguments: { cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "first", planeProjectName: "Must not replace", autoCaptureEnabled: false } });
      expect(sameTarget.isError).not.toBe(true);
      const reusedContext = JSON.parse((sameTarget.content as unknown as Array<{ text: string }>)[0]?.text ?? "null") as { id: string; planeProjectId: string; autoCaptureEnabled: boolean; updatedAt: string };
      expect(reusedContext).toMatchObject({ id: context.id, planeProjectId: "first", autoCaptureEnabled: true, updatedAt: context.updatedAt });
      const binding = { cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "second" };
      const bind = await client.callTool({ name: "bind_project", arguments: binding });
      expect(bind.isError).toBe(true);
      expect(JSON.stringify(bind)).toContain("Conflicting Plane project binding");
      const changed = await client.callTool({ name: "change_binding", arguments: binding });
      expect(changed.isError).not.toBe(true);
      const changedContext = JSON.parse((changed.content as unknown as Array<{ text: string }>)[0]?.text ?? "null") as { id: string; planeProjectId: string };
      expect(changedContext).toMatchObject({ id: context.id, planeProjectId: "second" });
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });

  it("persists and restores an explicit binding refusal without creating a project context", async () => {
    const storage = new Storage(":memory:");
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter() });
    const client = new Client({ name: "ambient-binding-preference-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const declined = await client.callTool({ name: "decline_project_binding", arguments: { cwd: "/unbound/work" } });
      expect(declined.isError).not.toBe(true);
      expect(JSON.parse(((declined.content as Array<{ type: "text"; text: string }>)[0]!).text)).toMatchObject({ preference: "declined" });
      expect(storage.getContextByCwd("/unbound/work")).toBeNull();
      const restored = await client.callTool({ name: "restore_project_binding", arguments: { cwd: "/unbound/work" } });
      expect(restored.isError).not.toBe(true);
      expect(JSON.parse(((restored.content as Array<{ type: "text"; text: string }>)[0]!).text)).toMatchObject({ restored: true });
      const declinedAgain = await client.callTool({ name: "decline_project_binding", arguments: { cwd: "/unbound/work" } });
      expect(declinedAgain.isError).not.toBe(true);
      const bound = await client.callTool({ name: "bind_project", arguments: { cwd: "/unbound/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "chosen" } });
      expect(bound.isError).not.toBe(true);
      expect(storage.getBindingPreference("/unbound/work")).toBeNull();
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });

  it("delivers open_project_panel metadata through the real MCP App host bridge", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    const sessionToken = "a".repeat(43);
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter(), panelSession: { serviceBaseUrl: "http://127.0.0.1:4317", sessionToken } });
    const client = new Client({ name: "panel-host-protocol-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
    const app = new McpApp({ name: "Ambient Project Panel", version: "0.1.0" }, {}, { autoResize: false });
    const bridge = new AppBridge(client, { name: "Codex Desktop protocol test", version: "0.1.0" }, { serverTools: {} });
    let receivedBootstrap: unknown = null;
    app.ontoolresult = (result) => { receivedBootstrap = result._meta?.[PANEL_BOOTSTRAP_META_KEY]; };

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await bridge.connect(bridgeTransport);
    try {
      await app.connect(appTransport);
      const result = await client.callTool({ name: "open_project_panel", arguments: { projectContextId: context.id } });
      await bridge.sendToolInput({ arguments: { projectContextId: context.id } });
      await bridge.sendToolResult(result);

      expect(receivedBootstrap).toEqual({
        serviceBaseUrl: "http://127.0.0.1:4317",
        sessionToken,
        projectContextId: context.id,
      });
      expect(JSON.stringify(result.content)).not.toContain(sessionToken);
    } finally {
      await appTransport.close();
      await bridgeTransport.close();
      await client.close();
      await server.close();
      storage.close();
    }
  });

  it("keeps panel API requests on the MCP host bridge instead of the sandbox network", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = await startMcpRuntime({ storage: new Storage(":memory:"), plane: new FakePlaneAdapter(), transport: serverTransport });
    const context = runtime.service.storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    const client = new Client({ name: "ambient-panel-proxy-test", version: "0.1.0" });
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.find((tool) => tool.name === PANEL_PROXY_TOOL_NAME)?._meta).toEqual({ ui: { visibility: ["app"] } });
      const result = await client.callTool({ name: PANEL_PROXY_TOOL_NAME, arguments: { method: "GET", path: `/api/projects/${context.id}/summary` } });
      expect(result.isError).not.toBe(true);
      const responseText = (result.content as unknown as Array<{ text: string }>)[0]?.text;
      expect(responseText).toBeDefined();
      expect(JSON.parse(responseText as string).context.id).toBe(context.id);

      const item = await (runtime.service.plane as FakePlaneAdapter).createItem(context, { title: "Bridge status", description: "Bridge status", kind: "task", status: "captured", sourceEventId: "bridge-status-source" });
      runtime.service.storage.cacheItem(context.id, item, true);
      const statusResult = await client.callTool({ name: PANEL_PROXY_TOOL_NAME, arguments: { method: "PATCH", path: `/api/items/${item.id}/status`, body: { status: "done" } } });
      expect(statusResult.isError).not.toBe(true);
      expect(JSON.parse((statusResult.content as unknown as Array<{ text: string }>)[0]?.text ?? "{}").status).toBe("done");
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("fails safely when no panel bootstrap session is injected", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    const { server } = createMcpServer({ storage, plane: new FakePlaneAdapter() });
    const client = new Client({ name: "ambient-missing-session-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: "open_project_panel", arguments: { projectContextId: context.id } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("Project panel session is unavailable");
      expect(result._meta).toBeUndefined();
    } finally {
      await client.close();
      await server.close();
      storage.close();
    }
  });

  it("starts an isolated formal runtime without env bootstrap and rotates its BFF session", async () => {
    const previousToken = process.env.AMBIENT_SESSION_TOKEN;
    const previousBaseUrl = process.env.AMBIENT_SERVICE_BASE_URL;
    delete process.env.AMBIENT_SESSION_TOKEN;
    delete process.env.AMBIENT_SERVICE_BASE_URL;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = await startMcpRuntime({ storage: new Storage(":memory:"), plane: new FakePlaneAdapter(), transport: serverTransport });
    const client = new Client({ name: "ambient-runtime-client", version: "0.1.0" });
    const context = runtime.service.storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    try {
      await client.connect(clientTransport);
      const result = await client.callTool({ name: "open_project_panel", arguments: { projectContextId: context.id } });
      const bootstrap = (result._meta as Record<string, { serviceBaseUrl: string; sessionToken: string; projectContextId: string }>)[PANEL_BOOTSTRAP_META_KEY]!;
      expect(runtime.service.port).toBeGreaterThan(0);
      expect(bootstrap).toEqual({ serviceBaseUrl: runtime.service.baseUrl, sessionToken: runtime.sessionToken, projectContextId: context.id });
      expect(result.content).toEqual([{ type: "text", text: "Project panel initialized." }]);
      expect(JSON.stringify(result.content)).not.toContain(runtime.sessionToken);

      const authorized = await fetch(`${bootstrap.serviceBaseUrl}/api/projects/${context.id}/items`, { headers: { "X-Ambient-Session-Token": bootstrap.sessionToken } });
      expect(authorized.status).toBe(200);
    } finally {
      await client.close();
      await runtime.close();
      await runtime.close();
      if (previousToken === undefined) delete process.env.AMBIENT_SESSION_TOKEN;
      else process.env.AMBIENT_SESSION_TOKEN = previousToken;
      if (previousBaseUrl === undefined) delete process.env.AMBIENT_SERVICE_BASE_URL;
      else process.env.AMBIENT_SERVICE_BASE_URL = previousBaseUrl;
    }

    const restarted = await startMcpRuntime({ storage: new Storage(":memory:"), plane: new FakePlaneAdapter() });
    try {
      expect(restarted.sessionToken).not.toBe(runtime.sessionToken);
      const oldSession = await fetch(`${restarted.service.baseUrl}/api/context`, { headers: { "X-Ambient-Session-Token": runtime.sessionToken } });
      expect(oldSession.status).toBe(401);
    } finally {
      await restarted.close();
    }
  });

});
