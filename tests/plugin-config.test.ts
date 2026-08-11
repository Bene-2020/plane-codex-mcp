import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = fileURLToPath(new URL("../plugin/", import.meta.url));
const expectedHookCommand = 'node "${PLUGIN_ROOT}/runtime/hook-adapter/index.js"';

interface HookGroup { hooks: Array<{ type: string; command: string }> }

describe("plugin runtime paths", () => {
  it("keeps MCP and Hook commands inside the plugin root", async () => {
    const manifest = JSON.parse(await readFile(`${pluginRoot}/.codex-plugin/plugin.json`, "utf8")) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty("hooks");

    const mcp = JSON.parse(await readFile(`${pluginRoot}/.mcp.json`, "utf8")) as { mcpServers: Record<string, { args: string[] }> };
    expect(mcp.mcpServers["ambient-project"]?.args).toEqual(["${PLUGIN_ROOT}/runtime/mcp/index.js"]);

    const hooks = JSON.parse(await readFile(`${pluginRoot}/hooks/hooks.json`, "utf8")) as { hooks: Record<string, HookGroup[]> };
    const handlers = Object.values(hooks.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
    expect(handlers).toHaveLength(5);
    expect(handlers.map((handler) => handler.command)).toEqual(new Array(5).fill(expectedHookCommand));
    expect(handlers.every((handler) => !handler.command.includes(".."))).toBe(true);
    expect(handlers.every((handler) => !Object.hasOwn(handler, "statusMessage"))).toBe(true);
  });
});
