import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("release asset packaging", () => {
  it("includes the public documents and README media", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "ambient-release-asset-"));
    temporaryRoots.push(temporaryRoot);
    const pluginRoot = join(temporaryRoot, "plugin");
    const outputRoot = join(temporaryRoot, "release");

    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
    await mkdir(join(pluginRoot, "runtime", "bin"), { recursive: true });
    await Promise.all([
      writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "ambient-project-layer", version: "0.1.0" })),
      writeFile(join(pluginRoot, "runtime", "runtime.json"), JSON.stringify({ target: "darwin-arm64", platform: "darwin", arch: "arm64" })),
      writeFile(join(pluginRoot, "runtime", "bin", "node"), "test sidecar"),
      writeFile(join(pluginRoot, "LICENSE"), "test license"),
    ]);

    execFileSync(process.execPath, [
      join(root, "scripts", "package-release-asset.mjs"),
      "--plugin-root",
      pluginRoot,
      "--output",
      outputRoot,
    ]);

    for (const relativePath of [
      "README.md",
      "README_EN.md",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "LICENSE",
      "SECURITY.md",
      "THIRD_PARTY_NOTICES.md",
      ".github/workflows/ci-release.yml",
      "docs/assets/ambient-project-panel.gif",
    ]) {
      expect(existsSync(join(outputRoot, relativePath)), relativePath).toBe(true);
    }
  });
});
