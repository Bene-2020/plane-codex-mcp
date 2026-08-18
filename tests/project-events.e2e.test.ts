import { createRequire } from "node:module";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { handleHook } from "../apps/hook-adapter/src/index.js";
import { createMcpServer } from "../apps/mcp/src/index.js";
import { createService } from "../apps/service/src/index.js";
import { PlaneSdkAdapter } from "../packages/plane/src/index.js";
import { Storage } from "../packages/storage/src/index.js";

const requireMcp = createRequire(new URL("../apps/mcp/package.json", import.meta.url));
const { Client } = requireMcp("@modelcontextprotocol/sdk/client/index.js") as typeof import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = requireMcp("@modelcontextprotocol/sdk/inMemory.js") as typeof import("@modelcontextprotocol/sdk/inMemory.js");

const fixtureWorkspace = "fixture-workspace";
const fixtureProject = "fixture-project";
const fixtureApiKey = "fixture-api-key";

interface FixtureItem {
  id: string;
  sequence_id: number;
  project: string;
  name: string;
  description_html: string;
  state: string;
  type: { id: string; name: string };
  target_date: string | null;
  parent: string | null;
  updated_at: string;
  archived_at: string | null;
}

interface FixtureComment {
  id: string;
  comment_html: string;
  created_at: string;
}

interface FixtureCall {
  method: string;
  path: string;
  body: unknown;
}

interface SeedItemInput {
  id: string;
  identifier: string;
  title: string;
  state?: string;
  type?: string;
  description?: string;
}

function objectBody(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value);
}

class PlaneHttpFixture {
  private readonly server = createServer((request, response) => { void this.handle(request, response); });
  private readonly items = new Map<string, FixtureItem>();
  private readonly comments = new Map<string, FixtureComment[]>();
  private port: number | undefined;
  private nextSequence = 100;
  private nextCreatedItem = 1;
  private failNextPatchAfterWrite = false;

  readonly calls: FixtureCall[] = [];

  get baseUrl(): string {
    if (!this.port) throw new Error("Plane HTTP fixture has not started");
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Plane HTTP fixture did not expose a TCP port"));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  seedItem(input: SeedItemInput): void {
    const identifierNumber = Number(input.identifier.split("-").at(-1));
    const sequence = Number.isFinite(identifierNumber) ? identifierNumber : this.nextSequence++;
    const type = input.type ?? "Task";
    this.items.set(input.id, {
      id: input.id,
      sequence_id: sequence,
      project: fixtureProject,
      name: input.title,
      description_html: input.description ?? "",
      state: input.state ?? "state-progress",
      type: { id: `type-${type.toLowerCase()}`, name: type },
      target_date: null,
      parent: null,
      updated_at: new Date().toISOString(),
      archived_at: null,
    });
  }

  failNextUpdateAfterWrite(): void { this.failNextPatchAfterWrite = true; }

  getItem(id: string): FixtureItem | undefined { return this.items.get(id); }

  getComments(itemId: string): FixtureComment[] { return [...(this.comments.get(itemId) ?? [])]; }

  activeItemCount(): number { return [...this.items.values()].filter((item) => !item.archived_at).length; }

  createdItemCount(): number { return this.calls.filter((call) => call.method === "POST" && call.path.endsWith("/work-items/")).length; }

  mutationCalls(): FixtureCall[] {
    return this.calls.filter((call) =>
      call.method === "PATCH" && call.path.includes("/work-items/")
      || call.method === "POST" && (call.path.endsWith("/work-items/") || call.path.includes("/comments/")),
    );
  }

