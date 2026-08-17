import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getNodeSidecarTarget, getNodeSidecarTargetForHost, NODE_SIDECAR_TARGET_IDS, renderLauncher } from "./node-sidecar-targets.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcePlugin = join(root, "plugin");
const fixtureRoot = join(root, "fixtures", "hooks");
const fixtures = {
  SessionStart: await readFile(join(fixtureRoot, "session-start.json"), "utf8"),
  UserPromptSubmit: await readFile(join(fixtureRoot, "user-prompt-submit.json"), "utf8"),
  PostToolUse: await readFile(join(fixtureRoot, "post-tool-use.json"), "utf8"),
  Stop: await readFile(join(fixtureRoot, "stop.json"), "utf8"),
  SessionEnd: await readFile(join(fixtureRoot, "session-end.json"), "utf8"),
};

function assertInside(rootPath, candidate) {
  const path = resolve(candidate);
  const pathRelativeToRoot = relative(rootPath, path);
  if (pathRelativeToRoot.startsWith("..") || pathRelativeToRoot.includes("..")) throw new Error(`Path escapes plugin root: ${path}`);
  return path;
}

let isolatedPath;

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClosed) => child.once("close", resolveClosed));
  child.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Plugin process did not exit after SIGTERM")), 6_000)),
  ]);
}

