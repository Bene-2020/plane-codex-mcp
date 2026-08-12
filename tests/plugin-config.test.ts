import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = fileURLToPath(new URL("../plugin/", import.meta.url));
const expectedHookCommand = '"${PLUGIN_ROOT}/runtime/bin/ambient-node" "${PLUGIN_ROOT}/runtime/hook-adapter/index.js"';

interface HookGroup { hooks: Array<{ type: string; command: string }> }

describe("plugin runtime paths", () => {
  it("keeps MCP and Hook commands inside the plugin root", async () => {
    const manifest = JSON.parse(await readFile(`${pluginRoot}/.codex-plugin/plugin.json`, "utf8")) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty("hooks");

    const mcp = JSON.parse(await readFile(`${pluginRoot}/.mcp.json`, "utf8")) as { mcpServers: Record<string, { args: string[]; cwd: string; env?: Record<string, string>; env_vars: string[] }> };
    expect(mcp.mcpServers["ambient-project"]?.command).toBe("runtime/bin/ambient-node");
    expect(mcp.mcpServers["ambient-project"]?.args).toEqual(["runtime/mcp/index.js"]);
    expect(mcp.mcpServers["ambient-project"]?.cwd).toBe(".");
    expect(mcp.mcpServers["ambient-project"]?.env).toBeUndefined();
    expect(mcp.mcpServers["ambient-project"]?.env_vars).toEqual(["AMBIENT_DB_PATH", "PLANE_MODE", "PLANE_BASE_URL", "PLANE_API_KEY", "PLANE_WORKSPACE_SLUG"]);

    const hooks = JSON.parse(await readFile(`${pluginRoot}/hooks/hooks.json`, "utf8")) as { hooks: Record<string, HookGroup[]> };
    const handlers = Object.values(hooks.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
    expect(handlers).toHaveLength(5);
    expect(handlers.map((handler) => handler.command)).toEqual(new Array(5).fill(expectedHookCommand));
    expect(handlers.every((handler) => !handler.command.includes(".."))).toBe(true);
    expect(handlers.every((handler) => !Object.hasOwn(handler, "statusMessage"))).toBe(true);
  });
});
