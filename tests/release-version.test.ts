import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, relativePath), "utf8")) as Record<string, unknown>;
}

describe("release version metadata", () => {
  it("keeps package, plugin, runtime, and user-facing release metadata aligned", async () => {
    const packageManifest = await readJson("package.json");
    const version = packageManifest.version;
    expect(version).toBe("0.1.1");

    const packagePaths = [
      "package.json",
      "apps/hook-adapter/package.json",
      "apps/mcp/package.json",
      "apps/panel/package.json",
      "apps/service/package.json",
      "packages/core/package.json",
      "packages/plane/package.json",
      "packages/storage/package.json",
    ];
    for (const path of packagePaths) expect((await readJson(path)).version, path).toBe(version);
    expect((await readJson("plugin/.codex-plugin/plugin.json")).version).toBe(version);

    const [mcpSource, panelSource, readme, readmeEnglish, changelog, releaseAssetScript, workflow] = await Promise.all([
      readFile(join(root, "apps/mcp/src/index.ts"), "utf8"),
      readFile(join(root, "apps/panel/src/main.tsx"), "utf8"),
      readFile(join(root, "README.md"), "utf8"),
      readFile(join(root, "README_EN.md"), "utf8"),
      readFile(join(root, "CHANGELOG.md"), "utf8"),
      readFile(join(root, "scripts/package-release-asset.mjs"), "utf8"),
      readFile(join(root, ".github/workflows/ci-release.yml"), "utf8"),
    ]);
    expect(mcpSource).toContain(`version: "${version}"`);
    expect(panelSource).toContain(`version: "${version}"`);
    for (const document of [readme, readmeEnglish]) {
      expect(document).toContain(`version-v${version}-`);
      expect(document).toContain(`ambient-project-layer-v${version}-<target>.zip`);
    }
    expect(changelog).toContain(`## [${version}] - 2026-08-18`);
    expect(changelog).toContain(`[Unreleased]: https://github.com/Bene-2020/plane-codex-mcp/compare/v${version}...HEAD`);
    expect(changelog).toContain(`[${version}]: https://github.com/Bene-2020/plane-codex-mcp/releases/tag/v${version}`);
    expect(releaseAssetScript).toContain("pluginManifest.version !== packageManifest.version");
    expect(workflow).toContain("name: plugin-${{ matrix.target }}");
    expect(workflow).toContain("name: evidence-${{ matrix.target }}");
    expect(workflow).toContain("retention-days: 14");
  });

  it("accepts only the tag derived from the root package version", async () => {
    const verifyScript = join(root, "scripts/verify-release-tag.mjs");
    expect(execFileSync(process.execPath, [verifyScript, "--", "v0.1.1"], { encoding: "utf8" })).toContain("Release tag verified: v0.1.1");
    expect(() => execFileSync(process.execPath, [verifyScript, "--", "v0.1.0"], { encoding: "utf8" })).toThrow();
  });
});