  countMutations(method: string, pathPart: string): number {
    return this.mutationCalls().filter((call) => call.method === method && call.path.includes(pathPart)).length;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = method === "GET" || method === "HEAD" ? undefined : await this.readBody(request);
      this.calls.push({ method, path: url.pathname, body });

      if (request.headers["x-api-key"] !== fixtureApiKey) {
        this.writeJson(response, 401, { message: "fixture API key rejected" });
        return;
      }

      const projectPrefix = `/api/v1/workspaces/${fixtureWorkspace}/projects/${fixtureProject}/`;
      if (method === "GET" && url.pathname === `${projectPrefix}states/`) {
        this.writeJson(response, 200, { results: [
          { id: "state-backlog", name: "Backlog", group: "backlog" },
          { id: "state-todo", name: "Todo", group: "unstarted" },
          { id: "state-progress", name: "In Progress", group: "started" },
          { id: "state-done", name: "Done", group: "completed" },
        ] });
        return;
      }
      if (method === "GET" && url.pathname === `${projectPrefix}work-item-types/`) {
        this.writeJson(response, 200, [
          { id: "type-task", name: "Task", description: "Fixture Task", is_active: true, is_epic: false },
          { id: "type-decision", name: "Decision", description: "Fixture Decision", is_active: true, is_epic: false },
        ]);
        return;
      }
      if (method === "GET" && url.pathname === `${projectPrefix}work-items/`) {
        this.writeJson(response, 200, { results: this.activeItems(), next_page_results: false, next_cursor: null });
        return;
      }

      const workItemsPrefix = `${projectPrefix}work-items/`;
      if (url.pathname.startsWith(workItemsPrefix)) {
        const segments = url.pathname.slice(workItemsPrefix.length).split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
        const itemId = segments[0];
        if (!itemId) {
          this.writeJson(response, 404, { message: "fixture work item route not found" });
          return;
        }
        if (segments.length === 2 && segments[1] === "comments") {
          if (method === "GET") {
            this.writeJson(response, 200, { results: this.getComments(itemId), next_page_results: false, next_cursor: null });
            return;
          }
          if (method === "POST") {
            const payload = objectBody(body);
            const comments = this.comments.get(itemId) ?? [];
            const comment: FixtureComment = {
              id: `fixture-comment-${comments.length + 1}`,
              comment_html: String(payload.comment_html ?? ""),
              created_at: new Date().toISOString(),
            };
            this.comments.set(itemId, [...comments, comment]);
            this.writeJson(response, 201, comment);
            return;
          }
        }
        if (segments.length === 1) {
          if (method === "POST") {
            const payload = objectBody(body);
            const typeId = String(payload.type ?? "type-task");
            const sequence = this.nextSequence++;
            const created: FixtureItem = {
              id: `fixture-created-${this.nextCreatedItem++}`,
              sequence_id: sequence,
              project: fixtureProject,
              name: String(payload.name ?? "Fixture item"),
              description_html: String(payload.description_html ?? ""),
              state: String(payload.state ?? "state-backlog"),
              type: { id: typeId, name: typeId === "type-decision" ? "Decision" : "Task" },
              target_date: typeof payload.target_date === "string" ? payload.target_date : null,
              parent: typeof payload.parent === "string" ? payload.parent : null,
              updated_at: new Date().toISOString(),
              archived_at: null,
            };
            this.items.set(created.id, created);
            this.writeJson(response, 201, created);
            return;
          }
          const item = this.items.get(itemId);
          if (!item) {
            this.writeJson(response, 404, { message: "fixture work item not found" });
            return;
          }
          if (method === "PATCH") {
            const payload = objectBody(body);
            if (typeof payload.name === "string") item.name = payload.name;
            if (typeof payload.description_html === "string") item.description_html = payload.description_html;
            if (typeof payload.state === "string") item.state = payload.state;
            if (typeof payload.type === "string") item.type = { id: payload.type, name: payload.type === "type-decision" ? "Decision" : "Task" };
            if (payload.target_date === null || typeof payload.target_date === "string") item.target_date = payload.target_date as string | null;
            item.updated_at = new Date().toISOString();
            if (this.failNextPatchAfterWrite) {
              this.failNextPatchAfterWrite = false;
              this.writeJson(response, 500, { message: "fixture update failed after write" });
              return;
            }
            this.writeJson(response, 200, item);
            return;
          }
        }
      }

      this.writeJson(response, 404, { message: `fixture route not found: ${method} ${url.pathname}` });
    } catch (error) {
      this.writeJson(response, 500, { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private activeItems(): FixtureItem[] { return [...this.items.values()].filter((item) => !item.archived_at); }

  private async readBody(request: IncomingMessage): Promise<unknown> {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    return raw ? JSON.parse(raw) as unknown : undefined;
  }

  private writeJson(response: ServerResponse, status: number, value: unknown): void {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json");
    response.end(escapeJson(value));
  }
}

async function callTool<T>(client: { callTool: (input: { name: string; arguments?: Record<string, unknown> }) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }> }, name: string, arguments_: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: arguments_ });
  expect(result.isError).not.toBe(true);
  const content = result.content.find((block) => block.type === "text");
  if (!content?.text) throw new Error(`MCP tool ${name} did not return text`);
  return JSON.parse(content.text) as T;
}

