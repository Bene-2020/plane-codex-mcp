import { isSessionToken } from "@ambient/core";

export const PANEL_BOOTSTRAP_META_KEY = "ambient-project/bootstrap";
export const PANEL_PROXY_TOOL_NAME = "ambient_project_panel_request";

export interface PanelBootstrap {
  serviceBaseUrl: string;
  sessionToken: string;
  projectContextId: string;
}

export class SessionExpiredError extends Error {
  constructor() {
    super("The local service session expired");
    this.name = "SessionExpiredError";
  }
}

type PanelToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
};
export type PanelServerToolCall = (params: { name: string; arguments?: Record<string, unknown> }) => Promise<PanelToolResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parsePanelBootstrap(meta: unknown): PanelBootstrap | null {
  if (!isRecord(meta)) return null;
  const value = meta[PANEL_BOOTSTRAP_META_KEY];
  if (!isRecord(value)) return null;
  const serviceBaseUrl = value.serviceBaseUrl;
  const sessionToken = value.sessionToken;
  const projectContextId = value.projectContextId;
  if (typeof serviceBaseUrl !== "string") return null;
  try {
    const parsed = new URL(serviceBaseUrl);
    if (!/^https?:$/.test(parsed.protocol) || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  } catch {
    return null;
  }
  if (!isSessionToken(sessionToken) || typeof projectContextId !== "string" || !projectContextId.trim()) return null;
  return { serviceBaseUrl: serviceBaseUrl.replace(/\/+$/, ""), sessionToken, projectContextId };
}

export function createPanelApi(session: PanelBootstrap, onUnauthorized: () => void, fetchImpl: typeof fetch = fetch) {
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    headers.set("X-Ambient-Session-Token", session.sessionToken);
    const response = await fetchImpl(`${session.serviceBaseUrl}${path}`, {
      ...init,
      headers,
    });
    if (response.status === 401) {
      onUnauthorized();
      throw new SessionExpiredError();
    }
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? `HTTP ${response.status}`);
    return await response.json() as T;
  };
}

export function createPanelToolApi(callServerTool: PanelServerToolCall, onUnauthorized: () => void) {
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    const result = await callServerTool({ name: PANEL_PROXY_TOOL_NAME, arguments: { method, path, ...(body === undefined ? {} : { body }) } });
    const text = result.content?.find((block) => block.type === "text" && typeof block.text === "string")?.text;
    if (text === undefined) throw new Error("Panel host returned no response");
    if (result.isError) {
      let error: { status?: number; error?: string } = {};
      try { error = JSON.parse(text) as { status?: number; error?: string }; } catch { /* The host may return a plain error message. */ }
      if (error.status === 401) {
        onUnauthorized();
        throw new SessionExpiredError();
      }
      throw new Error(error.error ?? text);
    }
    return JSON.parse(text) as T;
  };
}