function runPluginCommand(command, args, input, env, cwd) {
  return new Promise((resolveResult, reject) => {
    const childEnv = { ...process.env, ...env, PATH: isolatedPath };
    delete childEnv.NODE_PATH;
    delete childEnv.NODE_OPTIONS;
    const child = spawn(command, args, { cwd, env: childEnv });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out running ${command}`));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} exited with ${code ?? signal}: ${stderr}`));
      else resolveResult({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function smokeMcp(mcpEntrypoint, smokeRoot, pluginRoot) {
  const childEnv = {
    AMBIENT_DB_PATH: join(smokeRoot, "mcp database.sqlite"),
    PLANE_MODE: "fake",
    PLANE_BASE_URL: "https://api.plane.so",
    PLANE_API_KEY: "",
    PLANE_WORKSPACE_SLUG: "smoke-workspace",
  };
  const child = spawn(join(pluginRoot, "runtime", "bin", "ambient-node"), [mcpEntrypoint], { cwd: pluginRoot, env: { ...process.env, ...childEnv, PATH: isolatedPath } });
  const lines = createInterface({ input: child.stdout });
  const waiters = new Map();
  let stderr = "";
  let closing = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("close", (code, signal) => {
    if (closing) return;
    for (const waiter of waiters.values()) waiter.reject(new Error(`MCP exited with ${code ?? signal}: ${stderr}`));
    waiters.clear();
  });
  const responseFor = (id) => new Promise((resolveResponse, rejectResponse) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      rejectResponse(new Error(`Timed out waiting for MCP response ${id}`));
    }, 10_000);
    waiters.set(id, {
      resolve: (message) => { clearTimeout(timer); resolveResponse(message); },
      reject: (error) => { clearTimeout(timer); rejectResponse(error); },
    });
  });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const waiter = waiters.get(message.id);
    if (waiter) {
      waiters.delete(message.id);
      waiter.resolve(message);
    }
  });
  const request = async (id, method, params) => {
    const response = responseFor(id);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  };

  try {
    const initialize = await request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ambient-plugin-smoke", version: "0.1.0" },
    });
    if (initialize.error || initialize.result?.serverInfo?.name !== "ambient-project") throw new Error(`MCP initialize failed: ${JSON.stringify(initialize)}`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    const toolsList = await request(2, "tools/list", {});
    const toolNames = toolsList.result?.tools?.map((tool) => tool.name) ?? [];
    const expectedTools = ["list_projects", "get_binding", "open_project_panel", "ambient_project_panel_request", "bind_project", "change_binding", "decline_project_binding", "restore_project_binding", "record_project_events", "acknowledge_no_project_events"];
    if (toolsList.error || JSON.stringify(toolNames) !== JSON.stringify(expectedTools)) throw new Error(`MCP tools/list failed: ${JSON.stringify(toolsList)}`);
    const resourcesList = await request(3, "resources/list", {});
    if (resourcesList.error || !resourcesList.result?.resources?.some((resource) => resource.uri === "ui://ambient-project/panel/v1.html")) throw new Error(`MCP resources/list failed: ${JSON.stringify(resourcesList)}`);
    const resourceRead = await request(4, "resources/read", { uri: "ui://ambient-project/panel/v1.html" });
    const panelHtml = resourceRead.result?.contents?.[0]?.text ?? "";
    if (resourceRead.error || !panelHtml.includes("项目面板暂时不可用") || !panelHtml.includes("暂时无法加载项目面板，请稍后再试。") || panelHtml.includes("Waiting for Codex") || panelHtml.includes("Project panel unavailable") || panelHtml.includes("AMBIENT PROJECT LAYER")) throw new Error("Packaged MCP App resource did not load the generic error UI");
    const projects = await request(5, "tools/call", { name: "list_projects", arguments: {} });
    const projectList = JSON.parse(projects.result?.content?.[0]?.text ?? "null");
    if (projects.error || projectList?.[0]?.name !== "Demo Project") throw new Error(`Explicit fake MCP configuration did not provide the smoke project: ${JSON.stringify(projects)}`);
    const declined = await request(6, "tools/call", { name: "decline_project_binding", arguments: { cwd: join(smokeRoot, "unbound") } });
    const declinedPayload = JSON.parse(declined.result?.content?.[0]?.text ?? "null");
    if (declined.error || declinedPayload?.preference !== "declined") throw new Error(`MCP decline_project_binding failed: ${JSON.stringify(declined)}`);
    const restored = await request(7, "tools/call", { name: "restore_project_binding", arguments: { cwd: join(smokeRoot, "unbound") } });
    const restoredPayload = JSON.parse(restored.result?.content?.[0]?.text ?? "null");
    if (restored.error || restoredPayload?.restored !== true) throw new Error(`MCP restore_project_binding failed: ${JSON.stringify(restored)}`);
    const bound = await request(8, "tools/call", { name: "bind_project", arguments: { cwd: smokeRoot, planeBaseUrl: "https://api.plane.so", workspaceSlug: "smoke-workspace", planeProjectId: "demo-project", planeProjectName: "Demo Project", autoCaptureEnabled: true } });
    if (bound.error) throw new Error(`MCP bind_project failed: ${JSON.stringify(bound)}`);
    const reviewed = await request(9, "tools/call", { name: "acknowledge_no_project_events", arguments: { projectContextId: "project_1", sessionId: "smoke-session", turnId: "smoke-turn" } });
    const reviewPayload = JSON.parse(reviewed.result?.content?.[0]?.text ?? "null");
    if (reviewed.error || reviewPayload?.status !== "acknowledged" || reviewPayload?.duplicate !== false) throw new Error(`MCP acknowledge_no_project_events failed: ${JSON.stringify(reviewed)}`);
    const panel = await request(10, "tools/call", { name: "open_project_panel", arguments: { projectContextId: "project_1" } });
    const bootstrap = panel.result?._meta?.["ambient-project/bootstrap"];
    if (panel.error || !bootstrap?.serviceBaseUrl || !bootstrap?.sessionToken) throw new Error(`MCP open_project_panel failed: ${JSON.stringify(panel)}`);
    const bridgedSummaryResponse = await request(11, "tools/call", { name: "ambient_project_panel_request", arguments: { method: "GET", path: "/api/projects/project_1/summary" } });
    const bridgedSummary = JSON.parse(bridgedSummaryResponse.result?.content?.[0]?.text ?? "null");
    if (bridgedSummaryResponse.error || bridgedSummaryResponse.result?.isError || bridgedSummary?.context?.id !== "project_1") throw new Error(`MCP panel server-tool bridge failed: ${JSON.stringify(bridgedSummaryResponse)}`);
    if (bridgedSummary.projectCounts?.total !== 0 || Object.values(bridgedSummary.projectCounts?.byStatus ?? {}).reduce((total, count) => total + count, 0) !== 0) throw new Error(`MCP panel summary did not expose authoritative project counts: ${JSON.stringify(bridgedSummary.projectCounts)}`);
    const summaryResponse = await fetch(`${bootstrap.serviceBaseUrl}/api/projects/project_1/summary`, { headers: { Origin: "https://web-sandbox.oaiusercontent.com", "X-Ambient-Session-Token": bootstrap.sessionToken } });
    if (summaryResponse.status !== 200 || summaryResponse.headers.get("access-control-allow-origin") !== "https://web-sandbox.oaiusercontent.com") throw new Error(`Dynamic BFF web-sandbox summary failed: ${summaryResponse.status} ${summaryResponse.headers.get("access-control-allow-origin")}`);
    const summary = await summaryResponse.json();
    if (summary.context?.id !== "project_1") throw new Error(`Dynamic BFF summary returned the wrong context: ${JSON.stringify(summary)}`);
    await stat(childEnv.AMBIENT_DB_PATH);
  } finally {
    closing = true;
    lines.close();
    await terminateChild(child);
  }
}

