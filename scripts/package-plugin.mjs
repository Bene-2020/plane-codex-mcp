import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ensureNodeSidecar, nodeSidecarLicensePath, nodeSidecarPath, NODE_SIDECAR_PLATFORM, NODE_SIDECAR_VERSION } from "./fetch-node-sidecar.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(root, "plugin");
const runtimeRoot = join(pluginRoot, "runtime");
const runtimeNodeModules = join(runtimeRoot, "node_modules");
const panelRoot = join(pluginRoot, "panel");

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error(`Plugin packaging currently supports macOS arm64 only; found ${process.platform}/${process.arch}.`);
await ensureNodeSidecar();
await rm(runtimeRoot, { recursive: true, force: true });
await rm(panelRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);

const bundleOptions = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["@makeplane/plane-node-sdk", "fastify", "@fastify/cors"],
  legalComments: "none",
  sourcemap: false,
};

await Promise.all([
  build({ ...bundleOptions, entryPoints: [join(root, "apps/mcp/dist/main.js")], outfile: join(runtimeRoot, "mcp/index.js") }),
  build({ ...bundleOptions, entryPoints: [join(root, "apps/hook-adapter/dist/index.js")], outfile: join(runtimeRoot, "hook-adapter/index.js") }),
]);
await cp(join(root, "apps/panel/dist"), join(panelRoot, "dist"), { recursive: true });

function runtimeFileFilter(packageRoot, source) {
  const relativeSource = relative(packageRoot, source);
  const pathParts = relativeSource.split(sep);
  const fileName = pathParts.at(-1);
  if (pathParts.includes("node_modules") || ["test", "tests", "__tests__"].some((part) => pathParts.includes(part))) return false;
  if (fileName === "tsconfig.json" || fileName === "bench.js" || fileName === "eslint.config.mjs") return false;
  if (statSync(source).isDirectory()) return true;
  return [".cjs", ".js", ".json", ".mjs", ".node"].includes(source.endsWith(".node") ? ".node" : source.slice(source.lastIndexOf(".")));
}

async function normalizeRuntimeText(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeRuntimeText(source);
      continue;
    }
    if (!entry.isFile() || ![".cjs", ".js", ".json", ".mjs"].includes(source.slice(source.lastIndexOf(".")))) continue;
    const original = await readFile(source, "utf8");
    const normalized = original.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n+$/g, "\n");
    if (normalized !== original) await writeFile(source, normalized);
  }
}

const planeRequire = createRequire(join(root, "packages/plane/package.json"));
const serviceRequire = createRequire(join(root, "apps/service/package.json"));
const copiedRuntimePackages = new Set();
function findPackageJson(requesterRequire, packageName) {
  for (const searchPath of requesterRequire.resolve.paths(packageName) ?? []) {
    const packageJson = join(searchPath, packageName, "package.json");
    if (existsSync(packageJson)) return packageJson;
  }
  let current = dirname(requesterRequire.resolve(packageName));
  while (true) {
    const packageJson = join(current, "package.json");
    if (existsSync(packageJson)) return packageJson;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Cannot find package.json for ${packageName}`);
    current = parent;
  }
}

async function copyRuntimePackage(packageName, requesterRequire) {
  if (copiedRuntimePackages.has(packageName)) return;
  copiedRuntimePackages.add(packageName);
  const packageJson = realpathSync(findPackageJson(requesterRequire, packageName));
  const packageRoot = dirname(packageJson);
  const packageTarget = join(runtimeNodeModules, packageName);
  const packageInfo = JSON.parse(await readFile(packageJson, "utf8"));
  await cp(packageRoot, packageTarget, {
    recursive: true,
    filter: (source) => runtimeFileFilter(packageRoot, source),
  });
  const packageRequire = createRequire(packageJson);
  for (const dependencyName of Object.keys(packageInfo.dependencies ?? {})) {
    if (dependencyName !== "ts-jest") await copyRuntimePackage(dependencyName, packageRequire);
  }
}

await copyRuntimePackage("@makeplane/plane-node-sdk", planeRequire);
await copyRuntimePackage("fastify", serviceRequire);
await copyRuntimePackage("@fastify/cors", serviceRequire);
await mkdir(join(runtimeRoot, "bin"), { recursive: true });
await cp(nodeSidecarPath, join(runtimeRoot, "bin", "node"));
await chmod(join(runtimeRoot, "bin", "node"), 0o755);
await cp(join(root, "scripts", "ambient-node"), join(runtimeRoot, "bin", "ambient-node"));
await chmod(join(runtimeRoot, "bin", "ambient-node"), 0o755);
await cp(nodeSidecarLicensePath, join(runtimeRoot, "LICENSE.nodejs"));
await writeFile(join(runtimeRoot, "runtime.json"), `${JSON.stringify({ platform: "darwin", arch: "arm64", nodeVersion: NODE_SIDECAR_VERSION, sqlite: "node:sqlite" }, null, 2)}\n`);
await normalizeRuntimeText(runtimeRoot);

const manifest = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const mcpBundleSize = (await stat(join(runtimeRoot, "mcp/index.js"))).size.toLocaleString();
const hookBundleSize = (await stat(join(runtimeRoot, "hook-adapter/index.js"))).size.toLocaleString();
console.log(`Packaged ambient-project-layer ${manifest.version}: MCP ${mcpBundleSize} B, Hook ${hookBundleSize} B, ${NODE_SIDECAR_PLATFORM} Node ${NODE_SIDECAR_VERSION} sidecar included; SQLite uses node:sqlite.`);
