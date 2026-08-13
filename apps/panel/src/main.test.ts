import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { type Dispatch, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { describe, expect, it, vi } from "vitest";
import { FakePlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { startMcpRuntime } from "@ambient/mcp/dist/index.js";
import { attachPanelSession, filterVisibleItems, getStatusCounts, handlePanelToolResult, listSummary, LoadingShell, loadPanelSummary, moveProjectCount, panelRequestError, projectPlaneUrl, selectRelevantItems, STATUS_OPTIONS, updateItemStatus, type PanelApi } from "./main";
import { createPanelApi, createPanelToolApi, PANEL_BOOTSTRAP_META_KEY, parsePanelBootstrap } from "./session";

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

  it("loads the project through the MCP App server-tool bridge in the host sandbox", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
    const runtime = await startMcpRuntime({ storage: new Storage(":memory:"), plane: new FakePlaneAdapter(), transport: serverTransport });
    const context = runtime.service.storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", planeProjectName: "Bridge panel" });
    const client = new Client({ name: "ambient-panel-host-bridge-test", version: "0.1.0" });
    const app = new McpApp({ name: "Ambient Project Panel", version: "0.1.0" }, {}, { autoResize: false });
    const bridge = new AppBridge(client, { name: "Codex Desktop protocol test", version: "0.1.0" }, { serverTools: {} });
    await client.connect(clientTransport);
    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);
    try {
      const toolResult = await client.callTool({ name: "open_project_panel", arguments: { projectContextId: context.id } });
      let bootstrap: { serviceBaseUrl: string; sessionToken: string; projectContextId: string } | null = null;
      handlePanelToolResult(toolResult, (next) => { bootstrap = next; }, () => { throw new Error("Panel bootstrap was rejected"); }, () => undefined);
      const activeBootstrap = bootstrap!;
      const api = createPanelToolApi((params) => app.callServerTool(params), () => undefined);
      const summary = await loadPanelSummary(api, activeBootstrap, "host", "", null);
      expect(summary.context.id).toBe(context.id);
      expect(summary.context.planeProjectName).toBe("Bridge panel");
    } finally {
      await app.close();
      await appTransport.close();
      await bridgeTransport.close();
      await client.close();
      await runtime.close();
    }
  });
});

