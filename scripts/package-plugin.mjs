import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(root, "plugin");
const runtimeRoot = join(pluginRoot, "runtime");
const runtimeNodeModules = join(runtimeRoot, "node_modules");
const panelRoot = join(pluginRoot, "panel");

await rm(runtimeRoot, { recursive: true, force: true });
await rm(panelRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);

const bundleOptions = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["better-sqlite3", "@makeplane/plane-node-sdk", "fastify", "@fastify/cors"],
  legalComments: "none",
  sourcemap: false,
};

await Promise.all([
  build({ ...bundleOptions, entryPoints: [join(root, "apps/mcp/dist/main.js")], outfile: join(runtimeRoot, "mcp/index.js") }),
  build({ ...bundleOptions, entryPoints: [join(root, "apps/hook-adapter/dist/index.js")], outfile: join(runtimeRoot, "hook-adapter/index.js") }),
]);
await cp(join(root, "apps/panel/dist"), join(panelRoot, "dist"), { recursive: true });

const storageRequire = createRequire(join(root, "packages/storage/package.json"));
const sqlitePackageJson = storageRequire.resolve("better-sqlite3/package.json");
const sqliteRoot = dirname(sqlitePackageJson);
const sqliteRequire = createRequire(sqlitePackageJson);

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

await mkdir(join(runtimeNodeModules, "better-sqlite3", "lib"), { recursive: true });
await mkdir(join(runtimeNodeModules, "better-sqlite3", "build", "Release"), { recursive: true });
await cp(join(sqliteRoot, "lib"), join(runtimeNodeModules, "better-sqlite3", "lib"), {
  recursive: true,
  filter: (source) => runtimeFileFilter(join(sqliteRoot, "lib"), source),
});
await cp(join(sqliteRoot, "package.json"), join(runtimeNodeModules, "better-sqlite3", "package.json"));
await cp(join(sqliteRoot, "build", "Release", "better_sqlite3.node"), join(runtimeNodeModules, "better-sqlite3", "build", "Release", "better_sqlite3.node"));

for (const packageName of ["bindings", "file-uri-to-path"]) {
  const packageJson = sqliteRequire.resolve(`${packageName}/package.json`);
  const packageRoot = dirname(packageJson);
  await cp(packageRoot, join(runtimeNodeModules, packageName), {
    recursive: true,
    filter: (source) => runtimeFileFilter(packageRoot, source),
  });
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
await normalizeRuntimeText(runtimeRoot);

const manifest = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const mcpBundleSize = (await stat(join(runtimeRoot, "mcp/index.js"))).size.toLocaleString();
const hookBundleSize = (await stat(join(runtimeRoot, "hook-adapter/index.js"))).size.toLocaleString();
console.log(`Packaged ambient-project-layer ${manifest.version}: MCP ${mcpBundleSize} B, Hook ${hookBundleSize} B, native sqlite runtime included.`);
