import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ProjectBindingConflictError, Storage } from "./index.js";
import { isWorkspacePathAncestor, resolveWorkspaceIdentity } from "./workspace-identity.js";

const event = { type: "bug" as const, title: "白屏", summary: "登录偶尔白屏", userDirected: true, sourceExcerpt: "记录这个 Bug" };

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
}

describe("SQLite storage", () => {
  it("keeps path semantics explicit and compares path segments rather than string prefixes", () => {
    expect(() => resolveWorkspaceIdentity("relative/project")).toThrow(/absolute path/);
    expect(isWorkspacePathAncestor("/", "/work/demo")).toBe(true);
    expect(isWorkspacePathAncestor("/work/a", "/work/ab/file")).toBe(false);
    expect(isWorkspacePathAncestor("C:/Work", "c:/work/demo")).toBe(true);
  });

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

  it("idempotently reuses a same-target bind without changing the existing project row", () => {
    const storage = new Storage(":memory:");
    const first = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", planeProjectName: "Original", autoCaptureEnabled: true });
    const second = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", planeProjectName: "Should not replace", autoCaptureEnabled: false });
    expect(second).toEqual(first);
    expect((storage.db.prepare("SELECT COUNT(*) AS count FROM project_contexts").get() as { count: number }).count).toBe(1);
    expect(storage.getContext(first.id)).toEqual(first);
    storage.close();
  });

  it("keeps non-Git refusal scope explicit across root, child, and sibling identities", () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-binding-preference-"));
    const root = join(directory, "work");
    const child = join(root, "child");
    const sibling = join(root, "sibling");
    const database = join(directory, "preferences.sqlite");
    mkdirSync(child, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    const first = new Storage(database);
    try {
      const declined = first.declineBinding(root);
      expect(declined.preference).toBe("declined");
      expect(first.getContextByCwd(root)).toBeNull();
      expect(first.getBindingPreference(child)?.workspaceIdentity).toBe(declined.workspaceIdentity);
      expect(first.getBindingPreference(sibling)?.workspaceIdentity).toBe(declined.workspaceIdentity);
      expect(first.declineBinding(child).workspaceIdentity).toBe(declined.workspaceIdentity);
      expect((first.db.prepare("SELECT COUNT(*) AS count FROM workspace_binding_preferences").get() as { count: number }).count).toBe(1);
      expect((first.db.prepare("SELECT COUNT(*) AS count FROM project_contexts").get() as { count: number }).count).toBe(0);
    } finally {
      first.close();
    }

    const reopened = new Storage(database);
    try {
      const rootIdentity = resolveWorkspaceIdentity(root).value;
      const childIdentity = resolveWorkspaceIdentity(child).value;
      expect(reopened.getBindingPreference(child)?.workspaceIdentity).toBe(rootIdentity);
      expect(reopened.getBindingPreference(sibling)?.workspaceIdentity).toBe(rootIdentity);

      expect(reopened.restoreBinding(child)).toEqual({ restored: true, workspaceIdentity: childIdentity });
      expect(reopened.getBindingPreference(child)).toBeNull();
      expect(reopened.getBindingPreference(sibling)?.workspaceIdentity).toBe(rootIdentity);
      expect(reopened.restoreBinding(child)).toEqual({ restored: false, workspaceIdentity: childIdentity });

      const childDeclined = reopened.declineBinding(child);
      expect(childDeclined.workspaceIdentity).toBe(childIdentity);
      expect(reopened.getBindingPreference(child)?.workspaceIdentity).toBe(childIdentity);
      expect(reopened.restoreBinding(child)).toEqual({ restored: true, workspaceIdentity: childIdentity });
      expect(reopened.getBindingPreference(child)).toBeNull();
      expect(reopened.getBindingPreference(sibling)?.workspaceIdentity).toBe(rootIdentity);

      reopened.declineBinding(child);
      reopened.bindContext({ cwd: child, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "child" });
      expect(reopened.getBindingPreference(child)).toBeNull();
      expect(reopened.getBindingPreference(sibling)?.workspaceIdentity).toBe(rootIdentity);
      expect((reopened.db.prepare("SELECT preference FROM workspace_binding_preferences WHERE workspace_identity=?").get(childIdentity) as { preference: string }).preference).toBe("restored");

      reopened.bindContext({ cwd: root, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "root" });
      expect(reopened.getBindingPreference(root)).toBeNull();
      expect(reopened.getBindingPreference(sibling)).toBeNull();
      expect((reopened.db.prepare("SELECT COUNT(*) AS count FROM project_contexts").get() as { count: number }).count).toBe(2);
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reuses one Git common-dir identity across tasks, subdirectories, symlinks, and linked worktrees", () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-git-identity-"));
    const repo = join(directory, "repo");
    const linked = join(directory, "linked-worktree");
    const clone = join(directory, "independent-clone");
    const link = join(directory, "repo-link");
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "README.md"), "identity\n");
    try {
      git(repo, ["init"]);
      git(repo, ["config", "user.email", "ambient@example.test"]);
      git(repo, ["config", "user.name", "Ambient Tests"]);
      git(repo, ["add", "README.md"]);
      git(repo, ["commit", "-m", "initial"]);
      git(repo, ["worktree", "add", "--detach", linked, "HEAD"]);
      git(directory, ["clone", repo, clone]);
      symlinkSync(repo, link, process.platform === "win32" ? "junction" : "dir");

      const storage = new Storage(":memory:");
      const context = storage.bindContext({ cwd: repo, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
      expect(context.workspaceIdentity).toMatch(/^git:/);
      storage.declineBinding(repo);
      expect(storage.getBindingPreference(join(repo, "src"))?.workspaceIdentity).toBe(context.workspaceIdentity);
      expect(storage.getBindingPreference(linked)?.workspaceIdentity).toBe(context.workspaceIdentity);
      expect(storage.getBindingPreference(clone)).toBeNull();
      storage.bindContext({ cwd: repo, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
      expect(storage.getBindingPreference(repo)).toBeNull();
      expect(storage.getContextByCwd(join(repo, "src"))?.id).toBe(context.id);
      expect(storage.getContextByCwd(link)?.id).toBe(context.id);
      expect(storage.getContextByCwd(linked)?.id).toBe(context.id);
      expect(storage.getContextByCwd(clone)).toBeNull();
      const cloneContext = storage.bindContext({ cwd: clone, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "other" });
      expect(cloneContext.id).not.toBe(context.id);
      expect(cloneContext.workspaceIdentity).not.toBe(context.workspaceIdentity);
      expect(storage.enqueueBatch({ projectContextId: context.id, sessionId: "task-one", turnId: "turn-one", events: [event] }).batchId).toBe("batch_1");
      expect(storage.enqueueBatch({ projectContextId: context.id, sessionId: "task-two", turnId: "turn-one", events: [event] }).batchId).toBe("batch_2");
      storage.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("inherits non-Git bindings by the longest path segment and keeps adjacent prefixes separate", () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-path-identity-"));
    const root = join(directory, "work");
    const nested = join(root, "a");
    const nestedChild = join(nested, "child");
    const adjacent = join(root, "ab", "child");
    mkdirSync(nestedChild, { recursive: true });
    mkdirSync(adjacent, { recursive: true });
    const storage = new Storage(":memory:");
    try {
      const rootContext = storage.bindContext({ cwd: root, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "root" });
      const nestedContext = storage.bindContext({ cwd: nested, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "nested" });
      expect(rootContext.workspaceIdentity).toMatch(/^path:/);
      expect(storage.getContextByCwd(nestedChild)?.id).toBe(nestedContext.id);
      expect(storage.getContextByCwd(adjacent)?.id).toBe(rootContext.id);
      expect(storage.getContextByCwd(join(directory, "unbound"))).toBeNull();
    } finally {
      storage.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("changes an inherited non-Git child by updating the existing ancestor project context", () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-inherited-change-"));
    const root = join(directory, "root");
    const child = join(root, "child");
    const unbound = join(directory, "unbound");
    mkdirSync(child, { recursive: true });
    mkdirSync(unbound, { recursive: true });
    const storage = new Storage(":memory:");
    try {
      const rootContext = storage.bindContext({ cwd: root, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "root" });
      const before = (storage.db.prepare("SELECT COUNT(*) AS count FROM project_contexts").get() as { count: number }).count;
      const changed = storage.bindContext({ cwd: child, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "changed" }, true);
      const after = (storage.db.prepare("SELECT COUNT(*) AS count FROM project_contexts").get() as { count: number }).count;
      expect(changed.id).toBe(rootContext.id);
      expect(changed.canonicalCwd).toBe(rootContext.canonicalCwd);
      expect(after).toBe(before);
      expect(storage.getContextByCwd(child)?.id).toBe(rootContext.id);
      expect(storage.getContextByCwd(child)?.planeProjectId).toBe("changed");
      expect(() => storage.bindContext({ cwd: unbound, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "changed" }, true)).toThrow(/No project binding exists/);
    } finally {
      storage.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not silently rebind, preserves the project row on change, and exposes same-identity conflicts", () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-binding-conflict-"));
    const root = join(directory, "root");
    const duplicatePath = join(directory, "duplicate");
    mkdirSync(root, { recursive: true });
    mkdirSync(duplicatePath, { recursive: true });
    const storage = new Storage(":memory:");
    try {
      const context = storage.bindContext({ cwd: root, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "first" });
      expect(() => storage.bindContext({ cwd: root, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "second" })).toThrow(/Conflicting Plane project binding/);
      expect(storage.bindContext({ cwd: root, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "second" }, true)).toMatchObject({ id: context.id, planeProjectId: "second" });
      const identity = storage.getContext(context.id)?.workspaceIdentity;
      storage.db.prepare(`INSERT INTO project_contexts (canonical_cwd, workspace_identity, plane_base_url, workspace_slug, plane_project_id, auto_capture_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'now', 'now')`)
        .run(duplicatePath, identity, "https://plane.test", "ws", "third");
      expect(() => storage.getContextByCwd(root)).toThrow(ProjectBindingConflictError);
    } finally {
      storage.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps no-event reviews idempotent without masking a recorded turn", () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });

    expect(storage.acknowledgeNoProjectEvents({ projectContextId: context.id, sessionId: "s", turnId: "t" })).toEqual({ status: "acknowledged", duplicate: false });
    expect(storage.acknowledgeNoProjectEvents({ projectContextId: context.id, sessionId: "s", turnId: "t" })).toEqual({ status: "acknowledged", duplicate: true });
    expect(storage.didAcknowledgeNoProjectEvents(context.id, "s", "t")).toBe(true);

    expect(storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [event] })).toEqual({ batchId: "batch_1", duplicate: false });
    expect(storage.didRecordProjectEvents(context.id, "s", "t")).toBe(true);
    expect(storage.didAcknowledgeNoProjectEvents(context.id, "s", "t")).toBe(false);
    expect(storage.acknowledgeNoProjectEvents({ projectContextId: context.id, sessionId: "s", turnId: "t" })).toEqual({ status: "already_recorded", duplicate: false });

    expect(storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t2", events: [event] })).toEqual({ batchId: "batch_2", duplicate: false });
    expect(storage.acknowledgeNoProjectEvents({ projectContextId: context.id, sessionId: "s", turnId: "t2" })).toEqual({ status: "already_recorded", duplicate: false });
    expect(storage.didAcknowledgeNoProjectEvents(context.id, "s", "t2")).toBe(false);
    expect(storage.listPendingBatches()).toHaveLength(2);
    expect((storage.db.prepare("SELECT * FROM no_project_event_reviews").all() as unknown[])).toHaveLength(0);
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

  it("round-trips cached parent relationships for Hook context", () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    storage.cacheItem(context.id, { id: "parent", identifier: "P-1", title: "Parent", kind: "task", status: "planned" }, true);
    storage.cacheItem(context.id, { id: "child", identifier: "P-2", title: "Child", parentId: "parent", kind: "task", status: "planned" }, true);
    expect(storage.getCachedItem("child")?.parentId).toBe("parent");
    expect(storage.listCachedItems(context.id).find((item) => item.id === "child")?.parentId).toBe("parent");
    storage.close();
  });

  it("persists a per-session active-item snapshot, clears it by session, and recovers only root prompt turns", () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    const secondContext = storage.bindContext({ cwd: "/other", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "other" });
    const snapshot = [{ itemId: "item-1", identifier: "P-1", title: "Parent", status: "planned", updatedAt: "2026-08-20T00:00:00.000Z" }];
    expect(storage.getSessionActiveItemSnapshot(context.id, "session-1")).toBeNull();
    storage.saveSessionActiveItemSnapshot(context.id, "session-1", snapshot);
    storage.saveSessionActiveItemSnapshot(secondContext.id, "session-1", snapshot);
    expect(storage.getSessionActiveItemSnapshot(context.id, "session-1")).toEqual(snapshot);
    storage.auditHook({ eventName: "UserPromptSubmit", sessionId: "session-1", turnId: "turn-1" });
    storage.auditHook({ eventName: "PostToolUse", sessionId: "session-1", turnId: "turn-2" });
    storage.auditHook({ eventName: "Stop", sessionId: "session-1", turnId: "turn-3", ended: true });
    expect(storage.getLatestTurnId("session-1")).toBe("turn-1");
    storage.clearSessionActiveItemSnapshots("session-1");
    expect(storage.getSessionActiveItemSnapshot(context.id, "session-1")).toBeNull();
    expect(storage.getSessionActiveItemSnapshot(secondContext.id, "session-1")).toBeNull();
    storage.close();
  });

  it("atomically claims a batch and rejects stale lease completion", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-outbox-"));
    const filename = join(directory, "outbox.sqlite");
    const first = new Storage(filename, { leaseMs: 1_000 });
    const context = first.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    first.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [event] });
    first.addSourceReference({ batchId: "batch_1", eventId: "event_1_0", remoteSourceId: "project_1:s:t:0", planeItemId: null, sessionId: "s", turnId: "t", eventType: event.type, summary: event.summary, sourceExcerpt: event.sourceExcerpt, observedAt: "now" });
    const second = new Storage(filename, { leaseMs: 1_000 });
    const firstClaim = first.claimPendingBatches()[0]!;
    expect(second.claimPendingBatches()).toHaveLength(0);
    first.db.prepare("UPDATE outbox_batches SET lease_until='1970-01-01T00:00:00.000Z' WHERE id=1").run();
    const secondClaim = second.claimPendingBatches(1, 1_000)[0]!;
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);
    expect(first.renewBatchLease(secondClaim.id, firstClaim.claimToken!)).toBe(false);
    expect(() => first.markEventCompleted("event_1_0", "stale-item", firstClaim.claimToken)).toThrow("claim lost");
    expect(first.markEventFailed("event_1_0", "stale", firstClaim.claimToken)).toBe(false);
    expect(second.getSourceReference("event_1_0")?.projectionStatus).toBe("pending");
    expect(second.setBatchStatus(secondClaim.id, "synced", undefined, firstClaim.claimToken)).toBe(false);
    expect(second.setBatchStatus(secondClaim.id, "failed", "stale", firstClaim.claimToken)).toBe(false);
    expect(second.renewBatchLease(secondClaim.id, secondClaim.claimToken!, 1_000)).toBe(true);
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
      CREATE TABLE turn_audits (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, turn_id TEXT, hook_event_name TEXT NOT NULL, record_tool_called INTEGER NOT NULL DEFAULT 0, hook_error TEXT, started_at TEXT NOT NULL, ended_at TEXT, UNIQUE(session_id, turn_id, hook_event_name));
      INSERT INTO project_contexts (canonical_cwd, plane_base_url, workspace_slug, plane_project_id, created_at, updated_at) VALUES ('/work', 'https://plane.test', 'ws', 'p', 'now', 'now');
      INSERT INTO outbox_batches (project_context_id, session_id, turn_id, events_json, accepted_at) VALUES ('project_1', 's', 't', '${JSON.stringify([event]).replace(/'/g, "''")}', 'now');
      INSERT INTO source_references (batch_id, event_id, session_id, turn_id, event_type, summary, source_excerpt, observed_at, created_at) VALUES ('batch_1', 'event_1_0', 's', 't', 'bug', '旧摘要', '旧摘录', 'now', 'now');
    `);
    old.close();
    const storage = new Storage(filename);
    expect(storage.listPendingBatches()[0]?.id).toBe("batch_1");
    expect(storage.listSources("project_1")[0]?.summary).toBe("旧摘要");
    expect(storage.getContext("project_1")?.workspaceIdentity).toBe("path:/work");
    expect((storage.db.prepare("PRAGMA table_info(outbox_batches)").all() as Array<{ name: string }>).map((row) => row.name)).toEqual(expect.arrayContaining(["claim_token", "lease_until", "claim_version"]));
    expect((storage.db.prepare("PRAGMA table_info(source_references)").all() as Array<{ name: string }>).map((row) => row.name)).toEqual(expect.arrayContaining(["projection_status", "projection_attempts", "projection_error", "projected_at", "remote_source_id"]));
    expect((storage.db.prepare("PRAGMA table_info(turn_audits)").all() as Array<{ name: string }>).map((row) => row.name)).toEqual(expect.arrayContaining(["binding_list_tool_called", "binding_candidates_json", "binding_candidates_valid", "binding_source_invalid", "capture_decision_recorded", "binding_prompt_delivered"]));
    storage.close();
    const reopened = new Storage(filename);
    expect(reopened.getContextByCwd("/work")?.id).toBe("project_1");
    expect(reopened.listPendingBatches()[0]?.id).toBe("batch_1");
    reopened.close(); rmSync(directory, { recursive: true, force: true });
  });

  it("migrates Git worktree history into one binding unit and changes every historical row", () => {
    const directory = mkdtempSync(join(tmpdir(), "ambient-git-history-migration-"));
    const repo = join(directory, "repo");
    const linked = join(directory, "linked-worktree");
    const filename = join(directory, "history.sqlite");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "README.md"), "history\n");
    const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
    try {
      git(repo, ["init"]);
      git(repo, ["config", "user.email", "ambient@example.test"]);
      git(repo, ["config", "user.name", "Ambient Tests"]);
      git(repo, ["add", "README.md"]);
      git(repo, ["commit", "-m", "initial"]);
      execFileSync("git", ["worktree", "add", "--detach", linked, "HEAD"], { cwd: repo, stdio: "ignore", env: gitEnvironment });

      const old = new DatabaseSync(filename);
      old.exec(`
        CREATE TABLE project_contexts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          canonical_cwd TEXT NOT NULL UNIQUE,
          plane_base_url TEXT NOT NULL,
          workspace_slug TEXT NOT NULL,
          plane_project_id TEXT NOT NULL,
          plane_project_name TEXT,
          auto_capture_enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE outbox_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_context_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          events_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          accepted_at TEXT NOT NULL,
          UNIQUE(project_context_id, session_id, turn_id)
        );
        CREATE TABLE source_references (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id TEXT NOT NULL,
          event_id TEXT NOT NULL UNIQUE,
          plane_item_id TEXT,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          source_excerpt TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      const insertContext = old.prepare(`INSERT INTO project_contexts (canonical_cwd, plane_base_url, workspace_slug, plane_project_id, plane_project_name, auto_capture_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      insertContext.run(repo, "https://plane.test", "ws", "old", "Root history", 1, "created-1", "updated-1");
      insertContext.run(linked, "https://plane.test", "ws", "old", "Linked history", 1, "created-2", "updated-2");
      old.prepare(`INSERT INTO outbox_batches (project_context_id, session_id, turn_id, events_json, accepted_at) VALUES (?, ?, ?, ?, ?)`)
        .run("project_1", "session-1", "turn-1", "[]", "accepted-1");
      old.prepare(`INSERT INTO outbox_batches (project_context_id, session_id, turn_id, events_json, accepted_at) VALUES (?, ?, ?, ?, ?)`)
        .run("project_2", "session-2", "turn-2", "[]", "accepted-2");
      old.prepare(`INSERT INTO source_references (batch_id, event_id, session_id, turn_id, event_type, summary, source_excerpt, observed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("batch_1", "event_1_0", "session-1", "turn-1", "bug", "root", "root", "observed-1", "source-1");
      old.prepare(`INSERT INTO source_references (batch_id, event_id, session_id, turn_id, event_type, summary, source_excerpt, observed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("batch_2", "event_2_0", "session-2", "turn-2", "bug", "linked", "linked", "observed-2", "source-2");
      old.close();

      const storage = new Storage(filename);
      try {
        const migrated = storage.db.prepare("SELECT id, canonical_cwd, workspace_identity, created_at, updated_at, plane_project_id, plane_project_name, auto_capture_enabled FROM project_contexts ORDER BY id").all() as Array<Record<string, unknown>>;
        expect(migrated).toHaveLength(2);
        expect(migrated[0]?.id).toBe(1);
        expect(migrated[1]?.id).toBe(2);
        expect(migrated[0]?.workspace_identity).toMatch(/^git:/);
        expect(migrated[0]?.workspace_identity).toBe(migrated[1]?.workspace_identity);
        expect(storage.getContextByCwd(linked)?.id).toBe("project_1");

        const beforeIdempotentBind = storage.db.prepare("SELECT id, canonical_cwd, created_at, updated_at, plane_project_id, plane_project_name, auto_capture_enabled FROM project_contexts ORDER BY id").all();
        const reused = storage.bindContext({ cwd: linked, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "old", planeProjectName: "Must not replace", autoCaptureEnabled: false });
        expect(reused.id).toBe("project_1");
        expect(reused.planeProjectName).toBe("Root history");
        expect(reused.autoCaptureEnabled).toBe(true);
        expect(storage.db.prepare("SELECT id, canonical_cwd, created_at, updated_at, plane_project_id, plane_project_name, auto_capture_enabled FROM project_contexts ORDER BY id").all()).toEqual(beforeIdempotentBind);

        storage.db.prepare("UPDATE project_contexts SET plane_project_id='conflicting' WHERE id=2").run();
        expect(() => storage.getContextByCwd(repo)).toThrow(ProjectBindingConflictError);
        expect(() => storage.bindContext({ cwd: repo, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "old" })).toThrow(ProjectBindingConflictError);

        const historyBeforeChange = storage.db.prepare("SELECT id, canonical_cwd, created_at FROM project_contexts ORDER BY id").all();
        const changed = storage.bindContext({ cwd: linked, planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "new", planeProjectName: "Unified history", autoCaptureEnabled: false }, true);
        expect(changed.id).toBe("project_1");
        expect(storage.db.prepare("SELECT id, canonical_cwd, created_at FROM project_contexts ORDER BY id").all()).toEqual(historyBeforeChange);
        expect(storage.db.prepare("SELECT id, plane_base_url, workspace_slug, plane_project_id, plane_project_name, auto_capture_enabled FROM project_contexts ORDER BY id").all()).toEqual([
          { id: 1, plane_base_url: "https://plane.test", workspace_slug: "ws", plane_project_id: "new", plane_project_name: "Unified history", auto_capture_enabled: 0 },
          { id: 2, plane_base_url: "https://plane.test", workspace_slug: "ws", plane_project_id: "new", plane_project_name: "Unified history", auto_capture_enabled: 0 },
        ]);
        expect(storage.getContextByCwd(repo)?.id).toBe("project_1");
        expect(storage.getContextByCwd(linked)?.id).toBe("project_1");
        expect(storage.listPendingBatches().map((batch) => batch.projectContextId)).toEqual(["project_1", "project_2"]);
        expect(storage.db.prepare("SELECT batch_id, event_id FROM source_references ORDER BY id").all()).toEqual([
          { batch_id: "batch_1", event_id: "event_1_0" },
          { batch_id: "batch_2", event_id: "event_2_0" },
        ]);
      } finally {
        storage.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
