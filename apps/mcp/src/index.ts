import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { eventBatchSchema, isSessionToken, noProjectEventsReviewSchema, parentChildClosureRule, projectBindingConditionalFinalDeliveryRule, projectBindingPermanentRefusalRule, projectBindingPostPromptDeferralRule, projectBindingRestoreRule, projectBindingSessionDeferralRule, relatedItemIdContract, supersededPlanRule } from "@ambient/core";
import { createPlaneAdapter } from "@ambient/plane";
import type { PlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startService } from "@ambient/service";
import type { RunningService } from "@ambient/service";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
export const PANEL_RESOURCE_URI = "ui://ambient-project/panel/v1.html";
export const PANEL_BOOTSTRAP_META_KEY = "ambient-project/bootstrap";
export const PANEL_PROXY_TOOL_NAME = "ambient_project_panel_request";

export interface PanelBootstrapMetadata {
  serviceBaseUrl: string;
  sessionToken: string;
  projectContextId: string;
}

export interface PanelSession {
  serviceBaseUrl: string;
  sessionToken: string;
}

export function panelResourcePath(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "../../panel/dist/index.html");
}

export function panelBootstrapMetadata(projectContextId: string, serviceBaseUrl: string, sessionToken: string): PanelBootstrapMetadata {
  if (!isSessionToken(sessionToken)) throw new Error("Panel session token is invalid");
  return { serviceBaseUrl, sessionToken, projectContextId };
}

function normalizeServiceBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!/^https?:$/.test(parsed.protocol) || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Panel service URL must point to localhost");
  return value.replace(/\/+$/, "");
}

