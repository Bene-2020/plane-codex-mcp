import { chmod, cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getExtractedNodePaths,
  getNodeSidecarTargetForInput,
  NODE_SIDECAR_TARGETS,
  NODE_SIDECAR_VERSION,
} from "./node-sidecar-targets.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nodeSidecarCacheRoot = join(root, "vendor", "node");

export { NODE_SIDECAR_TARGETS, NODE_SIDECAR_VERSION } from "./node-sidecar-targets.mjs";

export function nodeSidecarPaths(targetOrPlatform, arch) {
  const target = getNodeSidecarTargetForInput(targetOrPlatform, arch);
  const targetRoot = join(nodeSidecarCacheRoot, target.id);
  return {
    target,
    root: targetRoot,
    sidecar: join(targetRoot, target.sidecarFile),
    license: join(targetRoot, "LICENSE"),
  };
}

async function extractArchive(archivePath, extractedRoot, target) {
  if (target.archiveType === "tar.gz") {
    await execFile("tar", ["-xzf", archivePath, "-C", extractedRoot]);
    return;
  }

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    await execFile(join(systemRoot, "System32", "tar.exe"), ["-xf", archivePath, "-C", extractedRoot]);
    return;
  }

  await execFile("unzip", ["-q", archivePath, "-d", extractedRoot]);
}

async function downloadArchive(archiveUrl, archivePath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(archiveUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Timed out downloading the pinned Node sidecar from ${archiveUrl}`);
    throw new Error(`Unable to download the pinned Node sidecar from ${archiveUrl}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureNodeSidecar(targetOrPlatform) {
  const paths = nodeSidecarPaths(targetOrPlatform);
  try {
    await Promise.all([stat(paths.sidecar), stat(paths.license)]);
    return paths;
  } catch {
    // A pinned sidecar is fetched only when this target is not cached yet.
  }

  const archiveUrl = `https://nodejs.org/dist/v${NODE_SIDECAR_VERSION}/${paths.target.archiveName}`;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ambient-node-sidecar-"));
  const archivePath = join(temporaryRoot, paths.target.archiveName);
  const extractedRoot = join(temporaryRoot, "extracted");
  try {
    await mkdir(extractedRoot, { recursive: true });
    await downloadArchive(archiveUrl, archivePath);
    await extractArchive(archivePath, extractedRoot, paths.target);
    const extractedPaths = getExtractedNodePaths(extractedRoot, paths.target);
    await mkdir(paths.root, { recursive: true });
    await cp(extractedPaths.sidecar, paths.sidecar);
    if (paths.target.platform !== "win32") await chmod(paths.sidecar, 0o755);
    await cp(extractedPaths.license, paths.license);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return paths;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentsList = process.argv.slice(2);
  const targetIndex = argumentsList.indexOf("--target");
  const targetArgument = targetIndex >= 0 ? argumentsList[targetIndex + 1] : argumentsList.find((argument) => argument.startsWith("--target="))?.slice("--target=".length);
  if (argumentsList.includes("--all")) {
    for (const target of NODE_SIDECAR_TARGETS) {
      const paths = await ensureNodeSidecar(target.id);
      process.stdout.write(`Node sidecar ${paths.target.id} ${NODE_SIDECAR_VERSION} ready at ${paths.sidecar}\n`);
    }
  } else {
    const paths = await ensureNodeSidecar(targetArgument);
    process.stdout.write(`Node sidecar ${paths.target.id} ${NODE_SIDECAR_VERSION} ready at ${paths.sidecar}\n`);
  }
}