describe("real project event projection", () => {
  it("projects a Hook snapshot identifier through MCP, Outbox, the SDK, and a Plane HTTP fixture", async () => {
    const fixture = new PlaneHttpFixture();
    const storage = new Storage(":memory:");
    let service: ReturnType<typeof createService> | undefined;
    let mcpServer: ReturnType<typeof createMcpServer>["server"] | undefined;
    let client: InstanceType<typeof Client> | undefined;
    await fixture.start();
    try {
      const plane = new PlaneSdkAdapter(fixture.baseUrl, fixtureApiKey, fixtureWorkspace);
      const context = storage.bindContext({ cwd: "/ambient/e2e/completion", planeBaseUrl: fixture.baseUrl, workspaceSlug: fixtureWorkspace, planeProjectId: fixtureProject, planeProjectName: "Fixture project" });
      const originalItemId = "remote-item-42";
      fixture.seedItem({ id: originalItemId, identifier: "42", title: "Existing login work item" });
      for (const item of await plane.listItems(context)) storage.cacheItem(context.id, item, false);

      const hookResult = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: context.cwd, session_id: "e2e-session", turn_id: "completion-turn", prompt: "完成 DEMO-42" }), storage);
      const additionalContext = (hookResult.hookSpecificOutput as { additionalContext: string }).additionalContext;
      expect(additionalContext).toContain(`42 | ${originalItemId} | Existing login work item | in_progress`);

      service = createService({ storage, plane, sessionToken: "b".repeat(43) });
      const createdMcp = createMcpServer({ storage, plane });
      mcpServer = createdMcp.server;
      client = new Client({ name: "real-project-events-e2e", version: "0.1.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const accepted = await callTool<{ status: string; batchId: string; duplicate: boolean }>(client, "record_project_events", {
        projectContextId: context.id,
        sessionId: "e2e-session",
        turnId: "completion-turn",
        events: [
          { type: "completed", title: "完成 42", summary: "原工作项已完成", relatedItemId: "42", userDirected: true, sourceExcerpt: "完成 42" },
          { type: "decision", title: "完成说明", summary: "保留一次完成说明活动", relatedItemId: "42", userDirected: false, sourceExcerpt: "完成说明" },
        ],
      });
      expect(accepted).toMatchObject({ status: "accepted", batchId: "batch_1", duplicate: false });
      expect(storage.listPendingBatches().map((batch) => batch.id)).toEqual([accepted.batchId]);

      fixture.failNextUpdateAfterWrite();
      expect(await service.worker.processOnce()).toBe(1);
      expect(fixture.getItem(originalItemId)?.state).toBe("state-done");
      expect(storage.db.prepare("SELECT status FROM outbox_batches WHERE id=1").get()).toEqual({ status: "failed" });
      expect(storage.getSourceReference("event_1_0")).toMatchObject({ projectionStatus: "failed", projectionAttempts: 1, planeItemId: originalItemId });
      expect(storage.getSourceReference("event_1_1")).toMatchObject({ projectionStatus: "pending", projectionAttempts: 0, planeItemId: null });
      expect(fixture.getComments(originalItemId)).toHaveLength(0);
      expect(fixture.mutationCalls()).toHaveLength(1);

      const retry = await service.app.inject({ method: "POST", url: `/api/projects/${context.id}/retry/${accepted.batchId}`, headers: { "X-Ambient-Session-Token": service.sessionToken } });
      expect(retry.statusCode).toBe(200);
      expect(await service.worker.processOnce()).toBe(1);
      expect(await service.worker.processOnce()).toBe(0);

      expect(storage.db.prepare("SELECT status FROM outbox_batches WHERE id=1").get()).toEqual({ status: "synced" });
      expect(storage.getSourceReference("event_1_0")).toMatchObject({ projectionStatus: "completed", projectionAttempts: 2, planeItemId: originalItemId });
      expect(storage.getSourceReference("event_1_1")).toMatchObject({ projectionStatus: "completed", projectionAttempts: 1, planeItemId: originalItemId });
      expect(storage.listSources(context.id)).toHaveLength(2);
      expect(fixture.activeItemCount()).toBe(1);
      expect(fixture.getItem(originalItemId)?.state).toBe("state-done");
      expect(fixture.createdItemCount()).toBe(0);
      expect(fixture.countMutations("PATCH", `/work-items/${originalItemId}/`)).toBe(2);
      const comments = fixture.getComments(originalItemId);
      expect(comments).toHaveLength(1);
      expect(comments.filter((comment) => comment.comment_html.includes("[ambient:project_1:e2e-session:completion-turn:1]")).length).toBe(1);

      const summaryResponse = await service.app.inject({ method: "GET", url: `/api/projects/${context.id}/summary`, headers: { "X-Ambient-Session-Token": service.sessionToken } });
      expect(summaryResponse.statusCode).toBe(200);
      const summary = JSON.parse(summaryResponse.body) as { items: Array<{ id: string; identifier: string; status: string }>; projectCounts: { byStatus: { done: number } } | null; sources: Array<{ eventId: string; planeItemId: string | null; projectionStatus: string }>; failures: unknown[] };
      expect(summary.items.find((item) => item.id === originalItemId)).toMatchObject({ identifier: "42", status: "done" });
      expect(summary.projectCounts?.byStatus.done).toBe(1);
      expect(summary.sources.filter((source) => source.planeItemId === originalItemId && source.projectionStatus === "completed")).toHaveLength(2);
      expect(summary.failures).toEqual([]);
      expect(storage.getCachedItem(originalItemId)?.status).toBe("done");
    } finally {
      await client?.close();
      await mcpServer?.close();
      if (service) await service.app.close();
      else storage.close();
      await fixture.close();
    }
  });

  it.each([
    { label: "user-visible identifier", reference: "99", targetId: "remote-item-99", targetIdentifier: "99" },
    { label: "canonical UUID", reference: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440000", targetIdentifier: "100" },
  ])("accepts an unresolved $label, then retries without remote duplication", async ({ reference, targetId, targetIdentifier }) => {
    const fixture = new PlaneHttpFixture();
    const storage = new Storage(":memory:");
    let service: ReturnType<typeof createService> | undefined;
    let mcpServer: ReturnType<typeof createMcpServer>["server"] | undefined;
    let client: InstanceType<typeof Client> | undefined;
    await fixture.start();
    try {
      const plane = new PlaneSdkAdapter(fixture.baseUrl, fixtureApiKey, fixtureWorkspace);
      const context = storage.bindContext({ cwd: "/ambient/e2e/unresolved", planeBaseUrl: fixture.baseUrl, workspaceSlug: fixtureWorkspace, planeProjectId: fixtureProject });
      service = createService({ storage, plane, sessionToken: "c".repeat(43) });
      const createdMcp = createMcpServer({ storage, plane });
      mcpServer = createdMcp.server;
      client = new Client({ name: "real-unresolved-reference-e2e", version: "0.1.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const accepted = await callTool<{ status: string; batchId: string }>(client, "record_project_events", {
        projectContextId: context.id,
        sessionId: "unresolved-session",
        turnId: "unresolved-turn",
        events: [{ type: "completed", title: "完成稍后出现的工作项", summary: "等待远端目标", relatedItemId: reference, userDirected: true, sourceExcerpt: "完成工作项" }],
      });
      expect(accepted).toMatchObject({ status: "accepted", batchId: "batch_1" });
      expect(await service.worker.processOnce()).toBe(1);
      expect(storage.db.prepare("SELECT status FROM outbox_batches WHERE id=1").get()).toEqual({ status: "failed" });
      expect(storage.getSourceReference("event_1_0")).toMatchObject({ projectionStatus: "failed", projectionAttempts: 1, planeItemId: null });
      expect(storage.getSourceReference("event_1_0")?.projectionError).toContain("UNRESOLVED_RELATED_ITEM");
      expect(fixture.mutationCalls()).toEqual([]);
      expect(fixture.activeItemCount()).toBe(0);

      fixture.seedItem({ id: targetId, identifier: targetIdentifier, title: "Target appeared after retry" });
      const retry = await service.app.inject({ method: "POST", url: `/api/projects/${context.id}/retry/${accepted.batchId}`, headers: { "X-Ambient-Session-Token": service.sessionToken } });
      expect(retry.statusCode).toBe(200);
      expect(await service.worker.processOnce()).toBe(1);
      expect(await service.worker.processOnce()).toBe(0);
      expect(storage.db.prepare("SELECT status FROM outbox_batches WHERE id=1").get()).toEqual({ status: "synced" });
      expect(storage.getSourceReference("event_1_0")).toMatchObject({ projectionStatus: "completed", projectionAttempts: 2, planeItemId: targetId });
      expect(fixture.getItem(targetId)?.state).toBe("state-done");
      expect(fixture.activeItemCount()).toBe(1);
      expect(fixture.createdItemCount()).toBe(0);
      expect(fixture.countMutations("PATCH", `/work-items/${targetId}/`)).toBe(1);

      const directUuidAccepted = await callTool<{ status: string; batchId: string }>(client, "record_project_events", {
        projectContextId: context.id,
        sessionId: "unresolved-session",
        turnId: "direct-uuid-turn",
        events: [{ type: "decision", title: "通过 UUID 关联", summary: "canonical UUID 兼容路径", relatedItemId: targetId, userDirected: false, sourceExcerpt: "使用 UUID" }],
      });
      expect(directUuidAccepted).toMatchObject({ status: "accepted", batchId: "batch_2" });
      expect(await service.worker.processOnce()).toBe(1);
      expect(await service.worker.processOnce()).toBe(0);
      expect(storage.db.prepare("SELECT status FROM outbox_batches WHERE id=2").get()).toEqual({ status: "synced" });
      expect(storage.getSourceReference("event_2_0")).toMatchObject({ projectionStatus: "completed", projectionAttempts: 1, planeItemId: targetId });
      expect(fixture.getComments(targetId)).toHaveLength(1);
      expect(fixture.activeItemCount()).toBe(1);
      expect(fixture.countMutations("POST", "/comments/")).toBe(1);
    } finally {
      await client?.close();
      await mcpServer?.close();
      if (service) await service.app.close();
      else storage.close();
      await fixture.close();
    }
  });
});