async function assertMissingConfigurationFails(entrypoint, command, smokeRoot) {
  const databasePath = join(smokeRoot, "missing configuration.sqlite");
  try {
    await runPluginCommand(command, [entrypoint], "", { AMBIENT_DB_PATH: databasePath, PLANE_MODE: "" }, smokeRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("PLANE_MODE is required")) throw new Error(`MCP failed for an unexpected reason: ${message}`);
    try {
      await stat(databasePath);
    } catch {
      return;
    }
    throw new Error(`MCP opened a database before rejecting missing configuration: ${databasePath}`);
  }
  throw new Error("MCP unexpectedly started without explicit Plane configuration");
}

async function assertStaticPackage(packageRoot, target) {
  const runtimeRoot = join(packageRoot, "runtime");
  const metadata = JSON.parse(await readFile(join(runtimeRoot, "runtime.json"), "utf8"));
  if (metadata.packageType !== "platform-specific" || metadata.target !== target.id || metadata.platform !== target.platform || metadata.arch !== target.arch || metadata.nodeVersion !== "22.22.1" || metadata.sidecar !== target.sidecarRelativePath) {
    throw new Error(`Static package ${packageRoot} does not select ${target.id}: ${JSON.stringify(metadata)}`);
  }
  const mcpConfig = JSON.parse(await readFile(join(packageRoot, ".mcp.json"), "utf8"));
  const mcp = mcpConfig.mcpServers?.["ambient-project"];
  if (mcp?.command !== target.launcherRelativePath || mcp?.cwd !== "." || JSON.stringify(mcp?.args) !== JSON.stringify(["runtime/mcp/index.js"])) throw new Error(`Static package ${packageRoot} has the wrong MCP selection`);
  const hooksConfig = JSON.parse(await readFile(join(packageRoot, "hooks", "hooks.json"), "utf8"));
  const handlers = Object.values(hooksConfig.hooks ?? {}).flatMap((groups) => groups.flatMap((group) => group.hooks ?? []));
  const expectedHookCommand = `"${"${PLUGIN_ROOT}"}/${target.launcherRelativePath}" "${"${PLUGIN_ROOT}"}/runtime/hook-adapter/index.js"`;
  if (handlers.length !== 5 || handlers.some((handler) => handler.command !== expectedHookCommand)) throw new Error(`Static package ${packageRoot} has the wrong Hook selection`);
  const launcher = join(runtimeRoot, "bin", target.launcherFile);
  await stat(join(runtimeRoot, target.sidecarRelativePath.replace("runtime/", "")));
  await stat(join(runtimeRoot, "LICENSE.nodejs"));
  if (await readFile(launcher, "utf8") !== renderLauncher(target)) throw new Error(`Static package ${packageRoot} does not enforce ${target.id}`);
}

