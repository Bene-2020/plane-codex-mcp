import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getNodeSidecarTarget } from "./node-sidecar-targets.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArguments(argumentsList) {
  const options = { pluginRoot: undefined, output: undefined };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;
    if (argument === "--plugin-root") {
      options.pluginRoot = argumentsList[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--plugin-root=")) {
      options.pluginRoot = argument.slice("--plugin-root=".length);
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
    throw new Error(`Unknown release asset option: ${argument}`);
  }
  if (!options.pluginRoot || !options.output) throw new Error("--plugin-root and --output are required");
  return { pluginRoot: resolve(options.pluginRoot), output: resolve(options.output) };
}

const options = parseArguments(process.argv.slice(2));
const pluginManifest = JSON.parse(await readFile(join(options.pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const runtimeManifest = JSON.parse(await readFile(join(options.pluginRoot, "runtime", "runtime.json"), "utf8"));
const target = getNodeSidecarTarget(runtimeManifest.target);

if (pluginManifest.name !== "ambient-project-layer") throw new Error(`Unexpected plugin name: ${pluginManifest.name}`);
if (runtimeManifest.platform !== target.platform || runtimeManifest.arch !== target.arch) throw new Error(`Runtime metadata does not match ${target.id}`);

const marketplaceManifest = {
  name: "ambient",
  interface: {
    displayName: "Ambient Project Layer",
  },
  plugins: [
    {
      name: pluginManifest.name,
      source: {
        source: "local",
        path: `./plugins/${pluginManifest.name}`,
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: "Productivity",
    },
  ],
};

await rm(options.output, { recursive: true, force: true });
await mkdir(join(options.output, ".agents", "plugins"), { recursive: true });
await mkdir(join(options.output, "plugins"), { recursive: true });
await Promise.all([
  cp(options.pluginRoot, join(options.output, "plugins", pluginManifest.name), { recursive: true }),
  cp(join(root, "README.md"), join(options.output, "README.md")),
  writeFile(join(options.output, ".agents", "plugins", "marketplace.json"), `${JSON.stringify(marketplaceManifest, null, 2)}\n`),
]);

for (const requiredPath of [
  join(options.output, ".agents", "plugins", "marketplace.json"),
  join(options.output, "plugins", pluginManifest.name, ".codex-plugin", "plugin.json"),
  join(options.output, "plugins", pluginManifest.name, "runtime", "bin", target.sidecarFile),
  join(options.output, "plugins", pluginManifest.name, "LICENSE"),
  join(options.output, "README.md"),
]) {
  if ((await stat(requiredPath)).size === 0) throw new Error(`Release asset file is empty: ${requiredPath}`);
}

process.stdout.write(`Release marketplace ready: ambient, ${pluginManifest.name} v${pluginManifest.version}, ${target.id}, ${options.output}\n`);