describe("inline project card behavior", () => {
  const items = [
    { id: "1", identifier: "DEMO-1", title: "Captured item", status: "captured" },
    { id: "2", identifier: "DEMO-2", title: "Planned item", status: "planned" },
    { id: "3", identifier: "DEMO-3", title: "In progress item", status: "in_progress" },
    { id: "4", identifier: "DEMO-4", title: "Done item", status: "done" },
    { id: "5", identifier: "DEMO-5", title: "Second done item", status: "done" },
    { id: "6", identifier: "DEMO-6", title: "Beyond inline limit", status: "captured" },
    { id: "7", identifier: "DEMO-7", title: "Archived item", status: "planned", archived: true },
  ];

  it("limits the Inline payload and keeps status counts stable while filtering", () => {
    const relevant = selectRelevantItems(items);
    expect(relevant).toHaveLength(5);
    expect(filterVisibleItems(relevant, "done")).toHaveLength(1);
    expect(getStatusCounts(relevant)).toEqual({ captured: 2, planned: 1, in_progress: 1, done: 1 });
    expect(STATUS_OPTIONS.map((option) => option.label)).toEqual(["Backlog", "Todo", "In Progress", "Done"]);
  });

  it("shows approved A-version project totals independently from the five rendered items", () => {
    const counts = { total: 42, byStatus: { captured: 6, planned: 8, in_progress: 10, done: 18 } };
    expect(listSummary("all", 5, counts)).toEqual({ title: "相关工作项", detail: "显示 5 / 项目共 42" });
    expect(listSummary("done", 1, counts)).toEqual({ title: "Done 相关工作项", detail: "显示 1 / 该状态共 18" });
    expect(moveProjectCount(counts, "planned", "in_progress")).toEqual({ total: 42, byStatus: { captured: 6, planned: 7, in_progress: 11, done: 18 } });
  });

  it("prioritizes unfinished states, uses effective recency, and keeps the latest Done result", () => {
    const datedItems = items.map((item, index) => ({ ...item, updatedAt: `2026-08-13T0${index}:00:00.000Z` }));
    const sources = [{ eventId: "event_1_0", eventType: "decision", summary: "New decision", sourceExcerpt: "Decision", sessionId: "session_1", turnId: "turn_1", planeItemId: "1", createdAt: "2026-08-13T10:00:00.000Z", projectedAt: "2026-08-13T10:01:00.000Z" }];

    expect(selectRelevantItems(datedItems, sources).map((item) => item.id)).toEqual(["3", "2", "1", "6", "5"]);
  });

  it("keeps one item from every non-empty unfinished state before priority fill", () => {
    const competingItems = [
      { id: "ip-1", identifier: "DEMO-IP-1", title: "Newest in progress", status: "in_progress", updatedAt: "2026-08-13T10:00:00.000Z" },
      { id: "ip-2", identifier: "DEMO-IP-2", title: "Second in progress", status: "in_progress", updatedAt: "2026-08-13T09:00:00.000Z" },
      { id: "ip-3", identifier: "DEMO-IP-3", title: "Third in progress", status: "in_progress", updatedAt: "2026-08-13T08:00:00.000Z" },
      { id: "ip-4", identifier: "DEMO-IP-4", title: "Fourth in progress", status: "in_progress", updatedAt: "2026-08-13T07:00:00.000Z" },
      { id: "todo-1", identifier: "DEMO-TODO-1", title: "Todo item", status: "planned", updatedAt: "2026-08-13T06:00:00.000Z" },
      { id: "backlog-1", identifier: "DEMO-BACKLOG-1", title: "Backlog item", status: "captured", updatedAt: "2026-08-13T05:00:00.000Z" },
      { id: "done-1", identifier: "DEMO-DONE-1", title: "Done item", status: "done", updatedAt: "2026-08-13T11:00:00.000Z" },
    ];

    expect(selectRelevantItems(competingItems).map((item) => item.id)).toEqual(["ip-1", "todo-1", "backlog-1", "ip-2", "done-1"]);
  });

  it("selects a single status from its complete active collection", () => {
    const backlogItems = [
      ...items,
      { id: "8", identifier: "DEMO-8", title: "Recent backlog item", status: "captured", updatedAt: "2026-08-13T08:00:00.000Z" },
      { id: "9", identifier: "DEMO-9", title: "Another backlog item", status: "captured", updatedAt: "2026-08-13T07:00:00.000Z" },
      { id: "10", identifier: "DEMO-10", title: "Third backlog item", status: "captured", updatedAt: "2026-08-13T06:00:00.000Z" },
      { id: "11", identifier: "DEMO-11", title: "Fourth backlog item", status: "captured", updatedAt: "2026-08-13T05:00:00.000Z" },
      { id: "12", identifier: "DEMO-12", title: "Fifth backlog item", status: "captured", updatedAt: "2026-08-13T04:00:00.000Z" },
    ];

    expect(selectRelevantItems(backlogItems, [], "captured").map((item) => item.id)).toEqual(["8", "9", "10", "11", "12"]);
  });

  it("models optimistic status movement and complete rollback data", () => {
    const relevant = selectRelevantItems(items);
    const moved = updateItemStatus(relevant, "1", "done");
    expect(moved.find((item) => item.id === "1")?.status).toBe("done");
    expect(getStatusCounts(moved)).toEqual({ captured: 1, planned: 1, in_progress: 1, done: 2 });
    const rolledBack = updateItemStatus(moved, "1", "captured");
    expect(rolledBack.find((item) => item.id === "1")?.status).toBe("captured");
  });

  it("clears the faded drag state on drop and again after status synchronization", () => {
    const source = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/onDrop=.*finishDragging\(\); if \(itemId\) void moveItem/s);
    expect(source).toMatch(/finally \{\s*finishDragging\(\);\s*\}/s);
  });

  it("fills the host width up to 720px and wraps the state rail at 480px", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(styles).toContain("html, body, #root { width: 100%; min-height: 100%; }");
    expect(styles).toContain(".shell { width: 100%; min-height: 100dvh; padding: 12px;");
    expect(styles).toContain(".inline-card { width: 100%; max-width: 720px; margin-inline: auto;");
    expect(styles).not.toContain("width: min(420px, calc(100% - 24px))");
    expect(styles).toContain("@media (max-width: 480px)");
    expect(styles).toContain(".status-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }");

    const cardWidth = (viewportWidth: number) => Math.min(720, viewportWidth - 24);
    expect([1024, 640, 480, 320].map((viewportWidth) => cardWidth(viewportWidth))).toEqual([720, 616, 456, 296]);
  });

  it("uses the approved five-row Inline skeleton for the initial loading state", () => {
    const markup = renderToStaticMarkup(LoadingShell());
    const source = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");

    expect(source).toContain('if (loading && !summary) return <LoadingShell />;');
    expect(markup).toContain('class="inline-card loading-card"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("正在读取相关工作项");
    expect(markup.match(/class="work-item loading-work-item"/g)).toHaveLength(5);
    expect(markup).toContain('class="skeleton skeleton-cta"');
    expect(markup).not.toMatch(/<a(?:\s|>)/);
    expect(markup).not.toContain("Loading project panel");
    expect(markup).not.toContain("AMBIENT PROJECT LAYER");
  });

  it("keeps the loading shimmer restrained and disables it for reduced motion", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toContain("animation: skeleton-shimmer 1.5s ease-in-out infinite;");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.skeleton::after \{ animation: none; \}/);
  });

  it("keeps the loading header and narrow status rail footprints aligned with the normal card", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toContain(".card-header { padding: 12px 16px;");
    expect(styles).toContain(".project-heading h1 { margin: 0; min-width: 0; font-size: 13px; line-height: 18px;");
    expect(styles).toContain(".loading-header { min-height: 42px; }");
    expect(styles).not.toContain(".loading-header { min-height: 61px; }");
    expect(styles).toMatch(/@media \(max-width: 480px\) \{[\s\S]*\.status-target \{ min-height: 42px; \}[\s\S]*\.skeleton-status-target \{ height: 42px; \}/);
  });

  it("builds the Plane Cloud project work-items CTA and has no legacy full-board actions", () => {
    expect(projectPlaneUrl({ id: "project_1", canonicalCwd: "/work", planeProjectId: "cfb46dd7-38ca-4169-8d7a-a57201f933f5", planeBaseUrl: "https://api.plane.so", workspaceSlug: "bene2020", autoCaptureEnabled: true })).toBe("https://app.plane.so/bene2020/projects/cfb46dd7-38ca-4169-8d7a-a57201f933f5/issues");
    const source = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("detail-pane");
    expect(source).not.toContain("合并重复记录");
    expect(source).not.toContain("归档");
    expect(source).not.toContain("删除");
  });
});
