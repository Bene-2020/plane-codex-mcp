import { buildAdditionalContext, canonicalizeCwd } from "@ambient/core";
import { Storage } from "@ambient/storage";

interface HookInput {
  hook_event_name?: string;
  event_name?: string;
  cwd?: string;
  session_id?: string;
  turn_id?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  error?: string;
}

function output(value: Record<string, unknown>): void { process.stdout.write(`${JSON.stringify(value)}\n`); }

export async function handleHook(raw: string, providedStorage?: Storage): Promise<Record<string, unknown>> {
  let input: HookInput;
  try { input = JSON.parse(raw) as HookInput; } catch { return {}; }
  const eventName = input.hook_event_name ?? input.event_name;
  const sessionId = input.session_id;
  if (!eventName || !sessionId) return {};
  let storage: Storage | undefined = providedStorage;
  try {
    storage ??= new Storage();
    const cwd = input.cwd ? canonicalizeCwd(input.cwd) : undefined;
    const context = cwd ? storage.getContextByCwd(cwd) : null;
    if (eventName === "PostToolUse") {
      const toolName = input.tool_name ?? "";
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, toolCalled: toolName === "record_project_events" || toolName.endsWith("/record_project_events"), error: input.error });
      return {};
    }
    if (eventName === "Stop") {
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, ended: true, error: input.error });
      return {};
    }
    if (eventName === "SessionEnd") {
      storage.auditHook({ eventName, sessionId, ended: true, error: input.error });
      return {};
    }
    if (eventName === "SessionStart" || eventName === "UserPromptSubmit") {
      const activeItems = context ? storage.listCachedItems(context.id).slice(0, 30).map((item) => ({ id: item.id, identifier: item.identifier, title: item.title, status: item.status ?? "captured", kind: item.kind, updatedAt: item.updatedAt })) : [];
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, error: input.error });
      return { additionalContext: buildAdditionalContext({ eventName, sessionId, turnId: input.turn_id, context, activeItems }) };
    }
    return {};
  } catch (error) {
    try { storage?.auditHook({ eventName, sessionId, turnId: input.turn_id, error: error instanceof Error ? error.message : String(error) }); } catch { /* Hook failure must not block Codex. */ }
    return { additionalContext: buildAdditionalContext({ eventName, error: String(error) }) };
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
