import Fastify from "fastify";
import cors from "@fastify/cors";
import { ProjectContext, RecordKind, LifecycleState, PlaneItem } from "@ambient/core";
import { createPlaneAdapter, EventCoordinator, PlaneAdapter, UpdateItemInput } from "@ambient/plane";
import { Storage } from "@ambient/storage";
import { createSessionToken, matchesSessionToken, SESSION_TOKEN_HEADER } from "./session.js";

export const CODEX_DESKTOP_CORS_ORIGIN = /^codex-sandbox:\/\/(?:[A-Za-z0-9-]+\.)?web-sandbox\.oaiusercontent\.com$/;
export const DEFAULT_CORS_ORIGINS = ["https://web-sandbox.oaiusercontent.com", "http://127.0.0.1:4318", "http://localhost:4318", "null", CODEX_DESKTOP_CORS_ORIGIN] as const;

export class OutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;
  constructor(private readonly storage: Storage, private readonly coordinator: EventCoordinator) {}
  async processOnce(): Promise<number> {
    if (this.running) return this.running;
    const run = this.runOnce();
    let shared: Promise<number>;
    shared = run.finally(() => {
      if (this.running === shared) this.running = undefined;
    });
    this.running = shared;
    return shared;
  }
  private async runOnce(): Promise<number> {
    const batch = this.storage.claimPendingBatches(1)[0];
    if (!batch) return 0;
    const claimToken = batch.claimToken!;
    let claimLost = false;
    const heartbeat = setInterval(() => {
      if (claimLost) return;
      try {
        if (!this.storage.renewBatchLease(batch.id, claimToken)) claimLost = true;
      } catch {
        claimLost = true;
      }
    }, Math.max(1, Math.floor(this.storage.getLeaseMs() / 3)));
    const assertClaim = (): void => { if (claimLost) throw new Error("Outbox batch claim lost"); };
    try {
      await this.coordinator.syncBatch(batch, claimToken, assertClaim);
    } catch (error) {
      this.storage.setBatchStatus(batch.id, "failed", error instanceof Error ? error.message : String(error), claimToken);
    } finally {
      clearInterval(heartbeat);
    }
    return 1;
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.processOnce().catch(() => undefined); }, 5000);
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}

function jsonError(error: unknown): { error: string } { return { error: error instanceof Error ? error.message : String(error) }; }
const inlineStatuses = ["captured", "planned", "in_progress", "done"] as const;
type InlineStatus = (typeof inlineStatuses)[number];
function isInlineStatus(value: unknown): value is InlineStatus { return typeof value === "string" && inlineStatuses.includes(value as InlineStatus); }
export function countProjectItems(items: PlaneItem[]) {
  const byStatus = { captured: 0, planned: 0, in_progress: 0, done: 0 };
  for (const item of items) if (!item.archived && isInlineStatus(item.status)) byStatus[item.status] += 1;
  return { total: Object.values(byStatus).reduce((total, count) => total + count, 0), byStatus };
}

export interface ServiceOptions {
  storage?: Storage;
  plane?: PlaneAdapter;
  sessionToken?: string;
  corsOrigins?: readonly (string | RegExp)[];
}

export interface ServiceStartOptions extends ServiceOptions {
  host?: string;
  port?: number;
}

export type RunningService = ReturnType<typeof createService> & {
  host: string;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
};

