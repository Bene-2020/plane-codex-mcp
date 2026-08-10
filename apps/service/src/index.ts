import Fastify from "fastify";
import cors from "@fastify/cors";
import { ProjectContext, RecordKind, LifecycleState } from "@ambient/core";
import { createPlaneAdapter, EventCoordinator, PlaneAdapter, UpdateItemInput } from "@ambient/plane";
import { Storage } from "@ambient/storage";

export class OutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly storage: Storage, private readonly coordinator: EventCoordinator) {}
  async processOnce(): Promise<number> {
    const batches = this.storage.listPendingBatches();
    for (const batch of batches) {
      try { await this.coordinator.syncBatch(batch); }
      catch (error) { this.storage.setBatchStatus(batch.id, "failed", error instanceof Error ? error.message : String(error)); }
    }
    return batches.length;
  }
  start(): void { this.timer = setInterval(() => { void this.processOnce(); }, 5000); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
}

function jsonError(error: unknown): { error: string } { return { error: error instanceof Error ? error.message : String(error) }; }

export function createService(args: { storage?: Storage; plane?: PlaneAdapter } = {}) {
  const storage = args.storage ?? new Storage();
  const plane = args.plane ?? createPlaneAdapter();
  const coordinator = new EventCoordinator(storage, plane);
  const worker = new OutboxWorker(storage, coordinator);
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });

  const getContext = (id: string): ProjectContext => { const context = storage.getContext(id); if (!context) throw new Error("Project context not found"); return context; };
  const contextForItem = (itemId: string): ProjectContext => { const cached = storage.getCachedItem(itemId); if (!cached) throw new Error("Project item not found"); return getContext(cached.contextId); };

  app.get("/health", async () => ({ ok: true, service: "ambient-project", capture: "non-blocking" }));
  app.get<{ Querystring: { cwd?: string } }>("/api/context", async (request, reply) => { try { return storage.getContextByCwd(request.query.cwd ?? process.cwd()); } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.get<{ Params: { id: string } }>("/api/projects/:id/summary", async (request, reply) => {
    try {
      const context = getContext(request.params.id);
      try { await coordinator.refreshCache(context); } catch { /* Plane is optional on the read path; cached state remains inspectable. */ }
      return { context, items: storage.listAllCachedItems(context.id), sources: storage.listSources(context.id).slice(0, 100), failures: storage.listFailedBatches(context.id), audits: storage.listAudits().slice(0, 50) };
    } catch (error) { return reply.code(404).send(jsonError(error)); }
  });
  app.get<{ Params: { id: string }; Querystring: { kind?: RecordKind; status?: LifecycleState } }>("/api/projects/:id/items", async (request, reply) => {
    try { const context = getContext(request.params.id); let items = storage.listAllCachedItems(context.id); if (request.query.kind) items = items.filter((item) => item.kind === request.query.kind); if (request.query.status) items = items.filter((item) => item.status === request.query.status); return items; } catch (error) { return reply.code(404).send(jsonError(error)); }
  });
  app.get<{ Params: { id: string } }>("/api/projects/:id/failures", async (request, reply) => { try { return storage.listFailedBatches(getContext(request.params.id).id); } catch (error) { return reply.code(404).send(jsonError(error)); } });
  app.post<{ Params: { id: string; batchId: string } }>("/api/projects/:id/retry/:batchId", async (request, reply) => { try { getContext(request.params.id); storage.retryBatch(request.params.batchId); return { ok: true }; } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>("/api/projects/:id/auto-capture", async (request, reply) => { try { return storage.setAutoCapture(request.params.id, request.body.enabled); } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.patch<{ Params: { itemId: string }; Body: UpdateItemInput }>("/api/items/:itemId", async (request, reply) => { try { return await coordinator.editItem(contextForItem(request.params.itemId), request.params.itemId, request.body); } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.post<{ Params: { itemId: string; targetId: string } }>("/api/items/:itemId/merge/:targetId", async (request, reply) => { try { await coordinator.mergeItems(contextForItem(request.params.itemId), request.params.itemId, request.params.targetId); return { ok: true }; } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.post<{ Params: { itemId: string } }>("/api/items/:itemId/archive", async (request, reply) => { try { await coordinator.archiveItem(contextForItem(request.params.itemId), request.params.itemId); return { ok: true }; } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.delete<{ Params: { itemId: string } }>("/api/items/:itemId", async (request, reply) => { try { await coordinator.deleteItem(contextForItem(request.params.itemId), request.params.itemId); return { ok: true }; } catch (error) { return reply.code(400).send(jsonError(error)); } });
  app.post("/api/worker/run", async () => ({ processed: await worker.processOnce() }));
  app.addHook("onClose", async () => { worker.stop(); storage.close(); });
  return { app, storage, plane, coordinator, worker };
}

async function main(): Promise<void> {
  const { app, worker } = createService();
  const port = Number(process.env.SERVICE_PORT ?? 4317);
  await app.listen({ port, host: "127.0.0.1" });
  worker.start();
  process.stderr.write(`Ambient project service listening on http://127.0.0.1:${port}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
