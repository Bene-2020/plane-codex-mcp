import { buildAdditionalContext, canonicalizeCwd } from "@ambient/core";
import { Storage } from "@ambient/storage";
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface HookInput {
  session_id?: string;
  transcript_path?: string | null;
  cwd?: string;
  hook_event_name?: string;
  model?: string;
  permission_mode?: string;
  turn_id?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  source?: string;
  prompt?: string;
  reason?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
}

function output(value: Record<string, unknown>): void { process.stdout.write(`${JSON.stringify(value)}\n`); }

const recordProjectEventsToolName = "mcp__ambient_project__record_project_events";

function createHookStorage(): Storage {
  const pluginData = process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA;
  const databasePath = pluginData ? join(pluginData, "ambient.sqlite") : process.env.AMBIENT_DB_PATH;
  if (!databasePath) throw new Error("PLUGIN_DATA or AMBIENT_DB_PATH is required for Ambient Project hooks");
  if (pluginData) mkdirSync(pluginData, { recursive: true });
  return new Storage(databasePath);
}

export async function handleHook(raw: string, providedStorage?: Storage): Promise<Record<string, unknown>> {
  let input: HookInput;
  try { input = JSON.parse(raw) as HookInput; } catch { return {}; }
  const eventName = input.hook_event_name;
  const sessionId = input.session_id;
  if (!eventName || !sessionId) return {};
  let storage: Storage | undefined = providedStorage;
  try {
    storage ??= createHookStorage();
    const cwd = input.cwd ? canonicalizeCwd(input.cwd) : undefined;
    const context = cwd ? storage.getContextByCwd(cwd) : null;
    if (eventName === "PostToolUse") {
      const toolName = input.tool_name ?? "";
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, toolCalled: toolName === recordProjectEventsToolName });
      return {};
    }
    if (eventName === "Stop") {
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, ended: true });
      if (context?.autoCaptureEnabled && input.turn_id && !input.stop_hook_active && !storage.didRecordProjectEvents(sessionId, input.turn_id)) {
        return {
          decision: "block",
          reason: "Before ending this turn, decide whether the user's request, your work, tool results, or conclusion created a meaningful project event. If yes, call mcp__ambient_project__record_project_events exactly once with all events for project context " + context.id + ". If no meaningful event occurred, finish without recording. Do not record ordinary conversation.",
        };
      }
      return {};
    }
    if (eventName === "SessionEnd") {
      storage.auditHook({ eventName, sessionId, ended: true });
      return {};
    }
    if (eventName === "SessionStart" || eventName === "UserPromptSubmit") {
      const activeItems = context ? storage.listCachedItems(context.id).slice(0, 30).map((item) => ({ id: item.id, identifier: item.identifier, title: item.title, status: item.status ?? "captured", kind: item.kind, updatedAt: item.updatedAt })) : [];
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id });
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: buildAdditionalContext({ eventName, sessionId, turnId: input.turn_id, context, activeItems }),
        },
      };
    }
    return {};
  } catch (error) {
    try { storage?.auditHook({ eventName, sessionId, turnId: input.turn_id, error: error instanceof Error ? error.message : String(error) }); } catch { /* Hook failure must not block Codex. */ }
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: buildAdditionalContext({ eventName, error: String(error) }),
      },
    };
  } finally {
    if (!providedStorage) storage?.close();
  }
}

async function main(): Promise<void> {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  output(await handleHook(raw));
}

const entrypoint = process.argv[1];
if (entrypoint && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entrypoint))) main().catch(() => output({}));