export function createService(args: ServiceOptions = {}) {
  const plane = args.plane ?? createPlaneAdapter();
  const storage = args.storage ?? new Storage();
  const coordinator = new EventCoordinator(storage, plane);
  const worker = new OutboxWorker(storage, coordinator);
  const sessionToken = createSessionToken(args.sessionToken ?? process.env.AMBIENT_SESSION_TOKEN);
  const app = Fastify({ logger: false });
  void app.register(cors, {
    origin: [...(args.corsOrigins ?? DEFAULT_CORS_ORIGINS)],
    credentials: false,
    allowedHeaders: ["Content-Type", "X-Ambient-Session-Token"],
  });
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (!matchesSessionToken(request.headers[SESSION_TOKEN_HEADER], sessionToken)) return reply.code(401).send({ error: "Unauthorized" });
  });

  const getContext = (id: string): ProjectContext => { const context = storage.getContext(id); if (!context) throw new Error("Project context not found"); return context; };
  const contextForItem = (itemId: string): ProjectContext => { const cached = storage.getCachedItem(itemId); if (!cached) throw new Error("Project item not found"); return getContext(cached.contextId); };

  app.get("/health", async () => ({ ok: true }));
  app.get<{ Querystring: { cwd?: string } }>("/api/context", async (request, reply) => { try { return storage.getContextByCwd(request.query.cwd ?? process.cwd()); } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.get<{ Params: { id: string } }>("/api/projects/:id/summary", async (request, reply) => {
    try {
      const context = getContext(request.params.id);
      let projectCounts: ReturnType<typeof countProjectItems> | null = null;
      try { projectCounts = countProjectItems(await coordinator.refreshCache(context)); } catch { /* Cached items remain inspectable, but are not presented as authoritative project totals. */ }
      return { context, items: storage.listAllCachedItems(context.id), projectCounts, sources: storage.listSources(context.id).slice(0, 100), failures: storage.listFailedBatches(context.id), audits: storage.listAudits().slice(0, 50) };
    } catch (error) { return reply.code(404).send(jsonError(error)); }
  });
  app.get<{ Params: { id: string }; Querystring: { kind?: RecordKind; status?: LifecycleState } }>("/api/projects/:id/items", async (request, reply) => {
    try { const context = getContext(request.params.id); let items = storage.listAllCachedItems(context.id); if (request.query.kind) items = items.filter((item) => item.kind === request.query.kind); if (request.query.status) items = items.filter((item) => item.status === request.query.status); return items; } catch (error) { return reply.code(404).send(jsonError(error)); }
  });
  app.get<{ Params: { id: string } }>("/api/projects/:id/failures", async (request, reply) => { try { return storage.listFailedBatches(getContext(request.params.id).id); } catch (error) { return reply.code(404).send(jsonError(error)); } });
  app.post<{ Params: { id: string; batchId: string } }>("/api/projects/:id/retry/:batchId", async (request, reply) => { try { getContext(request.params.id); storage.retryBatch(request.params.batchId, request.params.id); return { ok: true }; } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>("/api/projects/:id/auto-capture", async (request, reply) => { try { return storage.setAutoCapture(request.params.id, request.body.enabled); } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.patch<{ Params: { itemId: string }; Body: UpdateItemInput }>("/api/items/:itemId", async (request, reply) => { try { return await coordinator.editItem(contextForItem(request.params.itemId), request.params.itemId, request.body); } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.patch<{ Params: { itemId: string }; Body: { status?: unknown } }>("/api/items/:itemId/status", async (request, reply) => {
    if (!isInlineStatus(request.body?.status)) return reply.code(400).send({ error: "Panel status must be captured, planned, in_progress, or done" });
    try { return await coordinator.changeStatus(contextForItem(request.params.itemId), request.params.itemId, request.body.status); } catch (error) { return reply.code(400).send(jsonError(error)); }
  });
  app.post<{ Params: { itemId: string; targetId: string } }>("/api/items/:itemId/merge/:targetId", async (request, reply) => { try { await coordinator.mergeItems(contextForItem(request.params.itemId), request.params.itemId, request.params.targetId); return { ok: true }; } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.post<{ Params: { itemId: string } }>("/api/items/:itemId/archive", async (request, reply) => { try { await coordinator.archiveItem(contextForItem(request.params.itemId), request.params.itemId); return { ok: true }; } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.delete<{ Params: { itemId: string } }>("/api/items/:itemId", async (request, reply) => { try { await coordinator.deleteItem(contextForItem(request.params.itemId), request.params.itemId); return { ok: true }; } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.post("/api/worker/run", async () => ({ processed: await worker.processOnce() }));
  app.addHook("onClose", async () => { await worker.stop(); storage.close(); });
  return { app, storage, plane, coordinator, worker, sessionToken };
}

export async function startService(args: ServiceStartOptions = {}): Promise<RunningService> {
  const service = createService(args);
  const host = args.host ?? "127.0.0.1";
  const port = args.port ?? Number(process.env.SERVICE_PORT ?? 4317);
  let closePromise: Promise<void> | undefined;
  try {
    await service.app.listen({ port, host });
    const address = service.app.server.address();
    if (!address || typeof address === "string") throw new Error("Local service did not expose a TCP address");
    service.worker.start();
    const running: RunningService = {
      ...service,
      host,
      port: address.port,
      baseUrl: `http://${host}:${address.port}`,
      close: () => {
        closePromise ??= service.app.close();
        return closePromise;
      },
    };
    return running;
  } catch (error) {
    await service.app.close();
    throw error;
  }
}
