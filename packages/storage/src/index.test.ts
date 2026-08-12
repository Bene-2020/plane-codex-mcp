import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Storage } from "./index.js";

const event = { type: "bug" as const, title: "白屏", summary: "登录偶尔白屏", userDirected: true, sourceExcerpt: "记录这个 Bug" };

describe("SQLite storage", () => {
  it("persists a cwd binding and rejects duplicate work-turn batches", () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work/demo/", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    expect(context.id).toBe("project_1");
    const first = storage.enqueueBatch({ projectContextId: context.id, sessionId: "session_1", turnId: "turn_1", events: [event] });
    const duplicate = storage.enqueueBatch({ projectContextId: context.id, sessionId: "session_1", turnId: "turn_1", events: [event] });
    expect(first).toEqual({ batchId: "batch_1", duplicate: false });
    expect(duplicate).toEqual({ batchId: "batch_1", duplicate: true });
    expect(storage.listPendingBatches()).toHaveLength(1);
    storage.close();
  });

  it("keeps only a field ownership marker, not a project-record replica", () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    storage.cacheItem(context.id, { id: "item-1", identifier: "P-1", title: "System title", kind: "task", status: "captured" }, true);
    storage.setFieldOwnership("item-1", "title", "system", "System title");
    storage.setUserFields("item-1", { title: "User title" });
    expect(storage.getFieldOwnership("item-1", "title")?.owner).toBe("user");
    expect(storage.listAllCachedItems(context.id)).toHaveLength(1);
    storage.close();
  });

  it("atomically claims a batch and rejects stale lease completion", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-outbox-"));
    const filename = join(directory, "outbox.sqlite");
    const first = new Storage(filename, { leaseMs: 5 });
    const context = first.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    first.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [event] });
    first.addSourceReference({ batchId: "batch_1", eventId: "event_1_0", planeItemId: null, sessionId: "s", turnId: "t", eventType: event.type, summary: event.summary, sourceExcerpt: event.sourceExcerpt, observedAt: "now" });
    const second = new Storage(filename, { leaseMs: 5 });
    const firstClaim = first.claimPendingBatches()[0]!;
    expect(second.claimPendingBatches()).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const secondClaim = second.claimPendingBatches()[0]!;
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);
    expect(first.renewBatchLease(secondClaim.id, firstClaim.claimToken!)).toBe(false);
    expect(() => first.markEventCompleted("event_1_0", "stale-item", firstClaim.claimToken)).toThrow("claim lost");
    expect(first.markEventFailed("event_1_0", "stale", firstClaim.claimToken)).toBe(false);
    expect(second.getSourceReference("event_1_0")?.projectionStatus).toBe("pending");
    expect(second.setBatchStatus(secondClaim.id, "synced", undefined, firstClaim.claimToken)).toBe(false);
    expect(second.setBatchStatus(secondClaim.id, "failed", "stale", firstClaim.claimToken)).toBe(false);
    expect(second.renewBatchLease(secondClaim.id, secondClaim.claimToken!)).toBe(true);
    second.markEventCompleted("event_1_0", "new-item", secondClaim.claimToken);
    expect(second.setBatchStatus(secondClaim.id, "synced", undefined, secondClaim.claimToken)).toBe(true);
    expect(second.listPendingBatches()).toHaveLength(0);
    first.close(); second.close(); rmSync(directory, { recursive: true, force: true });
  });

  it("migrates an old outbox schema without losing batch or source data", () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-migration-"));
    const filename = join(directory, "outbox.sqlite");
    const old = new DatabaseSync(filename);
    old.exec(`
      CREATE TABLE project_contexts (id INTEGER PRIMARY KEY AUTOINCREMENT, canonical_cwd TEXT NOT NULL UNIQUE, plane_base_url TEXT NOT NULL, workspace_slug TEXT NOT NULL, plane_project_id TEXT NOT NULL, plane_project_name TEXT, auto_capture_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE outbox_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, project_context_id TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, events_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, accepted_at TEXT NOT NULL, UNIQUE(project_context_id, session_id, turn_id));
      CREATE TABLE source_references (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE, plane_item_id TEXT, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, event_type TEXT NOT NULL, summary TEXT NOT NULL, source_excerpt TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO project_contexts (canonical_cwd, plane_base_url, workspace_slug, plane_project_id, created_at, updated_at) VALUES ('/work', 'https://plane.test', 'ws', 'p', 'now', 'now');
      INSERT INTO outbox_batches (project_context_id, session_id, turn_id, events_json, accepted_at) VALUES ('project_1', 's', 't', '${JSON.stringify([event]).replace(/'/g, "''")}', 'now');
      INSERT INTO source_references (batch_id, event_id, session_id, turn_id, event_type, summary, source_excerpt, observed_at, created_at) VALUES ('batch_1', 'event_1_0', 's', 't', 'bug', '旧摘要', '旧摘录', 'now', 'now');
    `);
    old.close();
    const storage = new Storage(filename);
    expect(storage.listPendingBatches()[0]?.id).toBe("batch_1");
    expect(storage.listSources("project_1")[0]?.summary).toBe("旧摘要");
    expect((storage.db.prepare("PRAGMA table_info(outbox_batches)").all() as Array<{ name: string }>).map((row) => row.name)).toEqual(expect.arrayContaining(["claim_token", "lease_until", "claim_version"]));
    expect((storage.db.prepare("PRAGMA table_info(source_references)").all() as Array<{ name: string }>).map((row) => row.name)).toEqual(expect.arrayContaining(["projection_status", "projection_attempts", "projection_error", "projected_at"]));
    storage.close(); rmSync(directory, { recursive: true, force: true });
  });
});
