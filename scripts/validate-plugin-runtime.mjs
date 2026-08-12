import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_SIDECAR_PLATFORM, NODE_SIDECAR_VERSION } from "./fetch-node-sidecar.mjs";

const execFile = promisify(execFileCallback);
const pluginRoot = resolve(process.argv[2] ?? "plugin");
const runtimeRoot = join(pluginRoot, "runtime");
const mcpConfig = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
const hooksConfig = JSON.parse(await readFile(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));

if (!manifest.interface?.longDescription?.includes("macOS arm64")) throw new Error("Manifest must state the macOS arm64 runtime restriction");
if (mcpConfig.mcpServers?.["ambient-project"]?.command !== "runtime/bin/ambient-node") throw new Error("MCP must use the packaged sidecar entrypoint");
if (mcpConfig.mcpServers?.["ambient-project"]?.cwd !== ".") throw new Error("MCP must resolve its command from the plugin root");
const expectedHookCommand = '"${PLUGIN_ROOT}/runtime/bin/ambient-node" "${PLUGIN_ROOT}/runtime/hook-adapter/index.js"';
const handlers = Object.values(hooksConfig.hooks ?? {}).flatMap((groups) => groups.flatMap((group) => group.hooks ?? []));
if (handlers.length !== 5 || handlers.some((handler) => handler.command !== expectedHookCommand)) throw new Error("All five hooks must use the packaged sidecar entrypoint");

const sidecar = join(runtimeRoot, "bin", "node");
const entrypoint = join(runtimeRoot, "bin", "ambient-node");
await access(sidecar, constants.X_OK);
await access(entrypoint, constants.X_OK);
const metadata = JSON.parse(await readFile(join(runtimeRoot, "runtime.json"), "utf8"));
if (metadata.platform !== "darwin" || metadata.arch !== "arm64" || metadata.nodeVersion !== NODE_SIDECAR_VERSION) throw new Error(`Packaged runtime must declare ${NODE_SIDECAR_PLATFORM} Node ${NODE_SIDECAR_VERSION}`);
const { stdout } = await execFile(sidecar, ["--version"]);
if (stdout.trim() !== `v${NODE_SIDECAR_VERSION}`) throw new Error(`Packaged Node sidecar is ${stdout.trim()}, expected v${NODE_SIDECAR_VERSION}`);

const runtimeFiles = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else runtimeFiles.push(path);
  }
}
await collect(runtimeRoot);
if (runtimeFiles.some((path) => path.endsWith(".node") || path.includes("better-sqlite3"))) throw new Error("Packaged runtime must not contain a better-sqlite3 native ABI artifact");
process.stdout.write(`Plugin runtime valid: macOS arm64, Node ${NODE_SIDECAR_VERSION}, internal sidecar, no native SQLite module.\n`);
