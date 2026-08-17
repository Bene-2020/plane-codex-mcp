import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ensureNodeSidecar } from "./fetch-node-sidecar.mjs";
import {
  getNodeSidecarTarget,
  getNodeSidecarTargetForHost,
  NODE_SIDECAR_TARGETS,
  NODE_SIDECAR_VERSION,
  renderLauncher,
} from "./node-sidecar-targets.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcePluginRoot = join(root, "plugin");
const panelSourceRoot = join(root, "apps/panel/dist");
const manifest = JSON.parse(await readFile(join(sourcePluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const sourceHooks = JSON.parse(await readFile(join(sourcePluginRoot, "hooks", "hooks.json"), "utf8"));

function parseArguments(argumentsList) {
  const options = { all: false, targetId: undefined, output: undefined };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;
    if (argument === "--all") {
      options.all = true;
      continue;
    }
    if (argument === "--target") {
      options.targetId = argumentsList[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--target=")) {
      options.targetId = argument.slice("--target=".length);
      continue;
    }
    if (argument === "--output") {
      options.output = argumentsList[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
      continue;
    }
    throw new Error(`Unknown package option: ${argument}`);
  }
  if (options.all && options.targetId) throw new Error("Use either --all or --target, not both.");
  if (options.all && options.output && options.output.endsWith(".zip")) throw new Error("--output for --all must be a directory containing platform packages.");
  return options;
}

const options = parseArguments(process.argv.slice(2));
const hostTarget = getNodeSidecarTargetForHost();
const selectedTargets = options.all
  ? NODE_SIDECAR_TARGETS
  : [options.targetId ? getNodeSidecarTarget(options.targetId) : hostTarget];
const defaultCollectionRoot = join(root, "dist", "plugins", manifest.name);
const outputRoot = options.output ? resolve(options.output) : options.all ? defaultCollectionRoot : options.targetId && selectedTargets[0].id !== hostTarget.id ? join(defaultCollectionRoot, selectedTargets[0].id) : sourcePluginRoot;

const bundleOptions = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["@makeplane/plane-node-sdk", "fastify", "@fastify/cors"],
  legalComments: "none",
  sourcemap: false,
};

function runtimeFileFilter(packageRoot, source) {
  const relativeSource = relative(packageRoot, source);
  const pathParts = relativeSource.split(sep);
  const fileName = pathParts.at(-1);
  if (pathParts.includes("node_modules") || ["test", "tests", "__tests__", "benchmark", "benchmarks"].some((part) => pathParts.includes(part))) return false;
  if (fileName === "tsconfig.json" || fileName === "bench.js" || fileName === "eslint.config.mjs") return false;
  if (statSync(source).isDirectory()) return true;
  if (/^(license|notice|copying)(\.|$)/i.test(fileName)) return true;
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

async function copyRuntimePackage(packageName, requesterRequire, runtimeNodeModules, copiedRuntimePackages) {
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
    if (dependencyName !== "ts-jest") await copyRuntimePackage(dependencyName, packageRequire, runtimeNodeModules, copiedRuntimePackages);
  }
}

async function copyPluginScaffold(destinationPluginRoot) {
  await rm(destinationPluginRoot, { recursive: true, force: true });
  await mkdir(destinationPluginRoot, { recursive: true });
  for (const entry of await readdir(sourcePluginRoot, { withFileTypes: true })) {
    if (entry.name === "runtime" || entry.name === "panel") continue;
    await cp(join(sourcePluginRoot, entry.name), join(destinationPluginRoot, entry.name), { recursive: entry.isDirectory() });
  }
}

function targetMcpConfig(target) {
  return {
    mcpServers: {
      "ambient-project": {
        command: target.launcherRelativePath,
        args: ["runtime/mcp/index.js"],
        cwd: ".",
        env_vars: ["AMBIENT_DB_PATH", "PLANE_MODE", "PLANE_BASE_URL", "PLANE_API_KEY", "PLANE_WORKSPACE_SLUG"],
      },
    },
  };
}

function targetHooksConfig(target) {
  const command = `"${"${PLUGIN_ROOT}"}/${target.launcherRelativePath}" "${"${PLUGIN_ROOT}"}/runtime/hook-adapter/index.js"`;
  return {
    hooks: Object.fromEntries(Object.entries(sourceHooks.hooks).map(([eventName, groups]) => [
      eventName,
      groups.map((group) => ({
        ...group,
        hooks: group.hooks.map((hook) => ({ ...hook, command })),
      })),
    ])),
  };
}

async function packageTarget(target, destinationPluginRoot) {
  const inPlace = resolve(destinationPluginRoot) === resolve(sourcePluginRoot);
  if (inPlace) {
    await rm(join(destinationPluginRoot, "runtime"), { recursive: true, force: true });
    await rm(join(destinationPluginRoot, "panel"), { recursive: true, force: true });
  } else {
    await copyPluginScaffold(destinationPluginRoot);
  }
  await Promise.all([
    cp(join(root, "LICENSE"), join(destinationPluginRoot, "LICENSE")),
    cp(join(root, "THIRD_PARTY_NOTICES.md"), join(destinationPluginRoot, "THIRD_PARTY_NOTICES.md")),
  ]);

  const runtimeRoot = join(destinationPluginRoot, "runtime");
  const runtimeNodeModules = join(runtimeRoot, "node_modules");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  await mkdir(join(runtimeRoot, "mcp"), { recursive: true });
  await mkdir(join(runtimeRoot, "hook-adapter"), { recursive: true });

  await Promise.all([
    build({ ...bundleOptions, entryPoints: [join(root, "apps/mcp/dist/main.js")], outfile: join(runtimeRoot, "mcp/index.js") }),
    build({ ...bundleOptions, entryPoints: [join(root, "apps/hook-adapter/dist/index.js")], outfile: join(runtimeRoot, "hook-adapter/index.js") }),
  ]);
  await cp(panelSourceRoot, join(destinationPluginRoot, "panel", "dist"), { recursive: true });

  const copiedRuntimePackages = new Set();
  await copyRuntimePackage("@makeplane/plane-node-sdk", planeRequire, runtimeNodeModules, copiedRuntimePackages);
  await copyRuntimePackage("fastify", serviceRequire, runtimeNodeModules, copiedRuntimePackages);
  await copyRuntimePackage("@fastify/cors", serviceRequire, runtimeNodeModules, copiedRuntimePackages);

  const sidecar = await ensureNodeSidecar(target.id);
  const binRoot = join(runtimeRoot, "bin");
  await mkdir(binRoot, { recursive: true });
  await cp(sidecar.sidecar, join(binRoot, target.sidecarFile));
  if (target.platform !== "win32") await chmod(join(binRoot, target.sidecarFile), 0o755);
  const launcherPath = join(binRoot, target.launcherFile);
  await writeFile(launcherPath, renderLauncher(target));
  if (target.platform !== "win32") await chmod(launcherPath, 0o755);
  await cp(sidecar.license, join(runtimeRoot, "LICENSE.nodejs"));
  await writeFile(join(runtimeRoot, "runtime.json"), `${JSON.stringify({
    packageType: "platform-specific",
    target: target.id,
    platform: target.platform,
    arch: target.arch,
    nodeVersion: NODE_SIDECAR_VERSION,
    sidecar: target.sidecarRelativePath,
    sqlite: "node:sqlite",
  }, null, 2)}\n`);
  await writeFile(join(destinationPluginRoot, ".mcp.json"), `${JSON.stringify(targetMcpConfig(target), null, 2)}\n`);
  await writeFile(join(destinationPluginRoot, "hooks", "hooks.json"), `${JSON.stringify(targetHooksConfig(target), null, 2)}\n`);
  await normalizeRuntimeText(runtimeRoot);

  return {
    target,
    destinationPluginRoot,
    mcpBundleSize: (await stat(join(runtimeRoot, "mcp/index.js"))).size,
    hookBundleSize: (await stat(join(runtimeRoot, "hook-adapter/index.js"))).size,
  };
}

const results = [];
for (const target of selectedTargets) {
  const destination = options.all ? join(outputRoot, target.id) : outputRoot;
  results.push(await packageTarget(target, destination));
}

for (const result of results) {
  console.log(`Packaged ${manifest.name} ${manifest.version}: ${result.target.id} MCP ${result.mcpBundleSize.toLocaleString()} B, Hook ${result.hookBundleSize.toLocaleString()} B, Node ${NODE_SIDECAR_VERSION} sidecar included; SQLite uses node:sqlite.`);
}
