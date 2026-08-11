import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { eventBatchSchema } from "@ambient/core";
import { createPlaneAdapter } from "@ambient/plane";
import type { PlaneAdapter } from "@ambient/plane";
import { Storage } from "@ambient/storage";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const bindingSchema = z.object({
  cwd: z.string().trim().min(1),
  planeBaseUrl: z.string().url().optional(),
  workspaceSlug: z.string().trim().min(1).max(160),
  planeProjectId: z.string().trim().min(1).max(200),
  planeProjectName: z.string().trim().min(1).max(240).optional(),
  autoCaptureEnabled: z.boolean().optional(),
});
const bindInput = (input: z.infer<typeof bindingSchema>) => ({ ...input, planeBaseUrl: input.planeBaseUrl ?? process.env.PLANE_BASE_URL ?? "https://api.plane.so" });

export interface McpServerDependencies { storage?: Storage; plane?: PlaneAdapter; }

export function createMcpServer(dependencies: McpServerDependencies = {}): { server: McpServer; storage: Storage } {
  const storage = dependencies.storage ?? new Storage();
  const plane = dependencies.plane ?? createPlaneAdapter();
  const server = new McpServer({
    name: "ambient-project",
    version: "0.1.0",
  }, {
    instructions: "Maintain project context quietly. Use list_projects only to help a user choose a project, bind only after explicit choice, and record meaningful events in one non-empty batch. Do not expose Plane CRUD, delete items, reassign people, or use a second semantic model.",
  });

  // Read-only host experiment. The local companion panel remains the Demo's primary UI.
  server.registerResource("project-panel-host-check", "ui://ambient-project/summary/v1.html", { description: "Read-only host-rendering experiment for the ambient project panel.", mimeType: "text/html;profile=mcp-app" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/html;profile=mcp-app", text: "<!doctype html><meta charset=\"utf-8\"><style>body{font:14px system-ui;padding:20px;color:#332b25}code{color:#9a5c35}</style><h3>Ambient project panel</h3><p>This is a read-only MCP UI host experiment. Use the local companion panel for editing.</p><code>ui://ambient-project/summary/v1.html</code>" }] }));

  server.registerTool("list_projects", {
    title: "List projects",
    description: "List Plane projects available for an explicit project-context choice.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => text(await plane.listProjects()));

  server.registerTool("get_binding", {
    title: "Get project binding",
    description: "Get the project context bound to a normalized cwd.",
    inputSchema: z.object({ cwd: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ cwd }) => text(storage.getContextByCwd(cwd)));

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

  server.registerTool("record_project_events", {
    title: "Record project events",
    description: "Reliably accept one non-empty batch of meaningful project events for the current work turn. Plane synchronization is asynchronous.",
    inputSchema: eventBatchSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => {
    const context = storage.getContext(input.projectContextId);
    if (!context) throw new Error("No project context is bound for this projectContextId");
    if (!context.autoCaptureEnabled) throw new Error("Automatic capture is disabled for this project context");
    const result = storage.enqueueBatch(input);
    return text({ status: "accepted", ...result });
  });

  return { server, storage };
}

async function main(): Promise<void> {
  const { server } = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
