import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getNodeSidecarTarget,
  NODE_SIDECAR_TARGET_IDS,
  NODE_SIDECAR_VERSION,
  renderLauncher,
} from "./node-sidecar-targets.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const execFile = promisify(execFileCallback);

function parseArguments(argumentsList) {
  const positional = argumentsList.filter((argument) => !argument.startsWith("--"));
  if (argumentsList.some((argument) => argument !== "--all" && argument.startsWith("--"))) throw new Error(`Unknown validation option: ${argumentsList.find((argument) => argument !== "--all" && argument.startsWith("--"))}`);
  return { root: resolve(positional[0] ?? "plugin"), all: argumentsList.includes("--all") };
}

async function collectFiles(directory) {
  const files = [];
  async function collect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await collect(path);
      else files.push(path);
    }
  }
  await collect(directory);
  return files;
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function validatePackage(pluginRoot, { executeNative = true } = {}) {
  const runtimeRoot = join(pluginRoot, "runtime");
  const mcpConfig = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
  const hooksConfig = JSON.parse(await readFile(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  if (manifest.name !== "ambient-project-layer" || manifest.version !== releaseVersion || manifest.author?.name !== "Wenyan Wei" || manifest.interface?.displayName !== "Ambient Project Layer") throw new Error(`${pluginRoot}: manifest product metadata is inconsistent`);
  if (!manifest.interface?.longDescription?.includes("platform-specific")) throw new Error(`${pluginRoot}: manifest must describe platform-specific packages`);
  if (!manifest.interface?.longDescription?.includes("Windows x64")) throw new Error(`${pluginRoot}: manifest must list the Windows x64 target`);
  for (const legalFile of [join(pluginRoot, "LICENSE"), join(pluginRoot, "THIRD_PARTY_NOTICES.md")]) {
    if ((await stat(legalFile)).size === 0) throw new Error(`${pluginRoot}: release legal file is empty: ${legalFile}`);
  }

  const metadata = JSON.parse(await readFile(join(runtimeRoot, "runtime.json"), "utf8"));
  if (!NODE_SIDECAR_TARGET_IDS.includes(metadata.target)) throw new Error(`${pluginRoot}: runtime manifest has unsupported target ${metadata.target}`);
  const target = getNodeSidecarTarget(metadata.target);
  if (metadata.packageType !== "platform-specific" || metadata.platform !== target.platform || metadata.arch !== target.arch || metadata.nodeVersion !== NODE_SIDECAR_VERSION || metadata.sidecar !== target.sidecarRelativePath || metadata.sqlite !== "node:sqlite") {
    throw new Error(`${pluginRoot}: runtime manifest does not match ${target.id}`);
  }

  const mcpServer = mcpConfig.mcpServers?.["ambient-project"];
  if (!mcpServer || mcpServer.command !== target.launcherRelativePath || JSON.stringify(mcpServer.args) !== JSON.stringify(["runtime/mcp/index.js"]) || mcpServer.cwd !== ".") {
    throw new Error(`${pluginRoot}: MCP must use ${target.launcherRelativePath} from the plugin root`);
  }
  if (Object.hasOwn(mcpServer, "env")) throw new Error(`${pluginRoot}: MCP must not embed environment values`);
  if (JSON.stringify(mcpServer.env_vars) !== JSON.stringify(["AMBIENT_DB_PATH", "PLANE_MODE", "PLANE_BASE_URL", "PLANE_API_KEY", "PLANE_WORKSPACE_SLUG"])) throw new Error(`${pluginRoot}: MCP env_vars are not the formal allowlist`);

  const expectedHookCommand = `"${"${PLUGIN_ROOT}"}/${target.launcherRelativePath}" "${"${PLUGIN_ROOT}"}/runtime/hook-adapter/index.js"`;
  const expectedEvents = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"];
  if (JSON.stringify(Object.keys(hooksConfig.hooks ?? {})) !== JSON.stringify(expectedEvents)) throw new Error(`${pluginRoot}: hook config must contain all five supported events`);
  const handlers = Object.values(hooksConfig.hooks ?? {}).flatMap((groups) => groups.flatMap((group) => group.hooks ?? []));
  if (handlers.length !== 5 || handlers.some((handler) => handler.command !== expectedHookCommand)) throw new Error(`${pluginRoot}: all five hooks must use ${target.launcherRelativePath}`);
  if (handlers.some((handler) => Object.hasOwn(handler, "statusMessage"))) throw new Error(`${pluginRoot}: hooks must remain silent`);
  if (hooksConfig.hooks?.PostToolUse?.[0]?.matcher !== "^mcp__ambient_project__(list_projects|record_project_events|acknowledge_no_project_events|decline_project_binding|restore_project_binding)$") throw new Error(`${pluginRoot}: PostToolUse must cover project workflow tools`);

  const sidecar = join(runtimeRoot, "bin", target.sidecarFile);
  const launcher = join(runtimeRoot, "bin", target.launcherFile);
  const missingLauncher = join(runtimeRoot, "bin", target.platform === "win32" ? "ambient-node" : "ambient-node.cmd");
  await access(sidecar, target.platform === "win32" ? constants.F_OK : constants.X_OK);
  await access(launcher, target.platform === "win32" ? constants.F_OK : constants.X_OK);
  try {
    await access(missingLauncher, constants.F_OK);
    throw new Error(`${pluginRoot}: package contains the wrong platform launcher ${missingLauncher}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const launcherText = await readFile(launcher, "utf8");
  if (launcherText !== renderLauncher(target)) throw new Error(`${pluginRoot}: launcher does not enforce ${target.id} or does not invoke its internal sidecar`);
  if ((await stat(sidecar)).size === 0 || (await stat(join(runtimeRoot, "LICENSE.nodejs"))).size === 0) throw new Error(`${pluginRoot}: sidecar and Node license must be non-empty`);
  for (const dependencyLicense of ["@makeplane/plane-node-sdk/LICENSE", "fastify/LICENSE", "@fastify/cors/LICENSE"]) {
    if ((await stat(join(runtimeRoot, "node_modules", dependencyLicense))).size === 0) throw new Error(`${pluginRoot}: runtime dependency license is empty: ${dependencyLicense}`);
  }
  if (!(await readFile(join(runtimeRoot, "mcp/index.js"), "utf8")).includes("acknowledge_no_project_events")) throw new Error(`${pluginRoot}: packaged MCP runtime must expose acknowledge_no_project_events`);

  const runtimeFiles = await collectFiles(runtimeRoot);
  if (runtimeFiles.some((path) => path.endsWith(".node") || path.includes("better-sqlite3"))) throw new Error(`${pluginRoot}: packaged runtime must not contain a native SQLite ABI artifact`);
  if (runtimeFiles.some((path) => path.split(/[\\/]/).some((part) => part === "benchmark" || part === "benchmarks"))) throw new Error(`${pluginRoot}: packaged runtime must not contain dependency benchmark fixtures`);
  if (mcpServer.command === "node" || handlers.some((handler) => handler.command === "node")) throw new Error(`${pluginRoot}: runtime must not fall back to a system Node command`);

  const isNative = target.platform === process.platform && target.arch === process.arch;
  if (executeNative && isNative) {
    const { stdout } = await execFile(sidecar, ["--version"]);
    if (stdout.trim() !== `v${NODE_SIDECAR_VERSION}`) throw new Error(`${pluginRoot}: packaged Node sidecar is ${stdout.trim()}, expected v${NODE_SIDECAR_VERSION}`);
    return `native ${target.id}`;
  }
  return `static ${target.id}`;
}

const options = parseArguments(process.argv.slice(2));
const roots = [];
if (options.all) {
  if (!(await isDirectory(options.root))) throw new Error(`Validation collection does not exist: ${options.root}`);
  for (const targetId of NODE_SIDECAR_TARGET_IDS) roots.push(join(options.root, targetId));
} else {
  roots.push(options.root);
}

const results = [];
for (const pluginRoot of roots) results.push(await validatePackage(pluginRoot));
process.stdout.write(`Plugin runtime valid: ${results.join(", ")}, version ${releaseVersion}, project and dependency licenses, Node ${NODE_SIDECAR_VERSION} sidecar, no native SQLite module.\n`);
