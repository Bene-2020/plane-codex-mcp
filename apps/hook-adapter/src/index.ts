import { buildAdditionalContext, canonicalizeCwd } from "@ambient/core";
import { Storage } from "@ambient/storage";

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

const recordProjectEventsToolName = "mcp__ambient-project__record_project_events";

export async function handleHook(raw: string, providedStorage?: Storage): Promise<Record<string, unknown>> {
  let input: HookInput;
  try { input = JSON.parse(raw) as HookInput; } catch { return {}; }
  const eventName = input.hook_event_name;
  const sessionId = input.session_id;
  if (!eventName || !sessionId) return {};
  let storage: Storage | undefined = providedStorage;
  try {
    storage ??= new Storage();
    const cwd = input.cwd ? canonicalizeCwd(input.cwd) : undefined;
    const context = cwd ? storage.getContextByCwd(cwd) : null;
    if (eventName === "PostToolUse") {
      const toolName = input.tool_name ?? "";
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, toolCalled: toolName === recordProjectEventsToolName });
      return {};
    }
    if (eventName === "Stop") {
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, ended: true });
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

if (import.meta.url === `file://${process.argv[1]}`) main().catch(() => output({}));
