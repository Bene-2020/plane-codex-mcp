import { chmod, cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
export const NODE_SIDECAR_VERSION = "22.22.1";
export const NODE_SIDECAR_PLATFORM = "darwin-arm64";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const nodeSidecarRoot = join(root, "vendor", "node", NODE_SIDECAR_PLATFORM);
export const nodeSidecarPath = join(nodeSidecarRoot, "node");
export const nodeSidecarLicensePath = join(nodeSidecarRoot, "LICENSE");

export async function ensureNodeSidecar() {
  try {
    await stat(nodeSidecarPath);
    return;
  } catch {
    // The pinned sidecar is fetched only when a fresh checkout has not populated it yet.
  }

  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(`The ambient-project-layer sidecar is currently available only for macOS arm64; cannot fetch ${NODE_SIDECAR_PLATFORM} on ${process.platform}/${process.arch}.`);
  }

  const archiveUrl = `https://nodejs.org/dist/v${NODE_SIDECAR_VERSION}/node-v${NODE_SIDECAR_VERSION}-${NODE_SIDECAR_PLATFORM}.tar.gz`;
  const response = await fetch(archiveUrl);
  if (!response.ok) throw new Error(`Unable to download the pinned Node sidecar (${response.status} ${response.statusText}) from ${archiveUrl}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ambient-node-sidecar-"));
  const archivePath = join(temporaryRoot, "node.tar.gz");
  const extractedRoot = join(temporaryRoot, "extracted");
  try {
    await mkdir(extractedRoot, { recursive: true });
    await writeFile(archivePath, archive);
    await execFile("/usr/bin/tar", ["-xzf", archivePath, "-C", extractedRoot]);
    const extracted = join(extractedRoot, `node-v${NODE_SIDECAR_VERSION}-${NODE_SIDECAR_PLATFORM}`);
    await mkdir(nodeSidecarRoot, { recursive: true });
    await cp(join(extracted, "bin", "node"), nodeSidecarPath);
    await chmod(nodeSidecarPath, 0o755);
    await cp(join(extracted, "LICENSE"), nodeSidecarLicensePath);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await ensureNodeSidecar();
  process.stdout.write(`Node sidecar ${NODE_SIDECAR_VERSION} ready at ${nodeSidecarPath}\n`);
}
