import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function runNode(entrypoint, input, env) {
  return new Promise((resolveResult, reject) => {
    const childEnv = { ...process.env, ...env };
    delete childEnv.NODE_PATH;
    const child = spawn(process.execPath, [entrypoint], { cwd: dirname(entrypoint), env: childEnv });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out running ${entrypoint}`));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${entrypoint} exited with ${code ?? signal}: ${stderr}`));
      else resolveResult({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function smokeMcp(entrypoint, smokeRoot) {
  const childEnv = { ...process.env, AMBIENT_DB_PATH: join(smokeRoot, "mcp database.sqlite") };
  delete childEnv.NODE_PATH;
  const child = spawn(process.execPath, [entrypoint], { cwd: smokeRoot, env: childEnv });
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
    const expectedTools = ["list_projects", "get_binding", "open_project_panel", "bind_project", "change_binding", "record_project_events"];
    if (toolsList.error || JSON.stringify(toolNames) !== JSON.stringify(expectedTools)) throw new Error(`MCP tools/list failed: ${JSON.stringify(toolsList)}`);
    const resourcesList = await request(3, "resources/list", {});
    if (resourcesList.error || !resourcesList.result?.resources?.some((resource) => resource.uri === "ui://ambient-project/panel/v1.html")) throw new Error(`MCP resources/list failed: ${JSON.stringify(resourcesList)}`);
    const resourceRead = await request(4, "resources/read", { uri: "ui://ambient-project/panel/v1.html" });
    if (resourceRead.error || !resourceRead.result?.contents?.[0]?.text?.includes("AMBIENT PROJECT LAYER")) throw new Error("Packaged MCP App resource did not load");
  } finally {
    closing = true;
    lines.close();
    child.kill("SIGTERM");
  }
}

const smokeRoot = await mkdtemp(join(tmpdir(), "ambient plugin smoke-"));
const isolatedPlugin = join(smokeRoot, "plugin");
await cp(sourcePlugin, isolatedPlugin, { recursive: true });

try {
  const manifest = JSON.parse(await readFile(join(isolatedPlugin, ".codex-plugin", "plugin.json"), "utf8"));
  if (Object.hasOwn(manifest, "hooks")) throw new Error("Manifest must rely on default hooks/hooks.json discovery");
  const mcpConfig = JSON.parse(await readFile(join(isolatedPlugin, ".mcp.json"), "utf8"));
  const mcpEnv = mcpConfig.mcpServers["ambient-project"].env ?? {};
  if (Object.hasOwn(mcpEnv, "AMBIENT_SERVICE_BASE_URL") || Object.hasOwn(mcpEnv, "AMBIENT_SESSION_TOKEN")) throw new Error("Formal MCP entrypoint must own its dynamic service session");
  const mcpArg = mcpConfig.mcpServers["ambient-project"].args[0];
  if (mcpArg.includes("..")) throw new Error(`MCP command escapes plugin root: ${mcpArg}`);
  const mcpEntrypoint = assertInside(isolatedPlugin, mcpArg.replace("${PLUGIN_ROOT}", isolatedPlugin));
  const hookEntrypoint = assertInside(isolatedPlugin, join(isolatedPlugin, "runtime", "hook-adapter", "index.js"));
  await stat(mcpEntrypoint);
  await stat(hookEntrypoint);
  await stat(join(isolatedPlugin, "panel", "dist", "index.html"));
  await stat(join(isolatedPlugin, "runtime", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"));

  const hooksConfig = JSON.parse(await readFile(join(isolatedPlugin, "hooks", "hooks.json"), "utf8"));
  const handlers = Object.values(hooksConfig.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
  if (handlers.length !== 5 || handlers.some((handler) => handler.command !== 'node "${PLUGIN_ROOT}/runtime/hook-adapter/index.js"' || Object.hasOwn(handler, "statusMessage"))) {
    throw new Error("Hook commands are not self-contained and silent");
  }

  const databasePath = join(smokeRoot, "hook database.sqlite");
  for (const [eventName, fixture] of Object.entries(fixtures)) {
    const result = await runNode(hookEntrypoint, fixture, { AMBIENT_DB_PATH: databasePath });
    const payload = JSON.parse(result.stdout);
    if (["SessionStart", "UserPromptSubmit"].includes(eventName) && payload.hookSpecificOutput?.hookEventName !== eventName) throw new Error(`${eventName} fixture did not return hookSpecificOutput`);
  }
  await smokeMcp(mcpEntrypoint, smokeRoot);
  console.log("Plugin isolation smoke passed: plugin-only copy, MCP initialize/tools/resources, packaged App resource, and five Hook fixtures.");
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}
