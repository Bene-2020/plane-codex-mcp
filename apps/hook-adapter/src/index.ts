import { buildAdditionalContext, hasCompleteProjectBindingPrompt, projectBindingAcknowledgeEventsToolName, projectBindingDeclineToolName, projectBindingListProjectsToolName, projectBindingRecordEventsToolName, projectBindingRestoreToolName, type BindingOnboardingPhase, type BindingProjectCandidate } from "@ambient/core";
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

const recordProjectEventsToolName = projectBindingRecordEventsToolName;
const listProjectsToolName = projectBindingListProjectsToolName;
const acknowledgeNoProjectEventsToolName = projectBindingAcknowledgeEventsToolName;
const declineProjectBindingToolName = projectBindingDeclineToolName;
const restoreProjectBindingToolName = projectBindingRestoreToolName;
const recognizedPostToolNames = new Set([recordProjectEventsToolName, listProjectsToolName, acknowledgeNoProjectEventsToolName, declineProjectBindingToolName, restoreProjectBindingToolName]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeToolResponse(value: unknown): unknown | null {
  if (typeof value === "string") {
    try { return decodeToolResponse(JSON.parse(value) as unknown); } catch { return null; }
  }
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return value;
  if (value.isError === true || (Object.hasOwn(value, "error") && value.error !== undefined && value.error !== null)) return null;
  if (Object.hasOwn(value, "content")) {
    if (!Array.isArray(value.content) || value.content.length !== 1) return null;
    const content = value.content[0];
    if (!isRecord(content) || content.type !== "text" || typeof content.text !== "string") return null;
    return decodeToolResponse(content.text);
  }
  if (Object.hasOwn(value, "result")) return decodeToolResponse(value.result);
  if (Object.hasOwn(value, "structuredContent")) return decodeToolResponse(value.structuredContent);
  return value;
}

function hasForbiddenBindingMetadata(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenBindingMetadata);
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => ["path", "projectkind", "hostid"].includes(key.replaceAll("_", "").toLocaleLowerCase()))) return true;
  return Object.values(value).some(hasForbiddenBindingMetadata);
}

function extractBindingCandidates(toolResponse: unknown): BindingProjectCandidate[] | null {
  const decoded = decodeToolResponse(toolResponse);
  if (decoded === null || hasForbiddenBindingMetadata(decoded) || !Array.isArray(decoded) || decoded.length === 0 || decoded.length > 200) return null;
  const seen = new Set<string>();
  const candidates: BindingProjectCandidate[] = [];
  for (const value of decoded) {
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.identifier !== "string") return null;
    const name = value.name.trim();
    const identifier = value.identifier.trim();
    if (!name || !identifier || name.length > 240 || identifier.length > 100) return null;
    const key = `${identifier}\u0000${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    candidates.push({ name, identifier });
  }
  return candidates;
}

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
      if (!recognizedPostToolNames.has(toolName)) return {};
      const isCanonicalListProjects = toolName === listProjectsToolName;
      const bindingCandidates = isCanonicalListProjects ? extractBindingCandidates(input.tool_response) : null;
      storage.auditHook({
        eventName,
        sessionId,
        turnId: input.turn_id,
        toolCalled: toolName === recordProjectEventsToolName,
        bindingListToolCalled: isCanonicalListProjects,
        ...(isCanonicalListProjects ? {
          bindingCandidates,
          bindingCandidateSourceValid: Boolean(bindingCandidates),
          bindingSourceInvalid: !bindingCandidates,
        } : {}),
      });
      return {};
    }
    if (eventName === "Stop") {
      const context = input.cwd ? storage.getContextByCwd(input.cwd) : null;
      const captureDecisionRecorded = context?.autoCaptureEnabled && input.turn_id
        ? storage.didRecordProjectEvents(context.id, sessionId, input.turn_id) || storage.didAcknowledgeNoProjectEvents(context.id, sessionId, input.turn_id)
        : null;
      const didCallListProjects = Boolean(input.turn_id && storage.didCallListProjects(sessionId, input.turn_id));
      const bindingCandidates = input.turn_id ? storage.getBindingCandidates(sessionId, input.turn_id) : null;
      const bindingPreference = !context && input.cwd ? storage.getBindingPreference(input.cwd) : null;
      const bindingOnboardingActive = !context && input.cwd && input.turn_id && !bindingPreference;
      const hasBindingPromptShape = bindingOnboardingActive ? hasCompleteProjectBindingPrompt(input.last_assistant_message) : false;
      const bindingPromptAttempted = bindingOnboardingActive && (didCallListProjects || hasBindingPromptShape);
      const bindingPromptDelivered = bindingPromptAttempted
        ? didCallListProjects && Boolean(bindingCandidates) && hasCompleteProjectBindingPrompt(input.last_assistant_message, bindingCandidates)
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
      const activeItems = context ? storage.listCachedItems(context.id).map((item) => ({ itemId: item.id, identifier: item.identifier, title: item.title, status: item.status ?? "captured", parentId: item.parentId, kind: item.kind, updatedAt: item.updatedAt })) : [];
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