async function smokeStaticTargetSelection() {
  const hostTarget = getNodeSidecarTargetForHost();
  for (const targetId of NODE_SIDECAR_TARGET_IDS) {
    const target = getNodeSidecarTarget(targetId);
    const launcher = renderLauncher(target);
    if (!launcher.includes(target.id) || !launcher.includes(target.sidecarFile)) throw new Error(`Static launcher selection is incomplete for ${target.id}`);
  }
  const collectionRoot = join(root, "dist", "plugins", "ambient-project-layer");
  try {
    await stat(collectionRoot);
  } catch {
    return `matrix static (${NODE_SIDECAR_TARGET_IDS.filter((targetId) => targetId !== hostTarget.id).length} non-native target selections)`;
  }
  for (const targetId of NODE_SIDECAR_TARGET_IDS) {
    const targetRoot = join(collectionRoot, targetId);
    await stat(targetRoot);
    await assertStaticPackage(targetRoot, getNodeSidecarTarget(targetId));
  }
  return `matrix static and packaged (${NODE_SIDECAR_TARGET_IDS.filter((targetId) => targetId !== hostTarget.id).length} non-native packages)`;
}

const smokeRoot = await mkdtemp(join(tmpdir(), "ambient plugin smoke-"));
const isolatedPlugin = join(smokeRoot, "plugin");
isolatedPath = await mkdtemp(join(smokeRoot, "empty-path-"));
await cp(sourcePlugin, isolatedPlugin, { recursive: true });

