import {
  ActiveItemSnapshot, BatchRecord, FieldName, FieldOwner, FieldOwnership, PlaneItem, ProjectContext,
  ProjectContextInput, ProjectionStatus, SourceEvent, SourceReference, SyncStatus, batchId, canonicalizeCwd, eventId,
} from "@ambient/core";
import { SqliteDatabase } from "./database.js";

interface ContextRow {
  id: number; canonical_cwd: string; plane_base_url: string; workspace_slug: string; plane_project_id: string;
  plane_project_name: string | null; auto_capture_enabled: number; created_at: string; updated_at: string;
}
interface BatchRow {
  id: number;
  project_context_id: string;
  session_id: string;
  turn_id: string;
  events_json: string;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  synced_at: string | null;
  claim_version: number;
  claim_token: string | null;
  lease_until: string | null;
}
interface CacheRow { plane_item_id: string; identifier: string; title: string; description: string | null; kind: string | null; status: string | null; due_date: string | null; project_context_id: string; url: string | null; is_system_created: number; updated_at: string; archived: number; }
interface SourceRow {
  id: number;
  batch_id: string;
  event_id: string;
  plane_item_id: string | null;
  session_id: string;
  turn_id: string;
  event_type: SourceReference["eventType"];
  summary: string;
  source_excerpt: string;
  observed_at: string;
  created_at: string;
  projection_status: ProjectionStatus;
  projection_attempts: number;
  projection_error: string | null;
  projected_at: string | null;
}

export interface StorageOptions { leaseMs?: number; }

function now(): string { return new Date().toISOString(); }

export class Storage {
  readonly db: SqliteDatabase;
  private readonly leaseMs: number;

