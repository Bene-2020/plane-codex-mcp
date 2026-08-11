import { describe, expect, it, vi } from "vitest";
import { createPanelApi, PANEL_BOOTSTRAP_META_KEY, parsePanelBootstrap, SessionExpiredError } from "./session";

const sessionToken = "a".repeat(43);

describe("MCP App panel session", () => {
  it("reads bootstrap only from the component metadata shape", () => {
    expect(parsePanelBootstrap({
      [PANEL_BOOTSTRAP_META_KEY]: {
        serviceBaseUrl: "http://127.0.0.1:4317/",
        sessionToken,
        projectContextId: "project_1",
      },
    })).toEqual({ serviceBaseUrl: "http://127.0.0.1:4317", sessionToken, projectContextId: "project_1" });
    expect(parsePanelBootstrap({ content: [{ type: "text", text: sessionToken }] })).toBeNull();
    expect(parsePanelBootstrap({ [PANEL_BOOTSTRAP_META_KEY]: { serviceBaseUrl: "https://example.com", sessionToken, projectContextId: "project_1" } })).toBeNull();
  });

  it("uses one authenticated client for every request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createPanelApi({ serviceBaseUrl: "http://127.0.0.1:4317", sessionToken, projectContextId: "project_1" }, vi.fn(), fetchImpl);

    await api<{ ok: boolean }>("/api/health", { headers: { "X-Ambient-Session-Token": "wrong" } });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:4317/api/health");
    expect(new Headers(init?.headers).get("X-Ambient-Session-Token")).toBe(sessionToken);
    expect(String(url)).not.toContain(sessionToken);
  });

  it("clears the in-memory session on 401 without retrying", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    const api = createPanelApi({ serviceBaseUrl: "http://127.0.0.1:4317", sessionToken, projectContextId: "project_1" }, onUnauthorized, fetchImpl);

    await expect(api("/api/projects/project_1/summary")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