const panelProxyPathPattern = /^\/api\/(?:context(?:\?[^#]*)?|projects\/[^/?]+\/summary|items\/[^/?]+\/status)$/;
const panelProxySchema = z.object({
  method: z.enum(["GET", "PATCH"]),
  path: z.string().regex(panelProxyPathPattern, "Panel API path is not allowed"),
  body: z.record(z.unknown()).optional(),
});
type PanelProxyInput = z.infer<typeof panelProxySchema>;

const bindingSchema = z.object({
  cwd: z.string().trim().min(1),
  planeBaseUrl: z.string().url().optional(),
  workspaceSlug: z.string().trim().min(1).max(160),
  planeProjectId: z.string().trim().min(1).max(200),
  planeProjectName: z.string().trim().min(1).max(240).optional(),
  autoCaptureEnabled: z.boolean().optional(),
});
const cwdSchema = z.object({ cwd: z.string().trim().min(1) });
const bindInput = (input: z.infer<typeof bindingSchema>) => ({ ...input, planeBaseUrl: input.planeBaseUrl ?? process.env.PLANE_BASE_URL ?? "https://api.plane.so" });

export interface McpServerDependencies { storage?: Storage; plane?: PlaneAdapter; panelSession?: PanelSession; }

export function createMcpServer(dependencies: McpServerDependencies = {}): { server: McpServer; storage: Storage } {
  const plane = dependencies.plane ?? createPlaneAdapter();
  const storage = dependencies.storage ?? new Storage();
  const panelSession = dependencies.panelSession ? {
    serviceBaseUrl: normalizeServiceBaseUrl(dependencies.panelSession.serviceBaseUrl),
    sessionToken: dependencies.panelSession.sessionToken,
  } : undefined;
  if (panelSession && !isSessionToken(panelSession.sessionToken)) throw new Error("Panel session token is invalid");
  const bindingInstructions = {
    instructions: [
      "Maintain project context quietly.",
      relatedItemIdContract,
      "For an unbound cwd, follow the onboarding phase injected by SessionStart/UserPromptSubmit and the visible conversation. Apply the current user's explicit branch before fallback onboarding.",
      projectBindingPermanentRefusalRule,
      projectBindingSessionDeferralRule,
      projectBindingPostPromptDeferralRule,
      projectBindingRestoreRule,
      "If no actual onboarding question has appeared yet, call list_projects, show the real returned Plane projects, and ask the user to choose. Do not guess from a Codex Project name, directory name, Git remote, or conversation, and call bind_project only after an explicit choice.",
      "When get_binding returns null for the cwd, do not call open_project_panel; call it only after get_binding, bind_project, or change_binding returns a real project context.",
      projectBindingConditionalFinalDeliveryRule,
      "Before the final reply for a bound, auto-capture-enabled turn, decide whether the user's request, plan, tool results, or conclusion created a meaningful project event; if yes, record it in one non-empty batch, otherwise acknowledge that the turn has no project events.",
      supersededPlanRule,
      parentChildClosureRule,
      "The Stop Hook only audits the turn and always allows it to end; it never blocks, injects a follow-up prompt, or asks for a second reply.",
      "Do not expose Plane CRUD, delete items, reassign people, save user wording, or use a second semantic model.",
    ].join(" "),
  };
  const server = new McpServer({
    name: "ambient-project",
    version: "0.1.0",
  }, {
    ...bindingInstructions,
  });
  const panelConnectDomains = panelSession ? [new URL(panelSession.serviceBaseUrl).origin] : [];

  registerAppResource(server, "ambient-project-panel", PANEL_RESOURCE_URI, {
    description: "Ambient project records panel.",
    mimeType: RESOURCE_MIME_TYPE,
    _meta: { ui: { csp: { connectDomains: panelConnectDomains } } },
  }, async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(panelResourcePath(), "utf8"),
      _meta: { ui: { csp: { connectDomains: panelConnectDomains } } },
    }],
  }));
  server.registerResource("project-panel-host-check", "ui://ambient-project/summary/v1.html", { description: "Legacy read-only host check; use open_project_panel for the interactive Panel.", mimeType: RESOURCE_MIME_TYPE }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: "<!doctype html><meta charset=\"utf-8\"><style>body{font:14px system-ui;padding:20px;color:#332b25}code{color:#9a5c35}</style><h3>Ambient project panel</h3><p>Use open_project_panel for the interactive Codex MCP App.</p><code>ui://ambient-project/panel/v1.html</code>" }] }));

  server.registerTool("list_projects", {
    title: "List projects",
    description: "List Plane projects available for an explicit project-context choice.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => text(await plane.listProjects()));

  server.registerTool("get_binding", {
    title: "Get project binding",
    description: "Get the project context bound to an explicit cwd using the shared workspace identity resolver.",
    inputSchema: z.object({ cwd: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ cwd }) => text(storage.getContextByCwd(cwd)));

  registerAppTool(server, "open_project_panel", {
    title: "Open project panel",
    description: "Open the Ambient project panel only for a project context returned by get_binding, bind_project, or change_binding; after get_binding returns null, do not call this tool.",
    inputSchema: {
      projectContextId: z.string().regex(/^project_[0-9]+$/).optional(),
      cwd: z.string().trim().min(1).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: PANEL_RESOURCE_URI, visibility: ["model"] } },
  }, async (input: { projectContextId?: string; cwd?: string }) => {
    if (!panelSession) throw new Error("Project panel session is unavailable");
    if (!input.projectContextId && !input.cwd) throw new Error("Provide projectContextId or cwd to open the project panel");
    const context = input.projectContextId ? storage.getContext(input.projectContextId) : storage.getContextByCwd(input.cwd!);
    if (!context) throw new Error("Project context not found");
    return {
      content: [{ type: "text" as const, text: "Project panel initialized." }],
      _meta: {
        [PANEL_BOOTSTRAP_META_KEY]: panelBootstrapMetadata(context.id, panelSession.serviceBaseUrl, panelSession.sessionToken),
      },
    };
  });

  if (panelSession) {
    registerAppTool(server, PANEL_PROXY_TOOL_NAME, {
      title: "Ambient project panel request",
      description: "Proxy one allowlisted panel API request through the MCP host without exposing the local HTTP service to the UI sandbox.",
      inputSchema: panelProxySchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    }, async ({ method, path, body }: PanelProxyInput) => {
      const target = new URL(path, panelSession.serviceBaseUrl);
      if (target.origin !== new URL(panelSession.serviceBaseUrl).origin || !path.startsWith("/api/")) throw new Error("Panel API path is not allowed");
      const response = await fetch(target, {
        method,
        headers: body === undefined ? { "X-Ambient-Session-Token": panelSession.sessionToken } : { "Content-Type": "application/json", "X-Ambient-Session-Token": panelSession.sessionToken },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const responseBody = await response.text();
      if (!response.ok) return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ status: response.status, error: responseBody }) }] };
      return { content: [{ type: "text" as const, text: responseBody }] };
    });
  }

  server.registerTool("bind_project", {
    title: "Bind project",
    description: "Bind a cwd to a Plane project after the user explicitly selected it.",
    inputSchema: bindingSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const context = storage.bindContext(bindInput(input), false);
    return text(context);
  });

  server.registerTool("change_binding", {
    title: "Change project binding",
    description: "Change the cwd's Plane project only after the user explicitly asks.",
    inputSchema: bindingSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => text(storage.bindContext(bindInput(input), true)));

  server.registerTool("decline_project_binding", {
    title: "Decline project binding",
    description: "Persist or reuse a do-not-ask-again preference for the effective stable workspace identity only after the user explicitly gives a long-term refusal.",
    inputSchema: cwdSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ cwd }) => text(storage.declineBinding(cwd)));

  server.registerTool("restore_project_binding", {
    title: "Restore project binding onboarding",
    description: "Restore the current stable workspace identity's project-selection flow only after the user explicitly asks to resume; inherited path refusals use an exact local override.",
    inputSchema: cwdSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ cwd }) => text(storage.restoreBinding(cwd)));

  server.registerTool("record_project_events", {
    title: "Record project events",
    description: `Reliably accept one non-empty batch of meaningful project events for the current work turn. ${relatedItemIdContract} Plane synchronization is asynchronous.`,
    inputSchema: eventBatchSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => {
    const context = storage.getContext(input.projectContextId);
    if (!context) throw new Error("No project context is bound for this projectContextId");
    if (!context.autoCaptureEnabled) throw new Error("Automatic capture is disabled for this project context");
    const result = storage.enqueueBatch(input);
    return text({ status: "accepted", ...result });
  });

  server.registerTool("acknowledge_no_project_events", {
    title: "Acknowledge no project events",
    description: "Idempotently acknowledge that the specified work turn was reviewed and produced no project events. This creates no Plane item and no outbox batch.",
    inputSchema: noProjectEventsReviewSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const context = storage.getContext(input.projectContextId);
    if (!context) throw new Error("No project context is bound for this projectContextId");
    if (!context.autoCaptureEnabled) throw new Error("Automatic capture is disabled for this project context");
    return text(storage.acknowledgeNoProjectEvents(input));
  });

  return { server, storage };
}

