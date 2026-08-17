import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getExtractedNodePaths, getNodeSidecarTarget, NODE_SIDECAR_TARGET_IDS } from "../scripts/node-sidecar-targets.mjs";
import { PLUGIN_ENV_VARS, targetHooksConfig, targetMcpConfig } from "../scripts/plugin-config.mjs";

const pluginRoot = fileURLToPath(new URL("../plugin/", import.meta.url));

interface HookGroup { hooks: Array<{ type: string; command: string }> }

describe("plugin runtime paths", () => {
  it("keeps MCP and Hook commands inside the plugin root", async () => {
    const manifest = JSON.parse(await readFile(`${pluginRoot}/.codex-plugin/plugin.json`, "utf8")) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty("hooks");
    expect(manifest).toMatchObject({ name: "ambient-project-layer", version: "0.1.0", author: { name: "Wenyan Wei" }, interface: { displayName: "Ambient Project Layer", developerName: "Wenyan Wei" } });

    const sourceHooks = JSON.parse(await readFile(`${pluginRoot}/hooks/hooks.json`, "utf8")) as { hooks: Record<string, HookGroup[]> };
    for (const targetId of NODE_SIDECAR_TARGET_IDS) {
      const target = getNodeSidecarTarget(targetId);
      const mcp = targetMcpConfig(target) as { mcpServers: Record<string, { command: string; args: string[]; cwd: string; env?: Record<string, string>; env_vars: string[] }> };
      expect(mcp.mcpServers["ambient-project"]?.command).toBe(target.launcherRelativePath);
      expect(mcp.mcpServers["ambient-project"]?.args).toEqual(["runtime/mcp/index.js"]);
      expect(mcp.mcpServers["ambient-project"]?.cwd).toBe(".");
      expect(mcp.mcpServers["ambient-project"]?.env).toBeUndefined();
      expect(mcp.mcpServers["ambient-project"]?.env_vars).toEqual(PLUGIN_ENV_VARS);

      const hooks = targetHooksConfig(sourceHooks, target) as { hooks: Record<string, HookGroup[]> };
      const handlers = Object.values(hooks.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
      const expectedHookCommand = `"${"${PLUGIN_ROOT}"}/${target.launcherRelativePath}" "${"${PLUGIN_ROOT}"}/runtime/hook-adapter/index.js"`;
      expect(handlers).toHaveLength(5);
      expect(handlers.map((handler) => handler.command)).toEqual(new Array(5).fill(expectedHookCommand));
      expect(hooks.hooks.PostToolUse?.[0]?.matcher).toBe("^mcp__ambient_project__(list_projects|record_project_events|acknowledge_no_project_events|decline_project_binding|restore_project_binding)$");
      expect(handlers.every((handler) => !handler.command.includes(".."))).toBe(true);
      expect(handlers.every((handler) => !Object.hasOwn(handler, "statusMessage"))).toBe(true);
    }
  });

  it("keeps workspace package metadata aligned with the public release", async () => {
    const packages = [
      ["package.json", undefined],
      ["apps/hook-adapter/package.json", "apps/hook-adapter"],
      ["apps/mcp/package.json", "apps/mcp"],
      ["apps/panel/package.json", "apps/panel"],
      ["apps/service/package.json", "apps/service"],
      ["packages/core/package.json", "packages/core"],
      ["packages/plane/package.json", "packages/plane"],
      ["packages/storage/package.json", "packages/storage"],
    ] as const;
    for (const [path, directory] of packages) {
      const metadata = JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")) as Record<string, unknown>;
      expect(metadata).toMatchObject({ version: "0.1.0", private: true, license: "MIT", author: "Wenyan Wei" });
      expect(metadata.repository).toEqual({ type: "git", url: "git+https://github.com/Bene-2020/plane-codex-mcp.git", ...(directory ? { directory } : {}) });
    }
  });

  it("defines the strict five-target sidecar matrix", () => {
    expect(NODE_SIDECAR_TARGET_IDS).toEqual(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"]);
    const expectedTargets = [
      ["darwin-arm64", "node-v22.22.1-darwin-arm64.tar.gz", "bin/node", "node", "ambient-node"],
      ["darwin-x64", "node-v22.22.1-darwin-x64.tar.gz", "bin/node", "node", "ambient-node"],
      ["linux-x64", "node-v22.22.1-linux-x64.tar.gz", "bin/node", "node", "ambient-node"],
      ["linux-arm64", "node-v22.22.1-linux-arm64.tar.gz", "bin/node", "node", "ambient-node"],
      ["win32-x64", "node-v22.22.1-win-x64.zip", "node.exe", "node.exe", "ambient-node.cmd"],
    ] as const;

    for (const [targetId, archiveName, archiveSidecarRelativePath, sidecarFile, launcherFile] of expectedTargets) {
      const target = getNodeSidecarTarget(targetId);
      expect(target).toMatchObject({ archiveName, archiveSidecarRelativePath, archiveLicenseRelativePath: "LICENSE", sidecarFile, launcherFile });
      expect(getExtractedNodePaths("/tmp/extracted", target)).toEqual({
        sidecar: `/tmp/extracted/${target.extractDirectory}/${archiveSidecarRelativePath}`,
        license: `/tmp/extracted/${target.extractDirectory}/LICENSE`,
      });
    }
    expect(() => getNodeSidecarTarget("linux-arm64-musl")).toThrow(/Supported targets/);
  });
});
