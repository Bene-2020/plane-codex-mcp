import { buildAdditionalContext, hasCompleteProjectBindingPrompt, type BindingOnboardingPhase } from "@ambient/core";
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
const listProjectsToolName = "mcp__ambient_project__list_projects";

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
    if (eventName === "PostToolUse") {
      const toolName = input.tool_name ?? "";
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, toolCalled: toolName === recordProjectEventsToolName, bindingListToolCalled: toolName === listProjectsToolName });
      return {};
    }
    if (eventName === "Stop") {
      const context = input.cwd ? storage.getContextByCwd(input.cwd) : null;
      const captureDecisionRecorded = context?.autoCaptureEnabled && input.turn_id
        ? storage.didRecordProjectEvents(context.id, sessionId, input.turn_id) || storage.didAcknowledgeNoProjectEvents(context.id, sessionId, input.turn_id)
        : null;
      const didCallListProjects = Boolean(input.turn_id && storage.didCallListProjects(sessionId, input.turn_id));
      const bindingPromptDelivered = !context && input.turn_id && didCallListProjects
        ? hasCompleteProjectBindingPrompt(input.last_assistant_message)
        : null;
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id, ended: true, captureDecisionRecorded, bindingPromptDelivered });
      return {};
    }
    if (eventName === "SessionEnd") {
      storage.auditHook({ eventName, sessionId, ended: true });
      return {};
    }
    if (eventName === "SessionStart" || eventName === "UserPromptSubmit") {
      const context = input.cwd ? storage.getContextByCwd(input.cwd) : null;
      const activeItems = context ? storage.listCachedItems(context.id).map((item) => ({ id: item.id, identifier: item.identifier, title: item.title, status: item.status ?? "captured", parentId: item.parentId, kind: item.kind, updatedAt: item.updatedAt })) : [];
      const bindingPreference = !context && input.cwd ? storage.getBindingPreference(input.cwd) : null;
      // This is only a lifecycle hint for choosing the SessionStart/first/later template;
      // the injected later-session branch must inspect visible dialogue rather than infer that onboarding happened.
      const sessionHasUserPrompt = storage.hasHookAudit(sessionId, "UserPromptSubmit");
      const firstUserPrompt = eventName === "UserPromptSubmit" && !sessionHasUserPrompt;
      const onboardingPhase: BindingOnboardingPhase | undefined = context
        ? undefined
        : bindingPreference
          ? "permanently_declined"
          : eventName === "SessionStart" && !sessionHasUserPrompt
            ? "session_start"
            : firstUserPrompt
              ? "first_user_prompt"
              : "continuing_session";
      storage.auditHook({ eventName, sessionId, turnId: input.turn_id });
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: buildAdditionalContext({ eventName, sessionId, turnId: input.turn_id, context, currentCwd: input.cwd, onboardingPhase, activeItems }),
        },
      };
    }
    return {};
  } catch (error) {
    try { storage?.auditHook({ eventName, sessionId, turnId: input.turn_id, error: error instanceof Error ? error.message : String(error), ended: eventName === "Stop" }); } catch { /* Hook failure must not block Codex. */ }
    if (eventName === "Stop") return {};
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
