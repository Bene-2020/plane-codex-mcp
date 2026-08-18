import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { HttpError, PlaneClient } from "@makeplane/plane-node-sdk";
import { PlaneSdkAdapter } from "./index.js";

type FixtureRequest = {
  method: string;
  rawUrl: string;
  url: URL;
  headers: IncomingMessage["headers"];
  body: string;
};
type FixtureHandler = (request: FixtureRequest, response: ServerResponse) => void | Promise<void>;
type RecordedRequest = FixtureRequest;

type FixtureServer = {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function startFixture(handler: FixtureHandler): Promise<FixtureServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const rawUrl = request.url ?? "/";
    const fixtureRequest: FixtureRequest = {
      method: request.method ?? "GET",
      rawUrl,
      url: new URL(rawUrl, "http://fixture.invalid"),
      headers: request.headers,
      body: await readBody(request),
    };
    requests.push(fixtureRequest);
    try {
      await handler(fixtureRequest, response);
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function sendNoContent(response: ServerResponse): void {
  response.statusCode = 204;
  response.end();
}

function header(request: RecordedRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sdkContext(baseUrl: string) {
  return {
    id: "project_1",
    cwd: "/fixture/workspace",
    canonicalCwd: "/fixture/workspace",
    planeBaseUrl: baseUrl,
    workspaceSlug: "fixture-workspace",
    planeProjectId: "fixture-project",
    autoCaptureEnabled: true,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
}

describe("Plane SDK 0.2.12 compatibility", () => {
  it("uses the locked SDK request contract for project, state, type, and cursor-paginated work-item reads", async () => {
    const testRequire = createRequire(import.meta.url);
    const sdkEntry = testRequire.resolve("@makeplane/plane-node-sdk");
    expect(createRequire(sdkEntry)("axios").VERSION).toBe("1.18.0");
    const projects = Array.from({ length: 100 }, (_, index) => ({ id: `project-${index + 1}`, name: `Project ${index + 1}`, identifier: `P${index + 1}` }));
    const workItems = Array.from({ length: 100 }, (_, index) => ({ id: `item-${index + 1}`, sequence_id: index + 1, project: "fixture-project", name: `Item ${index + 1}`, state: "state-backlog", updated_at: "2026-08-18T00:00:00.000Z" }));
    const fixture = await startFixture(async ({ method, url }, response) => {
      if (method !== "GET") return sendJson(response, 405, { message: "method not allowed" });
      if (url.pathname === "/api/v1/workspaces/fixture-workspace/projects/") {
        if (url.searchParams.get("offset") === "100") return sendJson(response, 200, { results: [{ id: "project-101", name: "Project 101", identifier: "P101" }], total_count: 101, total_results: 101, next_page_results: false });
        return sendJson(response, 200, { results: projects, total_count: 101, total_results: 101, next_page_results: true });
      }
      if (url.pathname === "/api/v1/workspaces/fixture-workspace/projects/fixture-project/states/") {
        return sendJson(response, 200, { results: [{ id: "state-backlog", name: "Backlog", group: "backlog" }], total_count: 1, total_results: 1, next_page_results: false });
      }
      if (url.pathname === "/api/v1/workspaces/fixture-workspace/projects/fixture-project/work-item-types/") {
        return sendJson(response, 200, [{ id: "type-task", name: "Task" }]);
      }
      if (url.pathname === "/api/v1/workspaces/fixture-workspace/projects/fixture-project/work-items/") {
        if (url.searchParams.get("cursor") === "cursor-page-2") {
          return sendJson(response, 200, { results: [{ id: "item-101", sequence_id: 101, project: "fixture-project", name: "Item 101", state: "state-backlog", updated_at: "2026-08-18T00:00:00.000Z" }], next_cursor: undefined, next_page_results: false });
        }
        return sendJson(response, 200, { results: workItems, next_cursor: "cursor-page-2", next_page_results: true });
      }
      return sendJson(response, 404, { message: `unhandled ${method} ${url.pathname}` });
    });
    try {
      const adapter = new PlaneSdkAdapter(fixture.url, "fixture-api-key", "fixture-workspace");
      const listedProjects = await adapter.listProjects();
      const listedItems = await adapter.listItems(sdkContext(fixture.url));

      expect(listedProjects).toHaveLength(101);
      expect(listedProjects.at(-1)).toMatchObject({ id: "project-101", identifier: "P101", workspaceSlug: "fixture-workspace" });
      expect(listedItems).toHaveLength(101);
      expect(listedItems.at(-1)).toMatchObject({ id: "item-101", identifier: "101", title: "Item 101", stateId: "state-backlog", stateName: "Backlog" });

      const projectRequests = fixture.requests.filter((request) => request.url.pathname.endsWith("/projects/"));
      expect(projectRequests.map((request) => request.url.searchParams.get("offset"))).toEqual([null, "100"]);
      const workItemRequests = fixture.requests.filter((request) => request.url.pathname.endsWith("/work-items/"));
      expect(workItemRequests.map((request) => request.url.searchParams.get("cursor"))).toEqual([null, "cursor-page-2"]);
      expect(fixture.requests.every((request) => header(request, "x-api-key") === "fixture-api-key")).toBe(true);
      expect(fixture.requests.every((request) => request.url.pathname.startsWith("/api/v1/"))).toBe(true);
      expect(fixture.requests.find((request) => request.url.pathname.endsWith("/work-items/"))?.url.searchParams.get("per_page")).toBe("100");
    } finally {
      await fixture.close();
    }
  });

  it("covers real SDK mutation paths and paginates comments before deduplicating activities", async () => {
    const createdItem = { id: "item-created", sequence_id: 7, project: "fixture-project", name: "Created item", state: "state-backlog", type: "type-task", description_html: "description", updated_at: "2026-08-18T00:00:00.000Z" };
    const comments = Array.from({ length: 100 }, (_, index) => ({ id: `comment-${index + 1}`, comment_html: `old comment ${index + 1}`, created_at: "2026-08-18T00:00:00.000Z" }));
    const fixture = await startFixture(async ({ method, url, body }, response) => {
      if (method === "GET" && url.pathname.endsWith("/states/")) {
        return sendJson(response, 200, { results: [{ id: "state-backlog", name: "Backlog", group: "backlog" }, { id: "state-done", name: "Done", group: "completed" }], next_page_results: false });
      }
      if (method === "GET" && url.pathname.endsWith("/work-item-types/")) return sendJson(response, 200, [{ id: "type-task", name: "Task" }]);
      if (method === "GET" && url.pathname.endsWith("/work-items/")) return sendJson(response, 200, { results: [], next_page_results: false });
      if (method === "POST" && url.pathname.endsWith("/work-items/")) return sendJson(response, 201, createdItem);
      if (method === "PATCH" && url.pathname.endsWith("/work-items/item-created/")) return sendJson(response, 200, { ...createdItem, ...JSON.parse(body), updated_at: "2026-08-18T00:01:00.000Z" });
      if (method === "GET" && url.pathname.endsWith("/comments/")) {
        if (url.searchParams.get("offset") === "100") return sendJson(response, 200, { results: [{ id: "comment-existing", comment_html: "already recorded\n\n[ambient:existing-source]", created_at: "2026-08-18T00:00:00.000Z" }], next_page_results: false });
        return sendJson(response, 200, { results: comments, total_results: 101, next_page_results: true });
      }
      if (method === "POST" && url.pathname.endsWith("/comments/")) return sendJson(response, 201, { id: "comment-created", comment_html: JSON.parse(body).comment_html, created_at: "2026-08-18T00:02:00.000Z" });
      if (method === "DELETE" && url.pathname.endsWith("/work-items/item-created/")) return sendNoContent(response);
      if (method === "POST" && url.pathname.endsWith("/work-items/item-created/archive/")) return sendNoContent(response);
      return sendJson(response, 404, { message: `unhandled ${method} ${url.pathname}` });
    });
    try {
      const adapter = new PlaneSdkAdapter(fixture.url, "fixture-api-key", "fixture-workspace");
      const context = sdkContext(fixture.url);
      const created = await adapter.createItem(context, { title: "Created item", description: "description", kind: "task", status: "captured", sourceEventId: "create-source" });
      expect(created.id).toBe("item-created");

      const createRequest = fixture.requests.find((request) => request.method === "POST" && request.url.pathname.endsWith("/work-items/"));
      expect(JSON.parse(createRequest?.body ?? "{}" )).toMatchObject({ name: "Created item", state: "state-backlog", type: "type-task", description_html: "description\n\n[ambient-source:create-source]" });

      const updated = await adapter.updateItem(context, created.id, { title: "Renamed item", status: "done", kind: "task" });
      expect(updated).toMatchObject({ id: "item-created", title: "Renamed item", status: "done" });
      const updateRequest = fixture.requests.find((request) => request.method === "PATCH");
      expect(JSON.parse(updateRequest?.body ?? "{}" )).toMatchObject({ name: "Renamed item", state: "state-done", type: "type-task" });

      const existingActivity = await adapter.addActivity(context, created.id, "already recorded", "existing-source");
      expect(existingActivity).toMatchObject({ id: "comment-existing", body: "already recorded", sourceEventId: "existing-source" });
      expect(fixture.requests.filter((request) => request.method === "POST" && request.url.pathname.endsWith("/comments/")).length).toBe(0);

      const newActivity = await adapter.addActivity(context, created.id, "new activity", "new-source");
      expect(newActivity).toMatchObject({ id: "comment-created", body: "new activity", sourceEventId: "new-source" });
      const commentCreateRequest = fixture.requests.find((request) => request.method === "POST" && request.url.pathname.endsWith("/comments/"));
      expect(JSON.parse(commentCreateRequest?.body ?? "{}" )).toEqual({ comment_html: "new activity\n\n[ambient:new-source]" });

      await adapter.deleteItem(context, created.id);
      await adapter.archiveItem(context, created.id);
      expect(fixture.requests.some((request) => request.method === "DELETE" && request.url.pathname.endsWith("/work-items/item-created/"))).toBe(true);
      expect(fixture.requests.some((request) => request.method === "POST" && request.url.pathname.endsWith("/work-items/item-created/archive/"))).toBe(true);
      expect(fixture.requests.filter((request) => request.method === "GET" && request.url.pathname.endsWith("/comments/")).map((request) => request.url.searchParams.get("offset"))).toEqual([null, "100", null, "100"]);
    } finally {
      await fixture.close();
    }
  });

  it("preserves SDK HTTP error status and response data", async () => {
    const fixture = await startFixture(async ({ method, url }, response) => {
      if (method === "GET" && url.pathname.endsWith("/projects/")) return sendJson(response, 429, { message: "fixture rate limit", code: "RATE_LIMITED" });
      return sendJson(response, 404, { message: "not found" });
    });
    try {
      const adapter = new PlaneSdkAdapter(fixture.url, "fixture-api-key", "fixture-workspace");
      await expect(adapter.listProjects()).rejects.toMatchObject({ name: "HttpError", statusCode: 429, response: { message: "fixture rate limit", code: "RATE_LIMITED" } } satisfies Partial<HttpError>);
    } finally {
      await fixture.close();
    }
  });

  it("honors HTTP_PROXY and NO_PROXY on the real SDK request path without contacting Plane", async () => {
    const target = await startFixture(async ({ method, url }, response) => {
      if (method === "GET" && url.pathname.endsWith("/projects/")) return sendJson(response, 200, { results: [{ id: "project-1", name: "Fixture project", identifier: "FIX" }], next_page_results: false });
      return sendJson(response, 404, { message: "not found" });
    });
    const proxy = await startFixture(async ({ method, rawUrl, headers, body }, response) => {
      const targetUrl = new URL(rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `http://${headers.host}${rawUrl}`);
      const upstream = httpRequest({ hostname: targetUrl.hostname, port: targetUrl.port, method, path: `${targetUrl.pathname}${targetUrl.search}`, headers: { ...headers, host: targetUrl.host } }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on("error", (error) => {
        response.statusCode = 502;
        response.end(error.message);
      });
      if (body) upstream.write(body);
      upstream.end();
    });

    const proxyEnvironment = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy", "npm_config_http_proxy", "npm_config_https_proxy", "npm_config_no_proxy"] as const;
    const previous = Object.fromEntries(proxyEnvironment.map((name) => [name, process.env[name]]));
    const setEnvironment = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    try {
      for (const name of proxyEnvironment) delete process.env[name];
      process.env.HTTP_PROXY = proxy.url;
      process.env.NO_PROXY = "";
      await new PlaneSdkAdapter(target.url, "fixture-api-key", "fixture-workspace").listProjects();
      expect(proxy.requests).toHaveLength(1);
      expect(target.requests).toHaveLength(1);

      process.env.NO_PROXY = "127.0.0.1";
      process.env.no_proxy = "127.0.0.1";
      await new PlaneSdkAdapter(target.url, "fixture-api-key", "fixture-workspace").listProjects();
      expect(proxy.requests).toHaveLength(1);
      expect(target.requests).toHaveLength(2);
    } finally {
      for (const name of proxyEnvironment) setEnvironment(name, previous[name]);
      await Promise.all([proxy.close(), target.close()]);
    }
  });

  it("constructs the project-specific HTTPS proxy bypass using uppercase environment variables", async () => {
    const names = ["PLANE_MODE", "PLANE_BASE_URL", "PLANE_API_KEY", "PLANE_WORKSPACE_SLUG", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const setEnvironment = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    try {
      for (const name of names) delete process.env[name];
      process.env.PLANE_MODE = "sdk";
      process.env.PLANE_BASE_URL = "https://api.plane.so";
      process.env.PLANE_API_KEY = "fixture-only-key";
      process.env.PLANE_WORKSPACE_SLUG = "fixture-workspace";
      process.env.HTTPS_PROXY = "http://127.0.0.1:18080";
      expect(() => new PlaneClient({ baseUrl: "https://api.plane.so", apiKey: "fixture-only-key" })).not.toThrow();
      const { createPlaneAdapter } = await import("./index.js");
      expect(createPlaneAdapter()).toBeInstanceOf(PlaneSdkAdapter);
      expect(process.env.no_proxy).toBe("api.plane.so");
    } finally {
      for (const name of names) setEnvironment(name, previous[name]);
    }
  });
});
