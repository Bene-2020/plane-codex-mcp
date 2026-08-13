#!/usr/bin/env node
import { constants, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function usage() {
  console.log(`Usage:
  pnpm migrate:source-ids -- --db /absolute/path/to/ambient.sqlite
  pnpm migrate:source-ids -- --db /absolute/path/to/ambient.sqlite --apply --backup /absolute/path/to/ambient.before-source-id.sqlite

Dry-run is the default. --apply rewrites legacy event_* markers in Plane and fills the
local remote_source_id column. Stop Codex Desktop before applying. PLANE_API_KEY is required.`);
}

function parseArgs(argv) {
  const args = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (value === "--apply") args.apply = true;
    else if (value === "--db") args.db = argv[++index];
    else if (value === "--backup") args.backup = argv[++index];
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function remoteSourceId(projectContextId, sessionId, turnId, index) {
  return [projectContextId, sessionId, turnId, String(index)].map(encodeURIComponent).join(":");
}

function sourceIndex(eventId) {
  const match = /^event_(\d+)_(\d+)$/.exec(eventId);
  if (!match) throw new Error(`Unexpected local event id: ${eventId}`);
  return Number(match[2]);
}

function apiUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, "")}/api/v1${path}`;
}

async function planeRequest(context, path, options = {}) {
  const response = await fetch(apiUrl(context.plane_base_url, path), {
    ...options,
    headers: { "Content-Type": "application/json", "X-Api-Key": process.env.PLANE_API_KEY, ...options.headers },
  });
  if (!response.ok) throw new Error(`Plane ${options.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function listAll(context, path) {
  const results = [];
  for (let offset = 0; ; offset += 100) {
    const separator = path.includes("?") ? "&" : "?";
    const payload = await planeRequest(context, `${path}${separator}limit=100&offset=${offset}`);
    results.push(...payload.results);
    if (!payload.next_page_results || payload.results.length < 100) return results;
  }
}

function replaceMarkers(value, mappings) {
  if (!value) return value;
  return value
    .replace(/\[ambient-source:(event_\d+_\d+)(:step_\d+)?\]/g, (marker, eventId, step = "") => {
      const replacement = mappings.get(eventId);
      return replacement ? `[ambient-source:${replacement}${step}]` : marker;
    })
    .replace(/来源事件: (event_\d+_\d+)/g, (marker, eventId) => {
      const replacement = mappings.get(eventId);
      return replacement ? `来源事件: ${replacement}` : marker;
    })
    .replace(/\[ambient:(event_\d+_\d+)\]/g, (marker, eventId) => {
      const replacement = mappings.get(eventId);
      return replacement ? `[ambient:${replacement}]` : marker;
    });
}

async function inspectPlane(contexts, mappingsByContext) {
  const itemUpdates = [];
  const commentUpdates = [];
  for (const context of contexts) {
    const mappings = mappingsByContext.get(context.id) ?? new Map();
    if (!mappings.size) continue;
    const root = `/workspaces/${encodeURIComponent(context.workspace_slug)}/projects/${encodeURIComponent(context.plane_project_id)}/work-items`;
    const items = await listAll(context, `${root}/`);
    for (const item of items) {
      const description = replaceMarkers(item.description_html ?? "", mappings);
      if (description !== (item.description_html ?? "")) itemUpdates.push({ context, itemId: item.id, identifier: item.identifier ?? item.sequence_id ?? item.id, description });
      const comments = await listAll(context, `${root}/${encodeURIComponent(item.id)}/comments/`);
      for (const comment of comments) {
        const body = replaceMarkers(comment.comment_html ?? "", mappings);
        if (body !== (comment.comment_html ?? "")) commentUpdates.push({ context, itemId: item.id, commentId: comment.id, body });
      }
    }
  }
  return { itemUpdates, commentUpdates };
}

async function applyPlaneUpdates(plan) {
  for (const entry of plan.itemUpdates) {
    const path = `/workspaces/${encodeURIComponent(entry.context.workspace_slug)}/projects/${encodeURIComponent(entry.context.plane_project_id)}/work-items/${encodeURIComponent(entry.itemId)}/`;
    await planeRequest(entry.context, path, { method: "PATCH", body: JSON.stringify({ description_html: entry.description }) });
  }
  for (const entry of plan.commentUpdates) {
    const path = `/workspaces/${encodeURIComponent(entry.context.workspace_slug)}/projects/${encodeURIComponent(entry.context.plane_project_id)}/work-items/${encodeURIComponent(entry.itemId)}/comments/${encodeURIComponent(entry.commentId)}/`;
    await planeRequest(entry.context, path, { method: "PATCH", body: JSON.stringify({ comment_html: entry.body }) });
  }
}

function loadMigration(db) {
  const rows = db.prepare(`SELECT sr.id, sr.event_id, b.project_context_id, b.session_id, b.turn_id
    FROM source_references sr
    JOIN outbox_batches b ON sr.batch_id = 'batch_' || b.id
    ORDER BY sr.id`).all();
  const mappingsByContext = new Map();
  const updates = rows.map((row) => {
    const remoteId = remoteSourceId(row.project_context_id, row.session_id, row.turn_id, sourceIndex(row.event_id));
    const mappings = mappingsByContext.get(row.project_context_id) ?? new Map();
    if (mappings.has(row.event_id) && mappings.get(row.event_id) !== remoteId) throw new Error(`Ambiguous legacy id ${row.event_id} in ${row.project_context_id}`);
    mappings.set(row.event_id, remoteId);
    mappingsByContext.set(row.project_context_id, mappings);
    return { id: row.id, eventId: row.event_id, remoteId };
  });
  if (new Set(updates.map((row) => row.remoteId)).size !== updates.length) throw new Error("The computed remote source ids are not unique");
  return { updates, mappingsByContext };
}

function applyLocalUpdates(db, updates) {
  const columns = db.prepare("PRAGMA table_info(source_references)").all();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!columns.some((column) => column.name === "remote_source_id")) db.exec("ALTER TABLE source_references ADD COLUMN remote_source_id TEXT");
    const update = db.prepare("UPDATE source_references SET remote_source_id=? WHERE id=?");
    for (const row of updates) update.run(row.remoteId, row.id);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_source_remote ON source_references(remote_source_id)");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!args.db) throw new Error("--db is required");
  const dbPath = resolve(args.db);
  if (!existsSync(dbPath)) throw new Error(`Database does not exist: ${dbPath}`);
  if (args.apply && !args.backup) throw new Error("--backup is required with --apply");
  if (!process.env.PLANE_API_KEY) throw new Error("PLANE_API_KEY is required to inspect and update Plane");

  const db = new DatabaseSync(dbPath, { readOnly: !args.apply });
  try {
    const migration = loadMigration(db);
    const contexts = db.prepare("SELECT 'project_' || id AS id, plane_base_url, workspace_slug, plane_project_id FROM project_contexts ORDER BY id").all();
    const plane = await inspectPlane(contexts, migration.mappingsByContext);
    console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", database: dbPath, localSourceRows: migration.updates.length, planeItemsToUpdate: plane.itemUpdates.map(({ identifier }) => identifier), planeCommentsToUpdate: plane.commentUpdates.length }, null, 2));
    if (!args.apply) return;

    const backupPath = resolve(args.backup);
    if (existsSync(backupPath)) throw new Error(`Backup already exists: ${backupPath}`);
    db.exec("PRAGMA wal_checkpoint(FULL)");
    copyFileSync(dbPath, backupPath, constants.COPYFILE_EXCL);
    await applyPlaneUpdates(plane);
    applyLocalUpdates(db, migration.updates);
    console.log(`Migration complete. Backup: ${backupPath}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