try {
  const staticSelection = await smokeStaticTargetSelection();
  const manifest = JSON.parse(await readFile(join(isolatedPlugin, ".codex-plugin", "plugin.json"), "utf8"));
  const runtimeMetadata = JSON.parse(await readFile(join(isolatedPlugin, "runtime", "runtime.json"), "utf8"));
  const target = getNodeSidecarTarget(runtimeMetadata.target);
  if (target.platform !== process.platform || target.arch !== process.arch) throw new Error(`Native plugin smoke must use the host target, found ${target.id} on ${process.platform}/${process.arch}`);
  if (!manifest.interface?.longDescription?.includes("platform-specific")) throw new Error("Plugin manifest must describe platform-specific packages");
  if (Object.hasOwn(manifest, "hooks")) throw new Error("Manifest must rely on default hooks/hooks.json discovery");
  const mcpConfig = JSON.parse(await readFile(join(isolatedPlugin, ".mcp.json"), "utf8"));
  const mcpServer = mcpConfig.mcpServers["ambient-project"];
  if (Object.hasOwn(mcpServer, "env")) throw new Error("Formal MCP entrypoint must forward host environment variables through env_vars");
  if (JSON.stringify(mcpServer.env_vars) !== JSON.stringify(["AMBIENT_DB_PATH", "PLANE_MODE", "PLANE_BASE_URL", "PLANE_API_KEY", "PLANE_WORKSPACE_SLUG"])) throw new Error("Formal MCP entrypoint must forward the required host environment variables");
  if (mcpServer.env_vars.includes("AMBIENT_SERVICE_BASE_URL") || mcpServer.env_vars.includes("AMBIENT_SESSION_TOKEN")) throw new Error("Formal MCP entrypoint must own its dynamic service session");
  if (mcpServer.command !== target.launcherRelativePath) throw new Error(`MCP command must use the packaged sidecar launcher: ${mcpServer.command}`);
  const mcpArg = mcpServer.args[0];
  if (mcpServer.cwd !== ".") throw new Error(`MCP cwd must resolve to the plugin root: ${mcpServer.cwd}`);
  if (mcpArg.includes("..")) throw new Error(`MCP command escapes plugin root: ${mcpArg}`);
  const mcpEntrypoint = assertInside(isolatedPlugin, join(isolatedPlugin, mcpArg));
  const hookEntrypoint = assertInside(isolatedPlugin, join(isolatedPlugin, "runtime", "hook-adapter", "index.js"));
  const mcpCommand = assertInside(isolatedPlugin, join(isolatedPlugin, mcpServer.command));
  await stat(mcpEntrypoint);
  await stat(hookEntrypoint);
  await stat(mcpCommand);
  await stat(join(isolatedPlugin, "runtime", "bin", target.sidecarFile));
  await stat(join(isolatedPlugin, "runtime", "LICENSE.nodejs"));
  await stat(join(isolatedPlugin, "runtime", "runtime.json"));
  await stat(join(isolatedPlugin, "panel", "dist", "index.html"));
  try {
    await stat(join(isolatedPlugin, "runtime", "node_modules", "better-sqlite3"));
    throw new Error("Packaged runtime must not contain better-sqlite3");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const hooksConfig = JSON.parse(await readFile(join(isolatedPlugin, "hooks", "hooks.json"), "utf8"));
  if (JSON.stringify(Object.keys(hooksConfig)) !== JSON.stringify(["hooks"])) throw new Error("Hook config must use the current Codex top-level schema");
  if (hooksConfig.hooks.PostToolUse?.[0]?.matcher !== "^mcp__ambient_project__(list_projects|record_project_events|acknowledge_no_project_events|decline_project_binding|restore_project_binding)$") throw new Error("PostToolUse must match the host MCP project workflow tools");
  const handlers = Object.values(hooksConfig.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
  const expectedHookCommand = `"${"${PLUGIN_ROOT}"}/${target.launcherRelativePath}" "${"${PLUGIN_ROOT}"}/runtime/hook-adapter/index.js"`;
  if (handlers.length !== 5 || handlers.some((handler) => handler.command !== expectedHookCommand || Object.hasOwn(handler, "statusMessage"))) {
    throw new Error("Hook commands are not self-contained and silent");
  }

  const databasePath = join(smokeRoot, "hook database.sqlite");
  const pluginData = join(smokeRoot, "plugin data");
  const ignoredDatabasePath = join(smokeRoot, "ignored hook database.sqlite");
  const hookCommand = handlers[0].command.replaceAll("${PLUGIN_ROOT}", isolatedPlugin);
  const runHook = (fixture, env) => runPluginCommand("/bin/sh", ["-c", hookCommand], fixture, { ...env, PLUGIN_ROOT: isolatedPlugin }, isolatedPlugin);
  const missingHookDb = await runHook(fixtures.UserPromptSubmit, { AMBIENT_DB_PATH: "", PLUGIN_DATA: "", CLAUDE_PLUGIN_DATA: "" });
  const missingHookPayload = JSON.parse(missingHookDb.stdout);
  if (!missingHookPayload.hookSpecificOutput?.additionalContext?.includes("temporarily unavailable")) throw new Error("Hook must fail open without creating a fallback database");
  await runHook(fixtures.SessionStart, { AMBIENT_DB_PATH: ignoredDatabasePath, PLUGIN_DATA: pluginData, CLAUDE_PLUGIN_DATA: "" });
  await stat(join(pluginData, "ambient.sqlite"));
  try {
    await stat(ignoredDatabasePath);
    throw new Error("Hook must prefer the stable PLUGIN_DATA database over AMBIENT_DB_PATH");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const [eventName, fixture] of Object.entries(fixtures)) {
    const result = await runHook(fixture, { AMBIENT_DB_PATH: databasePath });
    const payload = JSON.parse(result.stdout);
    if (["SessionStart", "UserPromptSubmit"].includes(eventName) && payload.hookSpecificOutput?.hookEventName !== eventName) throw new Error(`${eventName} fixture did not return hookSpecificOutput`);
    if (eventName === "Stop" && JSON.stringify(payload) !== "{}") throw new Error("Stop fixture must return a silent empty response");
  }
  await assertMissingConfigurationFails(mcpEntrypoint, mcpCommand, smokeRoot);
  await smokeMcp(mcpEntrypoint, smokeRoot, isolatedPlugin);
  console.log(`Plugin isolation smoke passed: ${target.id} sidecar, ${staticSelection}, PATH without node/pnpm/bun, explicit fake MCP configuration, missing-config failure, App resources, open_project_panel server-tool bridge and web-sandbox summary, record-or-ack MCP tools, and five Hook fixtures.`);
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}
