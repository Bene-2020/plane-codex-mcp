import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { getNodeSidecarTarget } from "./node-sidecar-targets.mjs";

const execFile = promisify(execFileCallback);
const pluginRoot = resolve(process.argv[2] ?? "plugin");
const metadata = JSON.parse(await readFile(join(pluginRoot, "runtime", "runtime.json"), "utf8"));
const target = getNodeSidecarTarget(metadata.target);
const sidecar = join(pluginRoot, "runtime", "bin", target.sidecarFile);
const { stdout } = await execFile(sidecar, ["--version"]);
const version = stdout.trim();
if (version !== `v${metadata.nodeVersion}`) throw new Error(`Bundled Node --version returned ${version}; expected v${metadata.nodeVersion}`);
process.stdout.write(`Bundled Node --version: ${version} (${target.id}, ${target.sidecarRelativePath})\n`);
