import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tag = process.argv.slice(2).find((argument) => argument !== "--");
if (!tag) throw new Error("A release tag is required");

const packageManifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const pluginManifest = JSON.parse(await readFile(resolve(root, "plugin", ".codex-plugin", "plugin.json"), "utf8"));
const expectedTag = `v${packageManifest.version}`;

if (tag !== expectedTag) throw new Error(`Release tag ${tag} does not match package version ${expectedTag}`);
if (pluginManifest.version !== packageManifest.version) throw new Error(`Plugin version ${pluginManifest.version} does not match package version ${packageManifest.version}`);

process.stdout.write(`Release tag verified: ${tag}\n`);