export interface McpRuntimeOptions {
  sessionToken?: string;
  storage?: Storage;
  plane?: PlaneAdapter;
  port?: number;
  transport?: Transport;
}

export interface McpRuntime {
  server: McpServer;
  service: RunningService;
  sessionToken: string;
  close: () => Promise<void>;
}

export async function startMcpRuntime(options: McpRuntimeOptions = {}): Promise<McpRuntime> {
  const sessionToken = options.sessionToken ?? randomBytes(32).toString("base64url");
  const service = await startService({ storage: options.storage, plane: options.plane, sessionToken, host: "127.0.0.1", port: options.port ?? 0 });
  let server: McpServer | undefined;
  let serviceClosePromise: Promise<void> | undefined;
  const closeService = (): Promise<void> => {
    serviceClosePromise ??= service.close();
    return serviceClosePromise;
  };
  try {
    server = createMcpServer({ storage: service.storage, plane: service.plane, panelSession: { serviceBaseUrl: service.baseUrl, sessionToken } }).server;
    let closePromise: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closePromise ??= (async () => { await server!.close(); await closeService(); })();
      return closePromise;
    };
    if (options.transport) {
      const previousOnClose = options.transport.onclose;
      options.transport.onclose = () => { previousOnClose?.(); void closeService(); };
      await server.connect(options.transport);
    }
    return { server, service, sessionToken, close };
  } catch (error) {
    try {
      await server?.close();
    } finally {
      await closeService();
    }
    throw error;
  }
}