  constructor(filename = process.env.AMBIENT_DB_PATH ?? "./ambient-project-demo.sqlite", options: StorageOptions = {}) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.db = new SqliteDatabase(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS project_contexts (
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
      CREATE TABLE IF NOT EXISTS outbox_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_context_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        events_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT,
        accepted_at TEXT NOT NULL,
        synced_at TEXT,
        claim_version INTEGER NOT NULL DEFAULT 0,
        claim_token TEXT,
        lease_until TEXT,
        UNIQUE(project_context_id, session_id, turn_id)
      );
      CREATE TABLE IF NOT EXISTS source_references (
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
        created_at TEXT NOT NULL,
        projection_status TEXT NOT NULL DEFAULT 'pending',
        projection_attempts INTEGER NOT NULL DEFAULT 0,
        projection_error TEXT,
        projected_at TEXT
      );
      CREATE TABLE IF NOT EXISTS plane_item_cache (
        plane_item_id TEXT PRIMARY KEY,
        project_context_id TEXT NOT NULL,
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        kind TEXT,
        status TEXT,
        due_date TEXT,
        url TEXT,
        is_system_created INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS field_ownership (
        plane_item_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        owner TEXT NOT NULL,
        system_value TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(plane_item_id, field_name)
      );
      CREATE TABLE IF NOT EXISTS turn_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        hook_event_name TEXT NOT NULL,
        record_tool_called INTEGER NOT NULL DEFAULT 0,
        hook_error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        UNIQUE(session_id, turn_id, hook_event_name)
      );
    `);

    this.ensureColumn("outbox_batches", "next_attempt_at", "TEXT");
    this.ensureColumn("outbox_batches", "synced_at", "TEXT");
    this.ensureColumn("outbox_batches", "claim_version", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("outbox_batches", "claim_token", "TEXT");
    this.ensureColumn("outbox_batches", "lease_until", "TEXT");
    this.ensureColumn("source_references", "projection_status", "TEXT NOT NULL DEFAULT 'pending'");
    this.ensureColumn("source_references", "projection_attempts", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("source_references", "projection_error", "TEXT");
    this.ensureColumn("source_references", "projected_at", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_batches(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_outbox_claim ON outbox_batches(status, next_attempt_at, lease_until);
      CREATE INDEX IF NOT EXISTS idx_source_batch ON source_references(batch_id);
      CREATE INDEX IF NOT EXISTS idx_source_event ON source_references(event_id);
      CREATE INDEX IF NOT EXISTS idx_source_projection ON source_references(projection_status, batch_id);
      CREATE INDEX IF NOT EXISTS idx_cache_context ON plane_item_cache(project_context_id, archived, updated_at);
    `);
  }

  private ensureColumn(table: "outbox_batches" | "source_references", column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  close(): void { this.db.close(); }

  getContextByCwd(cwd: string): ProjectContext | null {
    const row = this.db.prepare("SELECT * FROM project_contexts WHERE canonical_cwd = ?").get(canonicalizeCwd(cwd)) as ContextRow | undefined;
    return row ? this.contextFromRow(row) : null;
  }

  getContext(id: string): ProjectContext | null {
    const row = this.db.prepare("SELECT * FROM project_contexts WHERE 'project_' || id = ?").get(id) as ContextRow | undefined;
    return row ? this.contextFromRow(row) : null;
  }

  bindContext(input: ProjectContextInput, replace = false): ProjectContext {
    const canonicalCwd = canonicalizeCwd(input.cwd);
    const existing = this.getContextByCwd(canonicalCwd);
    if (existing && !replace) throw new Error(`A project context already exists for ${canonicalCwd}`);
    const timestamp = now();
    if (existing) {
      this.db.prepare(`UPDATE project_contexts SET plane_base_url=?, workspace_slug=?, plane_project_id=?, plane_project_name=?, auto_capture_enabled=?, updated_at=? WHERE id=?`)
        .run(input.planeBaseUrl, input.workspaceSlug, input.planeProjectId, input.planeProjectName ?? null, input.autoCaptureEnabled === false ? 0 : 1, timestamp, Number(existing.id.replace("project_", "")));
      return this.getContextByCwd(canonicalCwd)!;
    }
    const result = this.db.prepare(`INSERT INTO project_contexts (canonical_cwd, plane_base_url, workspace_slug, plane_project_id, plane_project_name, auto_capture_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(canonicalCwd, input.planeBaseUrl, input.workspaceSlug, input.planeProjectId, input.planeProjectName ?? null, input.autoCaptureEnabled === false ? 0 : 1, timestamp, timestamp);
    return this.getContextByCwd(canonicalCwd)!;
  }

  setAutoCapture(contextId: string, enabled: boolean): ProjectContext {
    const result = this.db.prepare("UPDATE project_contexts SET auto_capture_enabled=?, updated_at=? WHERE 'project_' || id=?").run(enabled ? 1 : 0, now(), contextId);
    if (!result.changes) throw new Error("Project context not found");
    const context = this.getContext(contextId);
    if (!context) throw new Error("Project context not found");
    return context;
  }

  enqueueBatch(batch: { projectContextId: string; sessionId: string; turnId: string; events: SourceEvent[] }): { batchId: string; duplicate: boolean } {
    const insert = this.db.prepare(`INSERT INTO outbox_batches (project_context_id, session_id, turn_id, events_json, status, accepted_at) VALUES (?, ?, ?, ?, 'pending', ?)`);
    try {
      const result = insert.run(batch.projectContextId, batch.sessionId, batch.turnId, JSON.stringify(batch.events), now());
      return { batchId: batchId(Number(result.lastInsertRowid)), duplicate: false };
    } catch (error) {
      if (error instanceof Error && error.message.includes("outbox_batches.project_context_id")) {
        const row = this.db.prepare("SELECT id FROM outbox_batches WHERE project_context_id=? AND session_id=? AND turn_id=?").get(batch.projectContextId, batch.sessionId, batch.turnId) as { id: number };
        return { batchId: batchId(row.id), duplicate: true };
      }
      throw error;
    }
  }

  listPendingBatches(limit = 20): BatchRecord[] {
    const timestamp = now();
    const rows = this.db.prepare(`SELECT id, project_context_id, session_id, turn_id, events_json, status, attempts, last_error, next_attempt_at, synced_at, claim_version, claim_token, lease_until
      FROM outbox_batches
      WHERE status IN ('pending','retrying','failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND (claim_token IS NULL OR lease_until IS NULL OR lease_until <= ?)
      ORDER BY id LIMIT ?`).all(timestamp, timestamp, limit) as BatchRow[];
    return rows.map((row) => this.batchFromRow(row));
  }

  getLeaseMs(): number { return this.leaseMs; }

  claimPendingBatches(limit = 1, leaseMs = this.leaseMs): BatchRecord[] {
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT id, project_context_id, session_id, turn_id, events_json, status, attempts, last_error, next_attempt_at, synced_at, claim_version, claim_token, lease_until
        FROM outbox_batches
        WHERE status IN ('pending','retrying','failed')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          AND (claim_token IS NULL OR lease_until IS NULL OR lease_until <= ?)
        ORDER BY id LIMIT ?`).all(timestamp, timestamp, limit) as BatchRow[];
      const update = this.db.prepare(`UPDATE outbox_batches
        SET claim_version=?, claim_token=?, lease_until=?, attempts=COALESCE(attempts,0)+1
        WHERE id=? AND status IN ('pending','retrying','failed')
          AND (claim_token IS NULL OR lease_until IS NULL OR lease_until <= ?)`);
      const claimed: BatchRecord[] = [];
      for (const row of rows) {
        const version = (row.claim_version ?? 0) + 1;
        const token = `claim_${row.id}_${version}`;
        const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
        const result = update.run(version, token, leaseUntil, row.id, timestamp);
        if (result.changes === 1) {
          claimed.push(this.batchFromRow({ ...row, claim_version: version, claim_token: token, lease_until: leaseUntil, attempts: (row.attempts ?? 0) + 1 }, token));
        }
      }
      return claimed;
    });
    return transaction.immediate() as BatchRecord[];
  }

  renewBatchLease(batchIdValue: string, claimToken: string, leaseMs = this.leaseMs): boolean {
    const id = this.parseBatchRowId(batchIdValue);
    const timestamp = now();
    const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
    const result = this.db.prepare(`UPDATE outbox_batches
      SET lease_until=?
      WHERE id=? AND claim_token=? AND lease_until > ? AND status NOT IN ('synced','corrected')`)
      .run(leaseUntil, id, claimToken, timestamp);
    return result.changes === 1;
  }

  setBatchStatus(batchIdValue: string, status: SyncStatus, error?: string, claimToken?: string): boolean {
    const id = this.parseBatchRowId(batchIdValue);
    const timestamp = now();
    const completed = status === "synced" || status === "corrected";
    const ownership = claimToken
      ? "claim_token=? AND lease_until > ?"
      : "(claim_token IS NULL OR lease_until IS NULL OR lease_until <= ?)";
    const result = this.db.prepare(`UPDATE outbox_batches
      SET status=?, attempts=COALESCE(attempts,0)+${claimToken ? 0 : 1}, last_error=?, synced_at=?, next_attempt_at=?, claim_token=NULL, lease_until=NULL
      WHERE id=? AND status NOT IN ('synced','corrected') AND ${ownership}`)
      .run(...(claimToken ? [status, error ?? null, completed ? timestamp : null, completed ? null : timestamp, id, claimToken, timestamp] : [status, error ?? null, completed ? timestamp : null, completed ? null : timestamp, id, timestamp]));
    return result.changes === 1;
  }

  markBatchRetrying(batchIdValue: string, error: string, claimToken?: string): boolean { return this.setBatchStatus(batchIdValue, "retrying", error, claimToken); }

  addSourceReference(input: Omit<SourceReference, "id" | "createdAt" | "projectionStatus" | "projectionAttempts" | "projectionError" | "projectedAt">): SourceReference {
    this.db.prepare(`INSERT INTO source_references (batch_id,event_id,plane_item_id,session_id,turn_id,event_type,summary,source_excerpt,observed_at,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM source_references WHERE event_id=?)`)
      .run(input.batchId, input.eventId, input.planeItemId, input.sessionId, input.turnId, input.eventType, input.summary, input.sourceExcerpt, input.observedAt, now(), input.eventId);
    const reference = this.getSourceReference(input.eventId);
    if (!reference) throw new Error(`Source reference not found for ${input.eventId}`);
    return reference;
  }

  getSourceReference(eventIdValue: string): SourceReference | null {
    const row = this.db.prepare("SELECT * FROM source_references WHERE event_id=?").get(eventIdValue) as SourceRow | undefined;
    return row ? this.sourceFromRow(row) : null;
  }

  updateSourcePlaneItem(eventIdValue: string, planeItemId: string, claimToken?: string): void {
    if (!this.updateSourceOwned(eventIdValue, claimToken, "plane_item_id=?", [planeItemId])) throw new Error("Outbox batch claim lost");
  }

  markEventAttempt(eventIdValue: string, claimToken?: string): void {
    if (!this.updateSourceOwned(eventIdValue, claimToken, "projection_status='pending', projection_attempts=COALESCE(projection_attempts,0)+1, projection_error=NULL", [])) throw new Error("Outbox batch claim lost");
  }

  markEventCompleted(eventIdValue: string, planeItemId: string | null, claimToken?: string): void {
    if (!this.updateSourceOwned(eventIdValue, claimToken, "projection_status='completed', projection_error=NULL, projected_at=?, plane_item_id=COALESCE(?, plane_item_id)", [now(), planeItemId])) throw new Error("Outbox batch claim lost");
  }

  markEventFailed(eventIdValue: string, error: string, claimToken?: string): boolean {
    return this.updateSourceOwned(eventIdValue, claimToken, "projection_status='failed', projection_error=?", [error]);
  }

  areBatchEventsComplete(batchIdValue: string, eventCount: number): boolean {
    const batchRowId = this.parseBatchRowId(batchIdValue);
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM source_references WHERE batch_id=? AND projection_status='completed'").get(batchIdValue) as { count: number };
    return row.count === eventCount && eventCount > 0 && batchRowId > 0;
  }

  listSources(contextId: string, planeItemId?: string): SourceReference[] {
    const query = planeItemId
      ? `SELECT sr.* FROM source_references sr JOIN outbox_batches b ON b.id = CAST(REPLACE(sr.batch_id,'batch_','') AS INTEGER) WHERE b.project_context_id=? AND sr.plane_item_id=? ORDER BY sr.id DESC`
      : `SELECT sr.* FROM source_references sr JOIN outbox_batches b ON b.id = CAST(REPLACE(sr.batch_id,'batch_','') AS INTEGER) WHERE b.project_context_id=? ORDER BY sr.id DESC`;
    const rows = (planeItemId ? this.db.prepare(query).all(contextId, planeItemId) : this.db.prepare(query).all(contextId)) as SourceRow[];
    return rows.map((row) => this.sourceFromRow(row));
  }

  cacheItem(contextId: string, item: PlaneItem, isSystemCreated = item.isSystemCreated ?? false): void {
    const current = this.getCachedItem(item.id);
    this.db.prepare(`INSERT INTO plane_item_cache (plane_item_id, project_context_id, identifier, title, description, kind, status, due_date, url, is_system_created, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(plane_item_id) DO UPDATE SET identifier=excluded.identifier,title=excluded.title,description=excluded.description,kind=excluded.kind,status=excluded.status,due_date=excluded.due_date,url=excluded.url,updated_at=excluded.updated_at,archived=excluded.archived`)
      .run(item.id, contextId, item.identifier, item.title, item.description ?? null, item.kind ?? null, item.status ?? item.stateName ?? null, item.dueDate ?? null, item.url ?? null, current?.isSystemCreated ?? isSystemCreated ? 1 : 0, item.updatedAt ?? now(), item.archived ? 1 : 0);
  }

  getCachedItem(planeItemId: string): (PlaneItem & { isSystemCreated: boolean; contextId: string }) | null {
    const row = this.db.prepare("SELECT * FROM plane_item_cache WHERE plane_item_id=?").get(planeItemId) as CacheRow | undefined;
    if (!row) return null;
    return { id: row.plane_item_id, identifier: row.identifier, title: row.title, description: row.description ?? undefined, kind: (row.kind as PlaneItem["kind"]) ?? undefined, status: (row.status as PlaneItem["status"]) ?? undefined, dueDate: row.due_date, url: row.url ?? undefined, isSystemCreated: Boolean(row.is_system_created), archived: Boolean(row.archived), updatedAt: row.updated_at, contextId: row.project_context_id };
  }

  listCachedItems(contextId: string): Array<PlaneItem & { isSystemCreated: boolean }> {
    const rows = this.db.prepare("SELECT * FROM plane_item_cache WHERE project_context_id=? AND archived=0 ORDER BY updated_at DESC").all(contextId) as CacheRow[];
    return rows.map((row) => ({ id: row.plane_item_id, identifier: row.identifier, title: row.title, description: row.description ?? undefined, kind: (row.kind as PlaneItem["kind"]) ?? undefined, status: (row.status as PlaneItem["status"]) ?? undefined, dueDate: row.due_date, url: row.url ?? undefined, isSystemCreated: Boolean(row.is_system_created), archived: Boolean(row.archived), updatedAt: row.updated_at }));
  }

  listAllCachedItems(contextId: string): Array<PlaneItem & { isSystemCreated: boolean }> {
    const rows = this.db.prepare("SELECT * FROM plane_item_cache WHERE project_context_id=? ORDER BY archived, updated_at DESC").all(contextId) as CacheRow[];
    return rows.map((row) => ({ id: row.plane_item_id, identifier: row.identifier, title: row.title, description: row.description ?? undefined, kind: (row.kind as PlaneItem["kind"]) ?? undefined, status: (row.status as PlaneItem["status"]) ?? undefined, dueDate: row.due_date, url: row.url ?? undefined, isSystemCreated: Boolean(row.is_system_created), updatedAt: row.updated_at, archived: Boolean(row.archived) }));
  }

  markCacheArchived(itemId: string, archived = true): void { this.db.prepare("UPDATE plane_item_cache SET archived=?, updated_at=? WHERE plane_item_id=?").run(archived ? 1 : 0, now(), itemId); }

  setFieldOwnership(planeItemId: string, field: FieldName, owner: FieldOwner, systemValue: string | null): void {
    this.db.prepare(`INSERT INTO field_ownership (plane_item_id,field_name,owner,system_value,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(plane_item_id,field_name) DO UPDATE SET owner=excluded.owner,system_value=excluded.system_value,updated_at=excluded.updated_at`).run(planeItemId, field, owner, systemValue, now());
  }

  getFieldOwnership(planeItemId: string, field: FieldName): FieldOwnership | null {
    const row = this.db.prepare("SELECT plane_item_id,field_name,owner,system_value,updated_at FROM field_ownership WHERE plane_item_id=? AND field_name=?").get(planeItemId, field) as { plane_item_id: string; field_name: FieldName; owner: FieldOwner; system_value: string | null; updated_at: string } | undefined;
    return row ? { planeItemId: row.plane_item_id, field: row.field_name, owner: row.owner, systemValue: row.system_value, updatedAt: row.updated_at } : null;
  }

  setUserFields(planeItemId: string, fields: Partial<Record<FieldName, string | null>>): void { for (const [field, value] of Object.entries(fields)) this.setFieldOwnership(planeItemId, field as FieldName, "user", value ?? null); }

  auditHook(input: { eventName: string; sessionId: string; turnId?: string; toolCalled?: boolean; error?: string; ended?: boolean }): void {
    const turnId = input.turnId ?? null;
    this.db.prepare(`INSERT INTO turn_audits (session_id,turn_id,hook_event_name,record_tool_called,hook_error,started_at,ended_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(session_id,turn_id,hook_event_name) DO UPDATE SET record_tool_called=MAX(record_tool_called,excluded.record_tool_called),hook_error=COALESCE(excluded.hook_error,hook_error),ended_at=COALESCE(excluded.ended_at,ended_at)`).run(input.sessionId, turnId, input.eventName, input.toolCalled ? 1 : 0, input.error ?? null, now(), input.ended ? now() : null);
  }

  listAudits(sessionId?: string): unknown[] { return (sessionId ? this.db.prepare("SELECT * FROM turn_audits WHERE session_id=? ORDER BY id DESC").all(sessionId) : this.db.prepare("SELECT * FROM turn_audits ORDER BY id DESC").all()) as unknown[]; }

  didRecordProjectEvents(sessionId: string, turnId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='PostToolUse' AND record_tool_called=1").get(sessionId, turnId);
    return Boolean(row);
  }
  listFailedBatches(contextId: string): unknown[] {
    return this.db.prepare("SELECT 'batch_' || id AS batch_id, status, attempts, last_error, accepted_at FROM outbox_batches WHERE project_context_id=? AND status NOT IN ('synced','corrected') ORDER BY id DESC").all(contextId) as unknown[];
  }

  retryBatch(id: string, projectContextId?: string): void {
    const rowId = this.parseBatchRowId(id);
    const timestamp = now();
    const row = this.db.prepare("SELECT project_context_id, status, claim_token, lease_until FROM outbox_batches WHERE id=?").get(rowId) as { project_context_id: string; status: SyncStatus; claim_token: string | null; lease_until: string | null } | undefined;
    if (!row) throw new Error("Outbox batch not found");
    if (projectContextId && row.project_context_id !== projectContextId) throw new Error("Outbox batch does not belong to this project context");
    if (row.status === "synced" || row.status === "corrected") throw new Error("Only unsynced batches can be retried");
    const result = this.db.prepare(`UPDATE outbox_batches
      SET status='retrying', next_attempt_at=?, last_error=NULL
      WHERE id=? AND status NOT IN ('synced','corrected')
        AND (claim_token IS NULL OR lease_until IS NULL OR lease_until <= ?)`)
      .run(timestamp, rowId, timestamp);
    if (result.changes !== 1) throw new Error(row.claim_token && row.lease_until && row.lease_until > timestamp ? "Outbox batch is currently claimed" : "Only unsynced batches can be retried");
  }

  private parseBatchRowId(value: string): number {
    const match = /^batch_([0-9]+)$/.exec(value);
    if (!match) throw new Error("Invalid outbox batch id");
    return Number(match[1]);
  }

  private batchFromRow(row: BatchRow, claimToken?: string): BatchRecord {
    return {
      rowId: row.id,
      id: batchId(row.id),
      projectContextId: row.project_context_id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      events: JSON.parse(row.events_json) as SourceEvent[],
      status: row.status,
      attempts: row.attempts ?? 0,
      lastError: row.last_error,
      claimToken: claimToken ?? row.claim_token ?? undefined,
      leaseUntil: row.lease_until,
    };
  }

  private sourceFromRow(row: SourceRow): SourceReference {
    return {
      id: row.id,
      batchId: row.batch_id,
      eventId: row.event_id,
      planeItemId: row.plane_item_id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      eventType: row.event_type,
      summary: row.summary,
      sourceExcerpt: row.source_excerpt,
      observedAt: row.observed_at,
      createdAt: row.created_at,
      projectionStatus: row.projection_status ?? "pending",
      projectionAttempts: row.projection_attempts ?? 0,
      projectionError: row.projection_error,
      projectedAt: row.projected_at,
    };
  }

  private updateSourceOwned(eventIdValue: string, claimToken: string | undefined, setSql: string, values: unknown[]): boolean {
    const source = this.db.prepare("SELECT batch_id FROM source_references WHERE event_id=?").get(eventIdValue) as { batch_id: string } | undefined;
    if (!source) throw new Error(`Source reference not found for ${eventIdValue}`);
    const batchRowId = this.parseBatchRowId(source.batch_id);
    const timestamp = now();
    const ownership = claimToken
      ? "claim_token=? AND lease_until > ?"
      : "(claim_token IS NULL OR lease_until IS NULL OR lease_until <= ?)";
    const params = claimToken
      ? [...values, eventIdValue, batchRowId, claimToken, timestamp]
      : [...values, eventIdValue, batchRowId, timestamp];
    const result = this.db.prepare(`UPDATE source_references SET ${setSql}
      WHERE event_id=? AND EXISTS (SELECT 1 FROM outbox_batches WHERE id=? AND status NOT IN ('synced','corrected') AND ${ownership})`).run(...params);
    return result.changes === 1;
  }

  private contextFromRow(row: ContextRow): ProjectContext {
    return { id: `project_${row.id}`, canonicalCwd: row.canonical_cwd, cwd: row.canonical_cwd, planeBaseUrl: row.plane_base_url, workspaceSlug: row.workspace_slug, planeProjectId: row.plane_project_id, planeProjectName: row.plane_project_name ?? undefined, autoCaptureEnabled: Boolean(row.auto_capture_enabled), createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
