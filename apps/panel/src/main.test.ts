import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Dispatch, type SetStateAction } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { FakePlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { startMcpRuntime } from "@ambient/mcp/dist/index.js";
import { attachPanelSession, handlePanelToolResult, loadPanelSummary, panelRequestError, type PanelApi } from "./main";
import { createPanelApi, PANEL_BOOTSTRAP_META_KEY, parsePanelBootstrap } from "./session";

const sessionToken = "a".repeat(43);

describe("panel session attachment", () => {
  it("routes App.ontoolresult bootstrap metadata into the dynamic service session", () => {
    let attached: string | null = null;
    let error = "";
    let loading = true;
    handlePanelToolResult({ _meta: { [PANEL_BOOTSTRAP_META_KEY]: { serviceBaseUrl: "http://127.0.0.1:4317", sessionToken, projectContextId: "project_1" } } }, (next) => { attached = next.projectContextId; }, (message) => { error = message; }, (value) => { loading = value; });
    expect(attached).toBe("project_1");
    expect(error).toBe("");
    expect(loading).toBe(true);
  });

  it("identifies a browser fetch/CORS failure without suggesting a rebind", () => {
    const message = panelRequestError(new TypeError("Failed to fetch"));
    expect(message).toContain("CORS");
    expect(message).toContain("不是项目未绑定");
    expect(message).not.toContain("重新绑定");
  });

  it("stores the bootstrapped client as state and loads the project through the Service API", async () => {
    const contextId = "project_1";
    let requestUrl = "";
    let requestToken = "";
    const server = createServer((request, response) => {
      requestUrl = request.url ?? "";
      const token = request.headers["x-ambient-session-token"];
      requestToken = typeof token === "string" ? token : "";
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ context: { id: contextId } }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    let apiClient: PanelApi | null = null;
    const setApiClient: Dispatch<SetStateAction<PanelApi | null>> = (value) => {
      apiClient = (value as (current: PanelApi | null) => PanelApi)(apiClient);
    };
    const next = parsePanelBootstrap({
      [PANEL_BOOTSTRAP_META_KEY]: {
        serviceBaseUrl: `http://127.0.0.1:${address.port}`,
        sessionToken,
        projectContextId: contextId,
      },
    });
    expect(next).not.toBeNull();

    try {
      attachPanelSession(next!, vi.fn(), {
        setSession: vi.fn(),
        setApiClient,
        setSessionError: vi.fn(),
        setMessage: vi.fn(),
        setLoading: vi.fn(),
      });

      expect(apiClient).toEqual(expect.any(Function));
      const summary = await apiClient!(`/api/projects/${contextId}/summary`);
      expect(requestUrl).toBe(`/api/projects/${contextId}/summary`);
      expect(requestToken).toBe(sessionToken);
      expect((summary as { context: { id: string } }).context.id).toBe(contextId);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("reports an unbound working directory instead of making Load project a silent no-op", async () => {
    const apiClient = vi.fn(async () => null) as unknown as PanelApi;
    const session = { serviceBaseUrl: "http://127.0.0.1:4317", sessionToken, projectContextId: "project_1" };

    await expect(loadPanelSummary(apiClient, session, "standalone", "/work/unbound", null)).rejects.toThrow("No project is bound to /work/unbound");
    expect(apiClient).toHaveBeenCalledWith("/api/context?cwd=%2Fwork%2Funbound");
  });

  it("loads the bootstrap project directly in the Codex host", async () => {
    const summary = { context: { id: "project_1" }, items: [], sources: [], failures: [] };
    const apiClient = vi.fn(async () => summary) as unknown as PanelApi;
    const session = { serviceBaseUrl: "http://127.0.0.1:4317", sessionToken, projectContextId: "project_1" };

    await expect(loadPanelSummary(apiClient, session, "host", "", null)).resolves.toBe(summary);
    expect(apiClient).toHaveBeenCalledWith("/api/projects/project_1/summary");
  });

  it("completes open_project_panel through App.ontoolresult to a token-authenticated dynamic summary", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = await startMcpRuntime({ storage: new Storage(":memory:"), plane: new FakePlaneAdapter(), transport: serverTransport });
    const context = runtime.service.storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", planeProjectName: "Panel chain" });
    const client = new Client({ name: "ambient-panel-chain-client", version: "0.1.0" });
    await client.connect(clientTransport);
    try {
      const toolResult = await client.callTool({ name: "open_project_panel", arguments: { projectContextId: context.id } });
      let bootstrap: { serviceBaseUrl: string; sessionToken: string; projectContextId: string } | null = null;
      handlePanelToolResult(toolResult, (next) => { bootstrap = next; }, () => { throw new Error("Panel bootstrap was rejected"); }, () => undefined);
      expect(bootstrap).not.toBeNull();
      const activeBootstrap = bootstrap!;
      expect(activeBootstrap.serviceBaseUrl).toBe(runtime.service.baseUrl);
      const browserResponse = await fetch(`${activeBootstrap.serviceBaseUrl}/api/projects/${context.id}/summary`, { headers: { Origin: "https://web-sandbox.oaiusercontent.com", "X-Ambient-Session-Token": activeBootstrap.sessionToken } });
      expect(browserResponse.status).toBe(200);
      expect(browserResponse.headers.get("access-control-allow-origin")).toBe("https://web-sandbox.oaiusercontent.com");
      const api = createPanelApi(activeBootstrap, () => undefined);
      const summary = await loadPanelSummary(api, activeBootstrap, "host", "", null);
      expect(summary.context.id).toBe(context.id);
      expect(summary.context.planeProjectName).toBe("Panel chain");
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});
